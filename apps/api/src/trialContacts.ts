/**
 * Trial contacts — read-only DB queries used by the API layer.
 * The enrichment logic lives in the workers package; this file only reads results.
 */

import { db } from './db/client';

export interface EnrichedContactRow {
  personId: string;
  fullName: string;
  firstName: string;
  lastName: string;
  role: string;
  organization: string | null;
  organizationId: string | null;
  domain: string | null;
  email: string | null;
  emailLabel: string | null;
  emailVerificationStatus: string | null;
  emailConfidence: number;
  linkedinUrl: string | null;
  linkedinConfidence: number;
  overallScore: number;
  confidenceLabel: 'high' | 'medium' | 'low';
}

function scoreToLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function computeScore(row: any): number {
  let score = 0;
  const hasPublished = row.email_label === 'published' || row.email_verification_status === 'verified' || row.email_verification_status === 'published';
  const hasInferred = row.email_label === 'inferred' || row.email_verification_status === 'inferred';
  const isCatchAll = row.email_verification_status === 'catch_all';
  const isRejected = row.email_verification_status === 'rejected';

  if (hasPublished) score += 60;
  if (hasInferred && !hasPublished) score -= 25;
  if (isCatchAll) score -= 15;
  if (isRejected) score -= 50;

  if (row.email && row.domain && row.email.endsWith(`@${row.domain}`)) score += 10;
  if (row.org_id) score += 10;
  if (row.linkedin_url) score += 15;
  const liConf = parseFloat(row.linkedin_confidence) || 0;
  if (liConf > 0.6) score += 10;

  return Math.max(0, Math.min(100, score));
}

export async function getEnrichedContactsForTrial(nctId: string): Promise<EnrichedContactRow[]> {
  const result = await db.query(
    `SELECT
       p.id                         AS person_id,
       p.full_name,
       p.first_name,
       p.last_name,
       tp.role,
       tp.raw_affiliation,
       o.name                       AS org_name,
       o.id                         AS org_id,
       o.primary_domain             AS domain,
       cm_email.value               AS email,
       cm_email.label               AS email_label,
       cm_email.verification_status AS email_verification_status,
       cm_email.confidence          AS email_confidence,
       cm_li.value                  AS linkedin_url,
       cm_li.confidence             AS linkedin_confidence
     FROM trial_people tp
     JOIN people p ON p.id = tp.person_id
     LEFT JOIN organizations o ON o.id = tp.organization_id
     LEFT JOIN LATERAL (
       SELECT value, label, verification_status, confidence
       FROM contact_methods
       WHERE person_id = p.id AND type = 'email' AND is_primary = true
       ORDER BY confidence DESC LIMIT 1
     ) cm_email ON TRUE
     LEFT JOIN LATERAL (
       SELECT value, confidence
       FROM contact_methods
       WHERE person_id = p.id AND type = 'linkedin' AND is_primary = true
       ORDER BY confidence DESC LIMIT 1
     ) cm_li ON TRUE
     WHERE tp.nct_id = $1
     ORDER BY cm_email.confidence DESC NULLS LAST`,
    [nctId]
  );

  return result.rows.map(row => {
    const score = computeScore(row);
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
      emailConfidence: parseFloat(row.email_confidence) || 0,
      linkedinUrl: row.linkedin_url,
      linkedinConfidence: parseFloat(row.linkedin_confidence) || 0,
      overallScore: score,
      confidenceLabel: scoreToLabel(score),
    };
  });
}

export interface OpportunityScoreRow {
  score: number;
  phaseScore: number;
  statusScore: number;
  sponsorScore: number;
  investigatorScore: number;
  recencyScore: number;
  explanation: string;
}

export async function getOpportunityScore(nctId: string): Promise<OpportunityScoreRow | null> {
  const result = await db.query(
    `SELECT score, phase_score, status_score, sponsor_score, investigator_score, recency_score, explanation
     FROM trial_opportunity_scores WHERE nct_id = $1`,
    [nctId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    score: r.score,
    phaseScore: r.phase_score,
    statusScore: r.status_score,
    sponsorScore: r.sponsor_score,
    investigatorScore: r.investigator_score,
    recencyScore: r.recency_score,
    explanation: r.explanation,
  };
}

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
