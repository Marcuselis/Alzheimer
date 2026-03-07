/**
 * Opportunity scoring for trials.
 *
 * Score range: 0–100
 * Components:
 *   phase_score        (0–35)  Phase 3 = 35, Phase 2 = 20, Phase 1 = 8, N/A = 0
 *   status_score       (0–30)  Recruiting = 30, Active not recruiting = 15, Completed = 5
 *   sponsor_score      (0–20)  Tier 1 pharma = 20, known sponsor = 10, unknown = 5
 *   investigator_score (0–10)  Max influence score of any PI linked to the trial
 *   recency_score      (0–5)   Updated within 90 days = 5, 180 days = 3, else 1
 *
 * Why this structure:
 *   Phase and recruiting status are the strongest signals of immediate opportunity.
 *   Sponsor tier signals whether a deal is large enough to pursue.
 *   Investigator influence is a proxy for site quality.
 *   Recency guards against stale trials inflating the score.
 */

import { Pool } from 'pg';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

// ── Scoring tables ─────────────────────────────────────────────────────────────

const PHASE_SCORES: Record<string, number> = {
  'phase 3': 35,
  'phase3': 35,
  'phase iii': 35,
  'phase 2/phase 3': 28,
  'phase 2': 20,
  'phase2': 20,
  'phase ii': 20,
  'phase 1/phase 2': 12,
  'phase 1': 8,
  'phase1': 8,
  'phase i': 8,
  'early phase 1': 4,
  'n/a': 2,
  'not applicable': 2,
};

const STATUS_SCORES: Record<string, number> = {
  recruiting: 30,
  'not yet recruiting': 25,
  'active, not recruiting': 15,
  'enrolling by invitation': 20,
  completed: 5,
  terminated: 0,
  suspended: 2,
  withdrawn: 0,
  unknown: 3,
};

// Tier 1: sponsors with major AD programs
const TIER1_SPONSORS = new Set([
  'eisai', 'biogen', 'eli lilly', 'lilly', 'roche', 'genentech', 'ac immune',
  'novo nordisk', 'astrazeneca', 'sanofi', 'johnson & johnson', 'janssen',
  'abbvie', 'ucb', 'prothena', 'anavex life sciences', 'alector', 'denali',
  'bioarctic', 'cassava sciences',
]);

const TIER2_SPONSORS = new Set([
  'novartis', 'pfizer', 'bms', 'bristol-myers squibb', 'bristol myers squibb',
  'merck', 'boehringer ingelheim', 'takeda', 'astellas', 'daiichi sankyo',
]);

function sponsorTier(sponsorName: string): number {
  const lower = sponsorName.toLowerCase().trim();
  if (TIER1_SPONSORS.has(lower)) return 20;
  for (const t1 of TIER1_SPONSORS) {
    if (lower.includes(t1) || t1.includes(lower.split(' ')[0])) return 18;
  }
  if (TIER2_SPONSORS.has(lower)) return 12;
  for (const t2 of TIER2_SPONSORS) {
    if (lower.includes(t2)) return 10;
  }
  // Unknown but named sponsor — could be academic
  return 5;
}

function phaseScore(phase: string): number {
  const lower = phase.toLowerCase().trim();
  return PHASE_SCORES[lower] ?? 2;
}

function statusScore(status: string): number {
  const lower = status.toLowerCase().trim();
  return STATUS_SCORES[lower] ?? STATUS_SCORES['unknown'];
}

function recencyScore(updatedAt: Date | string | null): number {
  if (!updatedAt) return 1;
  const ms = Date.now() - new Date(updatedAt).getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days <= 90)  return 5;
  if (days <= 180) return 3;
  if (days <= 365) return 2;
  return 1;
}

// ── Per-trial scoring ──────────────────────────────────────────────────────────

