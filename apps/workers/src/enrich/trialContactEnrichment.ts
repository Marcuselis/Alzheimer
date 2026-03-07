/**
 * Trial contact enrichment pipeline.
 *
 * For each trial:
 *   1. Extract PIs from principal_investigators field
 *   2. Normalize org names → canonical org + domain
 *   3. Search institution staff pages
 *   4. Extract emails (published or inferred)
 *   5. Verify emails: MX check → catch-all detection → SMTP probe
 *   6. Score and rank all contact candidates
 *   7. Persist to DB
 */

import { Pool } from 'pg';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { verifyEmail, adjustConfidenceForVerification, type VerificationStatus } from './emailVerification';
import { resolvePerson, recomputeInfluenceScore } from './personResolution';
import { computeAndSaveOpportunityScore } from './opportunityScoring';
import {
  normalizeOrg,
  inferDomainFromName,
  generateEmailCandidates,
  parseName,
  type OrgRecord,
} from './orgNormalization';
import { searchWeb } from '../sources/webSearch';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawPI {
  fullName: string;
  rawAffiliation: string;
  role: 'principal_investigator' | 'overall_official' | 'study_chair' | 'responsible_party';
}

export interface EnrichedContact {
  personId: string;
  fullName: string;
  firstName: string;
  lastName: string;
  role: string;
  organization: string | null;
  organizationId: string | null;
  domain: string | null;
  email: string | null;
  emailLabel: 'verified' | 'published' | 'inferred' | 'catch_all' | 'rejected' | 'low-confidence' | null;
  emailVerificationStatus: 'published' | 'verified' | 'inferred' | 'catch_all' | 'rejected' | 'unknown' | null;
  emailConfidence: number;
  linkedinUrl: string | null;
  linkedinConfidence: number;
  overallScore: number;
  confidenceLabel: 'high' | 'medium' | 'low';
  sources: Array<{ type: string; url: string; snippet: string }>;
}

// ─── Step 1: Extract PIs from raw trial data ─────────────────────────────────

/**
 * Parse the pipe-separated principal_investigators string.
 * Format: "Name, Title, Dept, Institution | Name2, Title2, ..."
 * or simply: "Name, Institution"
 */
export function extractPIsFromTrial(piField: string | undefined): RawPI[] {
  if (!piField || !piField.trim()) return [];

  return piField
    .split('|')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const parts = entry.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length === 0) return null;

      const fullName = parts[0];
      // Affiliation = everything after the name joined back
      const rawAffiliation = parts.slice(1).join(', ');

      return {
        fullName,
        rawAffiliation,
        role: 'principal_investigator' as const,
      };
    })
    .filter((pi): pi is RawPI => pi !== null && pi.fullName.length > 2);
}

// ─── Step 2: Normalize org ────────────────────────────────────────────────────

interface OrgResolution {
  org: OrgRecord | null;
  domain: string | null;
  canonicalName: string;
}

function resolveOrg(rawAffiliation: string): OrgResolution {
  if (!rawAffiliation) return { org: null, domain: null, canonicalName: rawAffiliation };

  const org = normalizeOrg(rawAffiliation);
  if (org) {
    return { org, domain: org.domain, canonicalName: org.canonicalName };
  }

  const inferredDomain = inferDomainFromName(rawAffiliation);
  return { org: null, domain: inferredDomain, canonicalName: rawAffiliation };
}

// ─── Step 3 & 4: Search institution staff pages ───────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;

async function fetchPageHtml(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      timeout: FETCH_TIMEOUT_MS,
    } as any);
    if (!resp.ok) return null;
    return resp.text();
  } catch {
    return null;
  }
}

const EMAIL_REGEX = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

