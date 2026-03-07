/**
 * Person identity resolution.
 *
 * The problem: the same investigator appears in different trials as:
 *   "Maria Svensson"
 *   "Dr. Maria Svensson"
 *   "Maria K. Svensson"
 *   "M. Svensson"
 *
 * Naive upsert by normalized_name will create four separate records.
 *
 * This module resolves identity before inserting by checking, in order:
 *   1. Exact normalized_name match
 *   2. ORCID match (most authoritative)
 *   3. Email match (person already has a known email that matches)
 *   4. Last-name + first-initial match within same organization
 *   5. Token overlap score for full name + same org
 *
 * When a match is found above a confidence threshold, we return the existing
 * person's ID and optionally record the new alias.
 *
 * When no match is found, we insert a new record and return its ID.
 */

import { Pool } from 'pg';
import { parseName } from './orgNormalization';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

// ── Name similarity helpers ────────────────────────────────────────────────────

/** Tokenize a name into lowercase alpha tokens */
function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z ]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0)
  );
}

/** Jaccard similarity between two token sets */
function jaccardSim(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter(t => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check if a candidate last name matches the query last name,
 * tolerating initials (e.g. "M. Svensson" matches "Maria Svensson").
 */
function lastNameMatches(queryLast: string, candidateLast: string): boolean {
  return queryLast.toLowerCase() === candidateLast.toLowerCase();
}

function firstInitialMatches(queryFirst: string, candidateFirst: string): boolean {
  if (!queryFirst || !candidateFirst) return false;
  const qi = queryFirst.charAt(0).toLowerCase();
  const ci = candidateFirst.charAt(0).toLowerCase();
  return qi === ci;
}

// ── Resolution result ─────────────────────────────────────────────────────────

export interface ResolutionResult {
  personId: string;
  isNewRecord: boolean;
  matchType: 'exact' | 'orcid' | 'email' | 'last_name_initial' | 'token_similarity' | 'new';
  confidence: number;
}

// ── Main resolution function ───────────────────────────────────────────────────

export async function resolvePerson(
  fullName: string,
  rawAffiliation: string,
  orgId: string | null,
  orcid?: string,
  knownEmail?: string
): Promise<ResolutionResult> {
  const { firstName, lastName, normalized } = parseName(fullName);

  // ── Pass 1: Exact normalized name ──────────────────────────────────────────
  const exact = await db.query(
    `SELECT id FROM people WHERE normalized_name = $1 LIMIT 1`,
    [normalized]
  );
  if (exact.rows.length > 0) {
    await recordAlias(exact.rows[0].id, fullName);
    return { personId: exact.rows[0].id, isNewRecord: false, matchType: 'exact', confidence: 1.0 };
  }

  // ── Pass 2: ORCID ──────────────────────────────────────────────────────────
  if (orcid) {
    const byOrcid = await db.query(
      `SELECT id FROM people WHERE orcid = $1 LIMIT 1`,
      [orcid]
    );
    if (byOrcid.rows.length > 0) {
      await recordAlias(byOrcid.rows[0].id, fullName);
      return { personId: byOrcid.rows[0].id, isNewRecord: false, matchType: 'orcid', confidence: 1.0 };
    }
  }

  // ── Pass 3: Known email match ──────────────────────────────────────────────
  if (knownEmail) {
    const byEmail = await db.query(
      `SELECT cm.person_id AS id
       FROM contact_methods cm
       WHERE cm.type = 'email' AND cm.value = $1
       LIMIT 1`,
      [knownEmail]
    );
    if (byEmail.rows.length > 0) {
      await recordAlias(byEmail.rows[0].id, fullName);
      return { personId: byEmail.rows[0].id, isNewRecord: false, matchType: 'email', confidence: 0.95 };
    }
  }

  // ── Pass 4: Last name + first initial within same org ──────────────────────
  if (lastName && orgId) {
    const candidates = await db.query(
      `SELECT p.id, p.first_name, p.last_name, p.normalized_name
       FROM people p
       JOIN trial_people tp ON tp.person_id = p.id
       WHERE tp.organization_id = $1
         AND LOWER(p.last_name) = LOWER($2)
       LIMIT 20`,
      [orgId, lastName]
    );

    for (const row of candidates.rows) {
      if (firstInitialMatches(firstName, row.first_name)) {
        // High confidence: same org + same last name + same first initial
        await recordAlias(row.id, fullName);
        return { personId: row.id, isNewRecord: false, matchType: 'last_name_initial', confidence: 0.85 };
      }
    }
  }

  // ── Pass 5: Token similarity on full name (without org constraint) ─────────
  // Only run this if last name is known — to avoid false positives on short names
  if (lastName.length >= 4) {
    const queryTokens = tokens(normalized);
    const nameCandidates = await db.query(
      `SELECT id, normalized_name, first_name, last_name
       FROM people
       WHERE LOWER(last_name) = LOWER($1)
       LIMIT 50`,
      [lastName]
    );

    let bestId: string | null = null;
    let bestScore = 0;

    for (const row of nameCandidates.rows) {
      const candidateTokens = tokens(row.normalized_name);
      const sim = jaccardSim(queryTokens, candidateTokens);

      // Require >0.6 similarity AND first initial match
      if (sim > 0.6 && firstInitialMatches(firstName, row.first_name) && sim > bestScore) {
        bestScore = sim;
        bestId = row.id;
      }
    }

    if (bestId) {
      await recordAlias(bestId, fullName);
      return { personId: bestId, isNewRecord: false, matchType: 'token_similarity', confidence: bestScore };
    }
  }

  // ── No match found: insert new record ──────────────────────────────────────
  const insertResult = await db.query(
    `INSERT INTO people
       (full_name, first_name, last_name, normalized_name, primary_role,
        primary_institution_id, orcid, alias_names)
     VALUES ($1, $2, $3, $4, 'principal_investigator', $5, $6, $7)
     ON CONFLICT (normalized_name) DO UPDATE
       SET orcid = COALESCE(EXCLUDED.orcid, people.orcid),
           primary_institution_id = COALESCE(EXCLUDED.primary_institution_id, people.primary_institution_id)
     RETURNING id`,
    [fullName, firstName, lastName, normalized, orgId, orcid ?? null, []]
  );

  // Handle race condition: ON CONFLICT means another insert got there first
  let personId = insertResult.rows[0]?.id;
  if (!personId) {
    const fallback = await db.query(
      'SELECT id FROM people WHERE normalized_name = $1 LIMIT 1',
      [normalized]
    );
    personId = fallback.rows[0]?.id;
  }

  return { personId, isNewRecord: true, matchType: 'new', confidence: 1.0 };
}

/** Add a name variant to the alias_names array of an existing person (idempotent). */
async function recordAlias(personId: string, fullName: string): Promise<void> {
  await db.query(
    `UPDATE people
     SET alias_names = array_append(
       array_remove(alias_names, $2),
       $2
     )
     WHERE id = $1
       AND NOT ($2 = ANY(alias_names))`,
    [personId, fullName]
  );
}

/**
 * Recompute influence score and trial/publication counts for a person.
 * Call after linking new trials or publications.
 *
 * Score formula:
 *   trial_count * phase_weight_avg  (capped at 50)
 *   + publication_count * 2        (capped at 40)
 *   + sponsor_diversity_bonus       (up to 10)
 *
 * Max = 100.
 */
export async function recomputeInfluenceScore(personId: string): Promise<void> {
  // Trial count and weighted phase score
  const trialResult = await db.query(
    `SELECT
       COUNT(DISTINCT tp.nct_id) AS trial_count,
       SUM(CASE
         WHEN (t.payload_json->>'phase') ILIKE '%3%' THEN 4
         WHEN (t.payload_json->>'phase') ILIKE '%2%' THEN 2
         ELSE 1
       END) AS phase_weight_sum,
       COUNT(DISTINCT t.sponsor_id) AS sponsor_count
     FROM trial_people tp
     LEFT JOIN trials t ON t.nct_id = tp.nct_id
     WHERE tp.person_id = $1`,
    [personId]
  );

  const row = trialResult.rows[0] ?? {};
  const trialCount = parseInt(row.trial_count, 10) || 0;
  const phaseWeightSum = parseInt(row.phase_weight_sum, 10) || 0;
  const sponsorCount = parseInt(row.sponsor_count, 10) || 0;

  // Publication count (if papers are linked via authors in payload_json)
  const pubResult = await db.query(
    `SELECT COUNT(*) AS pub_count
     FROM papers
     WHERE payload_json->'authors' @> jsonb_build_array(
       (SELECT full_name FROM people WHERE id = $1 LIMIT 1)
     )`,
    [personId]
  );
  const pubCount = parseInt(pubResult.rows[0]?.pub_count, 10) || 0;

  // Score components (each capped)
  const trialScore  = Math.min(phaseWeightSum * 3, 50);
  const pubScore    = Math.min(pubCount * 2, 40);
  const sponsorBonus = Math.min((sponsorCount - 1) * 3, 10);
  const totalScore  = Math.min(trialScore + pubScore + sponsorBonus, 100);

  await db.query(
    `UPDATE people
     SET trial_count = $2,
         publication_count = $3,
         influence_score = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [personId, trialCount, pubCount, totalScore]
  );
}