export interface OpportunityScore {
  nctId: string;
  score: number;
  phaseScore: number;
  statusScore: number;
  sponsorScore: number;
  investigatorScore: number;
  recencyScore: number;
  explanation: string;
}

async function maxInvestigatorInfluence(nctId: string): Promise<number> {
  const result = await db.query(
    `SELECT COALESCE(MAX(p.influence_score), 0) AS max_score
     FROM trial_people tp
     JOIN people p ON p.id = tp.person_id
     WHERE tp.nct_id = $1`,
    [nctId]
  );
  const raw = parseInt(result.rows[0]?.max_score, 10) || 0;
  // Scale to 0–10
  return Math.round((raw / 100) * 10);
}

export async function computeOpportunityScore(trial: {
  nctId: string;
  phase: string;
  status: string;
  sponsor: string;
  updatedAt?: Date | string | null;
}): Promise<OpportunityScore> {
  const ps = phaseScore(trial.phase ?? '');
  const ss = statusScore(trial.status ?? '');
  const sps = sponsorTier(trial.sponsor ?? '');
  const rs = recencyScore(trial.updatedAt ?? null);
  const invScore = await maxInvestigatorInfluence(trial.nctId);

  const total = Math.min(ps + ss + sps + invScore + rs, 100);

  const explanationParts: string[] = [];
  if (ps >= 28) explanationParts.push('Phase 3');
  if (ss >= 25) explanationParts.push('actively recruiting');
  if (sps >= 18) explanationParts.push('Tier 1 sponsor');
  if (invScore >= 7) explanationParts.push('high-influence investigators');
  if (rs >= 4) explanationParts.push('recently updated');

  const explanation = explanationParts.length > 0
    ? explanationParts.join(' · ')
    : 'Standard trial';

  return {
    nctId: trial.nctId,
    score: total,
    phaseScore: ps,
    statusScore: ss,
    sponsorScore: sps,
    investigatorScore: invScore,
    recencyScore: rs,
    explanation,
  };
}

/**
 * Persist a computed score to the DB.
 */
export async function saveOpportunityScore(os: OpportunityScore): Promise<void> {
  await db.query(
    `INSERT INTO trial_opportunity_scores
       (nct_id, score, phase_score, status_score, sponsor_score, investigator_score, recency_score, explanation, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (nct_id) DO UPDATE
       SET score = EXCLUDED.score,
           phase_score = EXCLUDED.phase_score,
           status_score = EXCLUDED.status_score,
           sponsor_score = EXCLUDED.sponsor_score,
           investigator_score = EXCLUDED.investigator_score,
           recency_score = EXCLUDED.recency_score,
           explanation = EXCLUDED.explanation,
           computed_at = NOW()`,
    [os.nctId, os.score, os.phaseScore, os.statusScore, os.sponsorScore, os.investigatorScore, os.recencyScore, os.explanation]
  );
}

/**
 * Compute and save the opportunity score for a single trial (call from enrichment worker).
 */
export async function computeAndSaveOpportunityScore(trial: {
  nctId: string;
  phase: string;
  status: string;
  sponsor: string;
  updatedAt?: Date | string | null;
}): Promise<OpportunityScore> {
  const os = await computeOpportunityScore(trial);
  await saveOpportunityScore(os);
  return os;
}

/**
 * Read the opportunity score for a trial (no computation, just DB lookup).
 */
export async function getOpportunityScore(nctId: string): Promise<OpportunityScore | null> {
  const result = await db.query(
    `SELECT nct_id, score, phase_score, status_score, sponsor_score, investigator_score, recency_score, explanation
     FROM trial_opportunity_scores
     WHERE nct_id = $1`,
    [nctId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    nctId: r.nct_id,
    score: r.score,
    phaseScore: r.phase_score,
    statusScore: r.status_score,
    sponsorScore: r.sponsor_score,
    investigatorScore: r.investigator_score,
    recencyScore: r.recency_score,
    explanation: r.explanation,
  };
}