function extractEmailsFromHtml(html: string, firstName: string, lastName: string): Array<{ email: string; context: string }> {
  const $ = cheerio.load(html);

  // 1. Extract from mailto links
  const emailsFromLinks: string[] = [];
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const email = href.replace('mailto:', '').split('?')[0].trim();
    if (email.includes('@')) emailsFromLinks.push(email);
  });

  // 2. Extract from text content
  const textContent = $.text();
  const emailsFromText = Array.from(new Set(textContent.match(EMAIL_REGEX) || []));

  const allEmails = [...new Set([...emailsFromLinks, ...emailsFromText])];

  // Filter: prefer emails that contain name components
  const fLower = firstName.toLowerCase();
  const lLower = lastName.toLowerCase();
  const fInitial = fLower.charAt(0);

  const scored = allEmails
    .filter(e => !e.includes('example') && !e.includes('noreply') && !e.includes('no-reply'))
    .map(email => {
      const local = email.split('@')[0].toLowerCase();
      let relevance = 0;
      if (local.includes(lLower)) relevance += 3;
      if (local.includes(fLower)) relevance += 2;
      if (local.includes(fInitial)) relevance += 1;
      return { email, relevance };
    })
    .sort((a, b) => b.relevance - a.relevance);

  return scored.map(s => ({ email: s.email, context: 'page' }));
}

async function searchAndExtractEmail(
  firstName: string,
  lastName: string,
  orgCanonical: string,
  domain: string | null
): Promise<Array<{ email: string; sourceUrl: string; label: 'published' | 'inferred' }>> {
  const results: Array<{ email: string; sourceUrl: string; label: 'published' | 'inferred' }> = [];

  // Build search queries
  const queries: string[] = [];
  if (domain) {
    queries.push(`"${firstName} ${lastName}" site:${domain}`);
  }
  queries.push(`"${firstName} ${lastName}" "${orgCanonical}" email`);
  queries.push(`"${firstName} ${lastName}" "${orgCanonical}" contact`);

  for (const query of queries.slice(0, 2)) {
    try {
      const searchResults = await searchWeb(query, 5);
      for (const result of searchResults) {
        // Fetch the page and extract emails
        const html = await fetchPageHtml(result.url);
        if (!html) continue;

        const extracted = extractEmailsFromHtml(html, firstName, lastName);
        if (extracted.length > 0) {
          results.push({
            email: extracted[0].email,
            sourceUrl: result.url,
            label: 'published',
          });
        }

        // Also check if a relevant email is in the snippet
        const snippetEmails = (result.snippet.match(EMAIL_REGEX) || []);
        for (const e of snippetEmails) {
          results.push({
            email: e,
            sourceUrl: result.url,
            label: 'published',
          });
        }

        if (results.length >= 2) break;
      }
      if (results.length >= 2) break;
    } catch {
      // continue
    }
  }

  // If no published email found and we have a domain, generate inferred candidates
  if (results.length === 0 && domain) {
    const candidates = generateEmailCandidates(firstName, lastName, domain);
    for (const c of candidates.slice(0, 2)) {
      results.push({
        email: c.email,
        sourceUrl: `inferred:${c.pattern}@${domain}`,
        label: 'inferred',
      });
    }
  }

  return results;
}

// ─── Step 5: Search for LinkedIn profile ─────────────────────────────────────

async function searchLinkedIn(
  firstName: string,
  lastName: string,
  orgCanonical: string
): Promise<Array<{ url: string; snippet: string }>> {
  const query = `site:linkedin.com/in "${firstName} ${lastName}" "${orgCanonical}"`;
  try {
    const results = await searchWeb(query, 3);
    return results
      .filter(r => r.url.includes('linkedin.com/in/'))
      .map(r => ({ url: r.url, snippet: r.snippet }));
  } catch {
    return [];
  }
}

// ─── Step 6: Score candidates ─────────────────────────────────────────────────

interface ScoringInput {
  hasPublishedEmail: boolean;
  hasInferredEmail: boolean;
  emailOnInstitutionDomain: boolean;
  exactNameMatchOnPage: boolean;
  orgMatch: boolean;
  alzheimerTitleMatch: boolean;
  linkedinFound: boolean;
  linkedinTitleMatch: boolean;
  orgInRegistry: boolean;
}

function scoreContact(input: ScoringInput): number {
  let score = 0;

  if (input.hasPublishedEmail) score += 60;
  if (input.emailOnInstitutionDomain) score += 0; // already factored in "published"
  if (input.hasInferredEmail && !input.hasPublishedEmail) score -= 25;

  if (input.exactNameMatchOnPage) score += 20;
  if (input.orgMatch) score += 10;
  if (input.alzheimerTitleMatch) score += 10;
  if (input.orgInRegistry) score += 5;

  if (input.linkedinFound) score += 15;
  if (input.linkedinTitleMatch) score += 10;

  return Math.max(0, Math.min(100, score));
}

function scoreToLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function emailConfidence(email: string | null, label: string | null, domain: string | null): number {
  if (!email) return 0;
  if (label === 'published' || label === 'verified') return 0.9;
  if (label === 'inferred') {
    // Check if the email domain matches institution domain
    if (domain && email.endsWith(`@${domain}`)) return 0.55;
    return 0.3;
  }
  return 0.4;
}

// ─── Step 7: Persist to DB ───────────────────────────────────────────────────

async function upsertOrganization(res: OrgResolution): Promise<string | null> {
  if (!res.canonicalName) return null;

  const normalizedName = res.canonicalName.toLowerCase().trim();

  const result = await db.query(
    `INSERT INTO organizations (name, normalized_name, website_url, primary_domain, country, type)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (normalized_name) DO UPDATE
       SET website_url = COALESCE(EXCLUDED.website_url, organizations.website_url),
           primary_domain = COALESCE(EXCLUDED.primary_domain, organizations.primary_domain)
     RETURNING id`,
    [
      res.org?.canonicalName ?? res.canonicalName,
      normalizedName,
      res.org?.websiteUrl ?? null,
      res.domain,
      res.org?.country ?? null,
      res.org?.type ?? 'other',
    ]
  );
  return result.rows[0]?.id ?? null;
}

// upsertPerson is now handled by resolvePerson() from personResolution.ts
// which performs multi-pass deduplication before any insert.

async function upsertTrialPerson(
  nctId: string,
  personId: string,
  orgId: string | null,
  role: string,
  rawAffiliation: string
): Promise<void> {
  await db.query(
    `INSERT INTO trial_people (nct_id, person_id, organization_id, role, raw_affiliation)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (nct_id, person_id, role) DO NOTHING`,
    [nctId, personId, orgId, role, rawAffiliation]
  );
}

async function upsertContactMethod(
  personId: string,
  type: 'email' | 'linkedin',
  value: string,
  source: string,
  sourceUrl: string | null,
  confidence: number,
  label: string | null,
  isPrimary: boolean,
  verificationStatus: VerificationStatus = 'unknown',
  mxValid: boolean | null = null,
  catchAll: boolean | null = null
): Promise<void> {
  await db.query(
    `INSERT INTO contact_methods
       (person_id, type, value, source, source_url, confidence, label, is_primary,
        verification_status, mx_valid, catch_all, last_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (person_id, type, value) DO UPDATE
       SET confidence = GREATEST(contact_methods.confidence, EXCLUDED.confidence),
           label = COALESCE(EXCLUDED.label, contact_methods.label),
           source_url = COALESCE(EXCLUDED.source_url, contact_methods.source_url),
           verification_status = EXCLUDED.verification_status,
           mx_valid = EXCLUDED.mx_valid,
           catch_all = EXCLUDED.catch_all,
           last_verified_at = NOW()`,
    [personId, type, value, source, sourceUrl, confidence, label, isPrimary,
     verificationStatus, mxValid, catchAll]
  );
}

async function upsertContactSource(
  personId: string,
  sourceType: string,
  sourceUrl: string | null,
  snippet: string | null,
  confidence: number
): Promise<void> {
  await db.query(
    `INSERT INTO contact_sources (person_id, source_type, source_url, raw_snippet, confidence)
     VALUES ($1, $2, $3, $4, $5)`,
    [personId, sourceType, sourceUrl, snippet?.slice(0, 500) ?? null, confidence]
  );
}

// ─── Main enrichment function ─────────────────────────────────────────────────

