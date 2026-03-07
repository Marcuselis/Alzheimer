/**
 * Investigator contact enrichment pipeline.
 *
 * Given an investigator slug + metadata (name, institution), this:
 *   1. Resolves institution/domain context
 *   2. Finds LinkedIn candidates
 *   3. Finds official profile/staff pages
 *   4. Attempts published email discovery
 *   5. Falls back to email inference + verification
 *   6. Persists contacts and computes best primary
 *
 * Contact discovery priority:
 *   published  — email found verbatim on official staff page (best)
 *   verified   — pattern candidate that passed MX + SMTP + not catch-all
 *   inferred   — pattern candidate with valid MX but SMTP unavailable/catch-all
 *   catch_all  — domain accepts all addresses (SMTP unreliable)
 *   rejected   — SMTP explicitly rejected the address
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import {
  normalizeOrg,
  inferDomainFromName,
  generateEmailCandidates,
  parseName,
} from './orgNormalization';
import { verifyEmail, adjustConfidenceForVerification } from './emailVerification';
import { searchWeb } from '../sources/webSearch';
import { linkedinCandidateSearch } from './linkedinCandidateSearch';
import { profileDiscovery } from './profileDiscovery';
import fetch from 'node-fetch';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

// ── Outcome tracking ──────────────────────────────────────────────────────────

export type FailureReason =
  | 'no_institution'          // institution field was null/empty
  | 'no_domain'               // could not resolve any domain from institution
  | 'domain_inferred_only'    // domain resolved via heuristic, not curated registry
  | 'linkedin_not_found'      // no good LinkedIn candidates found
  | 'profile_page_not_found'  // no good profile pages found
  | 'web_search_failed'       // searchWeb threw an error
  | 'web_search_no_results'   // searchWeb returned 0 results
  | 'no_pages_scraped'        // all page fetches failed
  | 'no_email_on_pages'       // pages loaded but contained no email addresses
  | 'name_too_ambiguous'      // could not parse first/last name reliably
  | 'all_smtp_rejected'       // every candidate was SMTP-rejected
  | 'all_catch_all'           // every verified address is catch-all (unreliable)
  | 'low_confidence'          // adjusted confidence below threshold for all candidates
  | 'smtp_unavailable';       // SMTP probing returned unknown for all candidates

interface EnrichmentOutcome {
  institutionRaw: string | null;
  domainResolved: string | null;
  domainSource: 'normalized' | 'inferred' | null;
  webSearchAttempted: boolean;
  webSearchResultCount: number;
  pagesScraped: number;
  publishedEmailFound: boolean;
  candidatesGenerated: number;
  candidatesChecked: number;
  verifiedCount: number;     // status === 'verified'
  rejectedCount: number;     // status === 'rejected'
  catchAllCount: number;     // status === 'catch_all'
  unknownCount: number;      // status === 'unknown'
  failureReasons: FailureReason[];
}

function makeOutcome(institutionRaw: string | null): EnrichmentOutcome {
  return {
    institutionRaw,
    domainResolved: null,
    domainSource: null,
    webSearchAttempted: false,
    webSearchResultCount: 0,
    pagesScraped: 0,
    publishedEmailFound: false,
    candidatesGenerated: 0,
    candidatesChecked: 0,
    verifiedCount: 0,
    rejectedCount: 0,
    catchAllCount: 0,
    unknownCount: 0,
    failureReasons: [],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export interface InvestigatorInput {
  investigatorId: string; // slug, e.g. "maria-svensson"
  fullName: string;
  institution: string | null;
  country?: string | null;
  topic?: string | null;
}

function extractEmailsFromText(text: string): string[] {
  const matches = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? [];
  return [...new Set(matches.map(e => e.toLowerCase()))];
}

// ── DB persistence ────────────────────────────────────────────────────────────

async function upsertContact(params: {
  investigatorId: string;
  type: string;
  value: string;
  status: string;
  sourceType: string;
  sourceUrl?: string;
  sourceLabel?: string;
  confidence: number;
  isPrimary: boolean;
  mxValid?: boolean;
  catchAll?: boolean;
}): Promise<void> {
  await db.query(
    `INSERT INTO investigator_contacts
       (investigator_id, type, value, status, source_type, source_url, source_label,
        confidence, is_primary, visible, last_verified_at, mx_valid, catch_all)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12)
     ON CONFLICT (investigator_id, type, value) DO UPDATE
       SET status            = EXCLUDED.status,
           source_type       = EXCLUDED.source_type,
           source_url        = COALESCE(EXCLUDED.source_url, investigator_contacts.source_url),
           source_label      = COALESCE(EXCLUDED.source_label, investigator_contacts.source_label),
           confidence        = GREATEST(EXCLUDED.confidence, investigator_contacts.confidence),
           is_primary        = EXCLUDED.is_primary,
           last_verified_at  = NOW(),
           mx_valid          = EXCLUDED.mx_valid,
           catch_all         = EXCLUDED.catch_all,
           updated_at        = NOW()`,
    [
      params.investigatorId,
      params.type,
      params.value,
      params.status,
      params.sourceType,
      params.sourceUrl ?? null,
      params.sourceLabel ?? null,
      params.confidence,
      params.isPrimary,
      params.status !== 'rejected', // rejected contacts hidden
      params.mxValid ?? null,
      params.catchAll ?? null,
    ]
  );
}

async function recomputePrimaryContact(investigatorId: string): Promise<void> {
  const best = await db.query(
    `SELECT id
     FROM investigator_contacts
     WHERE investigator_id = $1
       AND visible = TRUE
       AND status != 'rejected'
     ORDER BY
       CASE
         WHEN type = 'email'    AND status = 'published' THEN 1
         WHEN type = 'linkedin' AND status = 'matched'   THEN 2
         WHEN type = 'website'  AND status = 'matched'   THEN 3
         WHEN type = 'email'    AND status = 'verified'  THEN 4
         WHEN type = 'email'    AND status IN ('inferred', 'catch_all') THEN 5
         WHEN type = 'website'  AND status = 'possible'  THEN 6
         WHEN type = 'linkedin' AND status = 'possible'  THEN 7
         ELSE 99
       END,
       confidence DESC,
       updated_at DESC
     LIMIT 1`,
    [investigatorId]
  );

  const primaryId = best.rows[0]?.id ?? null;
  if (!primaryId) {
    await db.query(`UPDATE investigator_contacts SET is_primary = FALSE WHERE investigator_id = $1`, [investigatorId]);
    return;
  }

  await db.query(
    `UPDATE investigator_contacts
     SET is_primary = (id = $2)
     WHERE investigator_id = $1`,
    [investigatorId, primaryId]
  );
}

async function setEnrichmentStatus(
  investigatorId: string,
  status: string,
  contactsFound: number,
  outcome: EnrichmentOutcome,
  errorMessage?: string
): Promise<void> {
  await db.query(
    `INSERT INTO investigator_enrichment_status
       (investigator_id, status, contacts_found, last_run_at, error_message, outcome_log)
     VALUES ($1, $2, $3, NOW(), $4, $5)
     ON CONFLICT (investigator_id) DO UPDATE
       SET status          = EXCLUDED.status,
           contacts_found  = EXCLUDED.contacts_found,
           last_run_at     = NOW(),
           error_message   = EXCLUDED.error_message,
           outcome_log     = EXCLUDED.outcome_log,
           updated_at      = NOW()`,
    [investigatorId, status, contactsFound, errorMessage ?? null, JSON.stringify(outcome)]
  );
}

// ── Published email extraction via web search ─────────────────────────────────

async function searchForPublishedEmail(
  fullName: string,
  institution: string | null,
  domain: string | null,
  outcome: EnrichmentOutcome
): Promise<{ email: string; sourceUrl: string; sourceLabel: string } | null> {
  const query = domain
    ? `"${fullName}" site:${domain} email`
    : institution
    ? `"${fullName}" "${institution}" email contact`
    : `"${fullName}" researcher email`;

  outcome.webSearchAttempted = true;

  let results;
  try {
    results = await searchWeb(query, 3);
  } catch {
    outcome.failureReasons.push('web_search_failed');
    return null;
  }

  outcome.webSearchResultCount = results.length;

  if (results.length === 0) {
    outcome.failureReasons.push('web_search_no_results');
    return null;
  }

  let anyPageLoaded = false;
  let anyEmailFound = false;

  for (const result of results) {
    let html = '';
    try {
      const resp = await (fetch as any)(result.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      });
      html = await resp.text();
      anyPageLoaded = true;
      outcome.pagesScraped++;
    } catch {
      continue;
    }

    const emails = extractEmailsFromText(html);
    if (emails.length > 0) anyEmailFound = true;

    // Prefer emails matching the institution domain
    const domainEmails = domain ? emails.filter(e => e.endsWith(`@${domain}`)) : emails;
    const candidates = domainEmails.length > 0 ? domainEmails : emails;

    // Filter: must contain part of the last name
    const parsed = parseName(fullName);
    const lastPart = parsed.lastName.toLowerCase().replace(/[^a-z]/g, '');
    const matching = candidates.filter(e => lastPart.length > 2 && e.includes(lastPart));

    const chosen = matching[0] ?? candidates[0];
    if (chosen) {
      return {
        email: chosen,
        sourceUrl: result.url,
        sourceLabel: result.title ?? result.url,
      };
    }
  }

  if (!anyPageLoaded) {
    outcome.failureReasons.push('no_pages_scraped');
  } else if (!anyEmailFound) {
    outcome.failureReasons.push('no_email_on_pages');
  }

  return null;
}

// ── Main enrichment function ──────────────────────────────────────────────────

export async function enrichInvestigatorContacts(input: InvestigatorInput): Promise<void> {
  const { investigatorId, fullName, institution, country, topic } = input;

  console.log(`[InvEnrich] Starting: ${fullName} (${investigatorId})`);

  const outcome = makeOutcome(institution);

  // Write 'running' immediately — no outcome_log yet at this stage
  await db.query(
    `INSERT INTO investigator_enrichment_status
       (investigator_id, status, contacts_found, last_run_at)
     VALUES ($1, 'running', 0, NOW())
     ON CONFLICT (investigator_id) DO UPDATE
       SET status = 'running', last_run_at = NOW(), updated_at = NOW()`,
    [investigatorId]
  );

  let contactsFound = 0;

  try {
    // 1. Resolve domain
    if (!institution) {
      outcome.failureReasons.push('no_institution');
    }

    const orgRecord = institution ? normalizeOrg(institution) : null;
    const domain = orgRecord?.domain ?? (institution ? inferDomainFromName(institution) : null);

    if (domain) {
      outcome.domainResolved = domain;
      outcome.domainSource = orgRecord?.domain ? 'normalized' : 'inferred';
      if (outcome.domainSource === 'inferred') {
        outcome.failureReasons.push('domain_inferred_only');
      }
    } else if (institution) {
      outcome.failureReasons.push('no_domain');
    }

    console.log(`[InvEnrich] ${fullName}: institution="${institution}", domain="${domain ?? 'unknown'}" (source=${outcome.domainSource ?? 'none'})`);

    // 2. Discover LinkedIn first (high recall from weak PI data)
    const linkedinCandidates = await linkedinCandidateSearch({
      fullName,
      institution,
      country,
      topic: topic ?? 'alzheimer neurology',
    });

    if (linkedinCandidates.length === 0 || linkedinCandidates.every(c => c.status === 'rejected')) {
      outcome.failureReasons.push('linkedin_not_found');
    }

    for (const c of linkedinCandidates) {
      await upsertContact({
        investigatorId,
        type: 'linkedin',
        value: c.url,
        status: c.status,
        sourceType: 'linkedin',
        sourceUrl: c.url,
        sourceLabel: c.title || 'LinkedIn',
        confidence: c.score,
        isPrimary: false,
      });
      if (c.status !== 'rejected') contactsFound++;
    }

    // 3. Discover official profile/staff pages
    const profileCandidates = await profileDiscovery({
      fullName,
      institution,
      domain,
      country,
      topic: topic ?? 'alzheimer neurology',
    });

    if (profileCandidates.length === 0 || profileCandidates.every(c => c.status === 'rejected')) {
      outcome.failureReasons.push('profile_page_not_found');
      if (domain) {
        // Department fallback: institution homepage/directory pointer.
        await upsertContact({
          investigatorId,
          type: 'website',
          value: `https://${domain}`,
          status: 'possible',
          sourceType: 'institution_directory',
          sourceUrl: `https://${domain}`,
          sourceLabel: institution ? `${institution} directory` : domain,
          confidence: 40,
          isPrimary: false,
        });
        contactsFound++;
      }
    } else {
      for (const c of profileCandidates) {
        await upsertContact({
          investigatorId,
          type: 'website',
          value: c.url,
          status: c.status,
          sourceType: c.isOfficialPage ? 'staff_page' : 'institution_directory',
          sourceUrl: c.url,
          sourceLabel: c.title || 'Profile page',
          confidence: c.score,
          isPrimary: false,
        });
        if (c.status !== 'rejected') contactsFound++;
      }
    }

    // 4. Attempt to find a published email via web search
    const published = await searchForPublishedEmail(fullName, institution, domain, outcome);
    if (published) {
      outcome.publishedEmailFound = true;
      await upsertContact({
        investigatorId,
        type: 'email',
        value: published.email,
        status: 'published',
        sourceType: 'staff_page',
        sourceUrl: published.sourceUrl,
        sourceLabel: published.sourceLabel,
        confidence: 90,
        isPrimary: false,
      });
      contactsFound++;
      console.log(`[InvEnrich] ${fullName}: found published email ${published.email}`);
    }

    // 5. Generate pattern-based candidates if we have a domain
    if (domain) {
      const parsed = parseName(fullName);
      if (!parsed.firstName || !parsed.lastName) {
        outcome.failureReasons.push('name_too_ambiguous');
      } else {
        const candidates = generateEmailCandidates(parsed.firstName, parsed.lastName, domain);
        outcome.candidatesGenerated = candidates.length;

        let allRejected = true;
        let allCatchAll = true;
        let allLowConfidence = true;

        for (const { email, pattern } of candidates) {
          // Skip if we already have this exact email from published step
          if (published?.email === email) continue;

          outcome.candidatesChecked++;

          const baseConfidence = pattern === 'firstname.lastname' ? 65
            : pattern === 'f.lastname' ? 58
            : 45;

          let verifyResult;
          try {
            verifyResult = await verifyEmail(email, null);
          } catch {
            verifyResult = { status: 'unknown' as const, mxValid: false, catchAll: null };
          }

          if (verifyResult.status === 'rejected') {
            outcome.rejectedCount++;
            allCatchAll = false;
            // Store rejected but invisible — useful to know we checked
            await upsertContact({
              investigatorId,
              type: 'email',
              value: email,
              status: 'rejected',
              sourceType: 'inference',
              sourceLabel: `Pattern: ${pattern}`,
              confidence: 0,
              isPrimary: false,
              mxValid: verifyResult.mxValid,
              catchAll: verifyResult.catchAll ?? undefined,
            });
            continue;
          }

          if (verifyResult.status === 'catch_all') {
            outcome.catchAllCount++;
            allRejected = false;
          } else if (verifyResult.status === 'verified') {
            outcome.verifiedCount++;
            allRejected = false;
            allCatchAll = false;
          } else {
            outcome.unknownCount++;
            allRejected = false;
            allCatchAll = false;
          }

          const adjConfidence = Math.round(
            adjustConfidenceForVerification(baseConfidence / 100, verifyResult.status) * 100
          );

          if (adjConfidence < 20) continue; // not worth storing
          allLowConfidence = false;

          await upsertContact({
            investigatorId,
            type: 'email',
            value: email,
            status: verifyResult.status,
            sourceType: 'inference',
            sourceLabel: `Pattern: ${pattern}`,
            confidence: adjConfidence,
            isPrimary: false,
            mxValid: verifyResult.mxValid,
            catchAll: verifyResult.catchAll ?? undefined,
          });
          contactsFound++;

          console.log(`[InvEnrich] ${fullName}: ${email} → ${verifyResult.status} (${adjConfidence}%)`);

          // Brief pause between SMTP probes to be polite
          await new Promise(r => setTimeout(r, 1500));
        }

        // Synthesize failure reasons from SMTP outcomes
        if (outcome.candidatesChecked > 0) {
          if (allRejected && outcome.rejectedCount === outcome.candidatesChecked) {
            outcome.failureReasons.push('all_smtp_rejected');
          }
          if (allCatchAll && outcome.catchAllCount > 0 && outcome.rejectedCount === 0) {
            outcome.failureReasons.push('all_catch_all');
          }
          if (allLowConfidence && outcome.verifiedCount === 0 && outcome.catchAllCount === 0) {
            outcome.failureReasons.push('low_confidence');
          }
          if (outcome.unknownCount === outcome.candidatesChecked) {
            outcome.failureReasons.push('smtp_unavailable');
          }
        }
      }
    }

    await recomputePrimaryContact(investigatorId);
    const totalVisible = await db.query(
      `SELECT COUNT(*)::int AS count FROM investigator_contacts WHERE investigator_id = $1 AND visible = TRUE`,
      [investigatorId]
    );
    const persistedContacts = totalVisible.rows[0]?.count ?? 0;
    const finalStatus = persistedContacts > 0 ? 'done' : 'partial';
    await setEnrichmentStatus(investigatorId, finalStatus, persistedContacts, outcome);

    console.log(
      `[InvEnrich] Done: ${fullName} — ${persistedContacts} contacts` +
      (outcome.failureReasons.length ? ` | failures: ${outcome.failureReasons.join(', ')}` : '')
    );

  } catch (err: any) {
    console.error(`[InvEnrich] Failed: ${fullName}:`, err.message);
    await setEnrichmentStatus(investigatorId, 'failed', contactsFound, outcome, err.message);
    throw err;
  }
}

// ── Load investigator data from trials.json ───────────────────────────────────

export interface InvestigatorRecord {
  investigatorId: string;
  fullName: string;
  institution: string | null;
  trialCount: number;
}

export function loadInvestigatorsFromTrials(): InvestigatorRecord[] {
  const jsonPath = path.join(process.cwd(), '..', 'web', 'data', 'generated', 'trials.json');
  if (!fs.existsSync(jsonPath)) return [];

  const trials = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Array<{
    nct_id: string;
    phase?: string;
    principal_investigators?: string;
  }>;

  function slugify(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function stripTitles(name: string) {
    return name.replace(/\b(Dr\.?|Prof\.?|MD|PhD|MPH|MBBS|MS|MSc)\b\.?/gi, '').replace(/\s+/g, ' ').trim();
  }

  const map = new Map<string, InvestigatorRecord>();

  for (const trial of trials) {
    if (!trial.principal_investigators) continue;
    for (const entry of trial.principal_investigators.split('|')) {
      const parts = entry.split(',').map((s: string) => s.trim());
      const rawName = parts[0];
      if (!rawName || rawName.length < 3) continue;
      const name = stripTitles(rawName);
      if (!name || name.length < 3) continue;
      const institution = parts.length >= 4 ? parts[3] : (parts.length >= 3 ? parts[2] : null);
      const slug = slugify(name);
      if (!slug) continue;

      const rec = map.get(slug);
      if (rec) {
        rec.trialCount++;
        if (!rec.institution && institution) rec.institution = institution;
      } else {
        map.set(slug, { investigatorId: slug, fullName: name, institution: institution || null, trialCount: 1 });
      }
    }
  }

  return Array.from(map.values());
}