export async function enrichTrialContacts(nctId: string): Promise<EnrichedContact[]> {
  console.log(`[ContactEnrich] Starting enrichment for ${nctId}`);

  // Create enrichment job record
  const jobResult = await db.query(
    `INSERT INTO enrichment_jobs (nct_id, status, started_at)
     VALUES ($1, 'running', NOW()) RETURNING id`,
    [nctId]
  );
  const jobId = jobResult.rows[0]?.id;

  try {
    // Load trial from DB
    const trialResult = await db.query(
      `SELECT payload_json, raw_json, updated_at FROM trials WHERE nct_id = $1 LIMIT 1`,
      [nctId]
    );

    let piField: string | undefined;
    let trialMeta: { phase: string; status: string; sponsor: string; updatedAt: Date | null } = {
      phase: '', status: '', sponsor: '', updatedAt: null,
    };

    if (trialResult.rows.length > 0) {
      const payload = trialResult.rows[0].payload_json || trialResult.rows[0].raw_json || {};
      piField = payload.principal_investigators || payload.principalInvestigators;
      trialMeta = {
        phase: payload.phase || '',
        status: payload.status || payload.overallStatus || '',
        sponsor: payload.sponsor || payload.leadSponsorName || '',
        updatedAt: trialResult.rows[0].updated_at ?? null,
      };
    } else {
      console.log(`[ContactEnrich] Trial ${nctId} not in DB, checking raw file data`);
    }

    const pis = extractPIsFromTrial(piField);

    if (pis.length === 0) {
      console.log(`[ContactEnrich] No PIs found for ${nctId}`);
      await db.query(
        `UPDATE enrichment_jobs SET status = 'done', finished_at = NOW() WHERE id = $1`,
        [jobId]
      );
      return [];
    }

    const enrichedContacts: EnrichedContact[] = [];

    for (const pi of pis) {
      const { firstName, lastName, normalized } = parseName(pi.fullName);
      if (!firstName || !lastName) continue;

      // Resolve org
      const orgRes = resolveOrg(pi.rawAffiliation);

      // Persist org
      const orgId = await upsertOrganization(orgRes);

      // Resolve person identity (deduplicates across trials before inserting)
      const resolution = await resolvePerson(pi.fullName, pi.rawAffiliation, orgId);
      const personId = resolution.personId;
      if (!personId) continue;

      console.log(`[ContactEnrich] Person "${pi.fullName}" → ${resolution.matchType} (id: ${personId})`);

      // Persist trial-person link
      await upsertTrialPerson(nctId, personId, orgId, pi.role, pi.rawAffiliation);

      // Record source from ClinicalTrials.gov
      await upsertContactSource(
        personId,
        'clinicaltrials.gov',
        `https://clinicaltrials.gov/study/${nctId}`,
        pi.rawAffiliation,
        1.0
      );

      // Search for email
      const emailResults = await searchAndExtractEmail(
        firstName,
        lastName,
        orgRes.canonicalName,
        orgRes.domain
      );

      // Search for LinkedIn
      const linkedinResults = await searchLinkedIn(firstName, lastName, orgRes.canonicalName);

      // Pick best email
      const bestEmail = emailResults[0] ?? null;
      const bestLinkedIn = linkedinResults[0] ?? null;

      // ── Email verification ─────────────────────────────────────────────────
      let verifiedBestEmail = bestEmail;
      let verificationResult = null;

      if (bestEmail) {
        try {
          verificationResult = await verifyEmail(bestEmail.email, bestEmail.label);
          // If published, label stays published. Otherwise use verification status.
          if (bestEmail.label !== 'published') {
            verifiedBestEmail = { ...bestEmail, label: verificationResult.status as any };
          }
        } catch {
          // Verification is best-effort — don't block on failure
        }
      }

      // Scoring
      const alzheimerKeywords = ['alzheimer', 'neurology', 'dementia', 'neurolog', 'cognitive', 'memory'];
      const affiliationLower = pi.rawAffiliation.toLowerCase();
      const alzheimerMatch = alzheimerKeywords.some(k => affiliationLower.includes(k));

      const linkedinTitleMatch = bestLinkedIn
        ? alzheimerKeywords.some(k => bestLinkedIn.snippet.toLowerCase().includes(k)) ||
          bestLinkedIn.snippet.toLowerCase().includes('investigator') ||
          bestLinkedIn.snippet.toLowerCase().includes('professor')
        : false;

      const effectiveLabel = verifiedBestEmail?.label ?? null;

      const score = scoreContact({
        hasPublishedEmail: effectiveLabel === 'published' || effectiveLabel === 'verified',
        hasInferredEmail: effectiveLabel === 'inferred' || effectiveLabel === 'catch_all',
        emailOnInstitutionDomain: !!(verifiedBestEmail && orgRes.domain && verifiedBestEmail.email.endsWith(`@${orgRes.domain}`)),
        exactNameMatchOnPage: true, // we searched by name
        orgMatch: !!orgRes.org,
        alzheimerTitleMatch: alzheimerMatch,
        linkedinFound: !!bestLinkedIn,
        linkedinTitleMatch,
        orgInRegistry: !!orgRes.org,
      });

      let emailConf = emailConfidence(verifiedBestEmail?.email ?? null, verifiedBestEmail?.label ?? null, orgRes.domain);
      if (verificationResult) {
        emailConf = adjustConfidenceForVerification(emailConf, verificationResult.status);
      }

      // Persist email with verification data
      if (verifiedBestEmail) {
        await upsertContactMethod(
          personId,
          'email',
          verifiedBestEmail.email,
          'web_search',
          verifiedBestEmail.sourceUrl.startsWith('inferred:') ? null : verifiedBestEmail.sourceUrl,
          emailConf,
          effectiveLabel,
          true,
          verificationResult?.status ?? (verifiedBestEmail.label === 'published' ? 'published' : 'unknown'),
          verificationResult?.mxValid ?? null,
          verificationResult?.catchAll ?? null
        );
      }

      // Persist secondary inferred emails (no SMTP check to save time)
      for (const e of emailResults.slice(1, 3)) {
        const conf = emailConfidence(e.email, e.label, orgRes.domain);
        if (conf > 0.3) {
          await upsertContactMethod(
            personId,
            'email',
            e.email,
            'web_search',
            e.sourceUrl.startsWith('inferred:') ? null : e.sourceUrl,
            conf,
            e.label,
            false,
            e.label === 'published' ? 'published' : 'inferred',
            null,
            null
          );
        }
      }

      // Persist LinkedIn
      if (bestLinkedIn) {
        const liConf = linkedinTitleMatch ? 0.75 : 0.5;
        await upsertContactMethod(
          personId,
          'linkedin',
          bestLinkedIn.url,
          'web_search',
          bestLinkedIn.url,
          liConf,
          null,
          true
        );
        await upsertContactSource(personId, 'linkedin', bestLinkedIn.url, bestLinkedIn.snippet, liConf);
      }

      enrichedContacts.push({
        personId,
        fullName: pi.fullName,
        firstName,
        lastName,
        role: pi.role,
        organization: orgRes.canonicalName || null,
        organizationId: orgId,
        domain: orgRes.domain,
        email: verifiedBestEmail?.email ?? null,
        emailLabel: effectiveLabel as any,
        emailVerificationStatus: verificationResult?.status ?? (verifiedBestEmail?.label === 'published' ? 'published' : null),
        emailConfidence: emailConf,
        linkedinUrl: bestLinkedIn?.url ?? null,
        linkedinConfidence: bestLinkedIn ? (linkedinTitleMatch ? 0.75 : 0.5) : 0,
        overallScore: score,
        confidenceLabel: scoreToLabel(score),
        sources: [
          { type: 'clinicaltrials.gov', url: `https://clinicaltrials.gov/study/${nctId}`, snippet: pi.rawAffiliation },
          ...(bestLinkedIn ? [{ type: 'linkedin', url: bestLinkedIn.url, snippet: bestLinkedIn.snippet }] : []),
        ],
      });

      // Small delay between persons to respect rate limits
      await new Promise(r => setTimeout(r, 800));
    }

    // Sort by score desc
    enrichedContacts.sort((a, b) => b.overallScore - a.overallScore);

    // Recompute influence scores for all people touched in this enrichment
    const uniquePersonIds = [...new Set(enrichedContacts.map(c => c.personId))];
    await Promise.allSettled(uniquePersonIds.map(id => recomputeInfluenceScore(id)));

    // Compute and persist the opportunity score for this trial
    if (trialMeta.phase || trialMeta.status || trialMeta.sponsor) {
      await computeAndSaveOpportunityScore({
        nctId,
        phase: trialMeta.phase,
        status: trialMeta.status,
        sponsor: trialMeta.sponsor,
        updatedAt: trialMeta.updatedAt,
      }).catch(err => console.warn(`[ContactEnrich] Opportunity score failed for ${nctId}:`, err.message));
    }

    await db.query(
      `UPDATE enrichment_jobs SET status = 'done', finished_at = NOW() WHERE id = $1`,
      [jobId]
    );

    console.log(`[ContactEnrich] Done for ${nctId}: ${enrichedContacts.length} contacts`);
    return enrichedContacts;
  } catch (err: any) {
    console.error(`[ContactEnrich] Error for ${nctId}:`, err.message);
    await db.query(
      `UPDATE enrichment_jobs SET status = 'error', finished_at = NOW(), error = $2 WHERE id = $1`,
      [jobId, err.message]
    );
    throw err;
  }
}

/**
 * Load already-enriched contacts from DB for a trial (no new enrichment).
 */
export async function getEnrichedContactsForTrial(nctId: string): Promise<EnrichedContact[]> {
  const result = await db.query(
    `SELECT
       p.id            AS person_id,
       p.full_name,
       p.first_name,
       p.last_name,
       tp.role,
       tp.raw_affiliation,
       o.name          AS org_name,
       o.id            AS org_id,
       o.primary_domain AS domain,
       cm_email.value               AS email,
       cm_email.label               AS email_label,
       cm_email.verification_status AS email_verification_status,
       cm_email.confidence          AS email_confidence,
       cm_li.value     AS linkedin_url,
       cm_li.confidence AS linkedin_confidence
     FROM trial_people tp
     JOIN people p ON p.id = tp.person_id
     LEFT JOIN organizations o ON o.id = tp.organization_id
     LEFT JOIN LATERAL (
       SELECT value, label, confidence FROM contact_methods
       WHERE person_id = p.id AND type = 'email' AND is_primary = true
       ORDER BY confidence DESC LIMIT 1
     ) cm_email ON TRUE
     LEFT JOIN LATERAL (
       SELECT value, confidence FROM contact_methods
       WHERE person_id = p.id AND type = 'linkedin' AND is_primary = true
       ORDER BY confidence DESC LIMIT 1
     ) cm_li ON TRUE
     WHERE tp.nct_id = $1
     ORDER BY cm_email.confidence DESC NULLS LAST`,
    [nctId]
  );

  return result.rows.map(row => {
    const emailConf = parseFloat(row.email_confidence) || 0;
    const liConf = parseFloat(row.linkedin_confidence) || 0;

    const score = scoreContact({
      hasPublishedEmail: row.email_label === 'published' || row.email_label === 'verified',
      hasInferredEmail: row.email_label === 'inferred',
      emailOnInstitutionDomain: !!(row.email && row.domain && row.email.endsWith(`@${row.domain}`)),
      exactNameMatchOnPage: !!row.email,
      orgMatch: !!row.org_id,
      alzheimerTitleMatch: false, // not stored per-row
      linkedinFound: !!row.linkedin_url,
      linkedinTitleMatch: liConf > 0.6,
      orgInRegistry: !!row.domain,
    });

    return {
      personId: row.person_id,
      fullName: row.full_name,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role,
      organization: row.org_name || row.raw_affiliation || null,
      organizationId: row.org_id,
      domain: row.domain,
      email: row.email,
      emailLabel: row.email_label,
      emailVerificationStatus: row.email_verification_status ?? null,
      emailConfidence: emailConf,
      linkedinUrl: row.linkedin_url,
      linkedinConfidence: liConf,
      overallScore: score,
      confidenceLabel: scoreToLabel(score),
      sources: [],
    };
  });
}

/**
 * Get the latest enrichment job status for a trial.
 */
export async function getEnrichmentJobStatus(
  nctId: string
): Promise<{ status: string; startedAt: string | null; finishedAt: string | null; error: string | null } | null> {
  const result = await db.query(
    `SELECT status, started_at, finished_at, error
     FROM enrichment_jobs
     WHERE nct_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [nctId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    status: row.status,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    error: row.error ?? null,
  };
}
