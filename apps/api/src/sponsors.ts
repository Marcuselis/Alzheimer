import { db } from './db/client';

export interface SponsorSummary {
  id: string;
  name: string;
  trialCount: number;
  activeTrialCount: number;
  phase3Count: number;
  recruitingCount: number;
  topPhase: string | null;
}

export interface SponsorDetail extends SponsorSummary {
  trials: SponsorTrial[];
  investigators: SponsorInvestigator[];
  phases: PhaseBreakdown[];
  countries: string[];
  interventions: string[];
}

export interface SponsorTrial {
  nctId: string;
  title: string;
  phase: string;
  status: string;
  enrollment: number | null;
  opportunityScore: number | null;
}

export interface SponsorInvestigator {
  personId: string;
  fullName: string;
  influenceScore: number;
  trialCount: number;
  primaryOrg: string | null;
  primaryEmail: string | null;
}

export interface PhaseBreakdown {
  phase: string;
  count: number;
}

export async function listSponsors(opts: {
  limit?: number;
  minTrials?: number;
  search?: string;
}): Promise<SponsorSummary[]> {
  const { limit = 100, minTrials = 1, search } = opts;

  const searchClause = search ? `AND s.name ILIKE $3` : '';
  const params: any[] = [limit, minTrials];
  if (search) params.push(`%${search}%`);

  const result = await db.query(
    `SELECT
       s.id,
       s.name,
       COUNT(t.nct_id) AS trial_count,
       COUNT(t.nct_id) FILTER (WHERE t.payload_json->>'status' ILIKE '%recruiting%') AS active_trial_count,
       COUNT(t.nct_id) FILTER (
         WHERE t.payload_json->>'phase' ILIKE '%Phase 3%'
            OR t.payload_json->>'phase' ILIKE '%Phase III%'
       ) AS phase3_count,
       COUNT(t.nct_id) FILTER (WHERE LOWER(t.payload_json->>'status') = 'recruiting') AS recruiting_count,
       (
         SELECT t2.payload_json->>'phase'
         FROM trials t2
         WHERE t2.sponsor_id = s.id
           AND t2.payload_json->>'phase' IS NOT NULL
         ORDER BY
           CASE
             WHEN t2.payload_json->>'phase' ILIKE '%Phase 3%' OR t2.payload_json->>'phase' ILIKE '%Phase III%' THEN 1
             WHEN t2.payload_json->>'phase' ILIKE '%Phase 2%' OR t2.payload_json->>'phase' ILIKE '%Phase II%' THEN 2
             WHEN t2.payload_json->>'phase' ILIKE '%Phase 1%' OR t2.payload_json->>'phase' ILIKE '%Phase I%' THEN 3
             ELSE 4
           END
         LIMIT 1
       ) AS top_phase
     FROM sponsors s
     LEFT JOIN trials t ON t.sponsor_id = s.id
     WHERE 1=1 ${searchClause}
     GROUP BY s.id, s.name
     HAVING COUNT(t.nct_id) >= $2
     ORDER BY COUNT(t.nct_id) FILTER (WHERE t.payload_json->>'status' ILIKE '%recruiting%') DESC,
              COUNT(t.nct_id) DESC
     LIMIT $1`,
    params
  );

  return result.rows.map(r => ({
    id: r.id,
    name: r.name,
    trialCount: parseInt(r.trial_count, 10),
    activeTrialCount: parseInt(r.active_trial_count, 10),
    phase3Count: parseInt(r.phase3_count, 10),
    recruitingCount: parseInt(r.recruiting_count, 10),
    topPhase: r.top_phase ?? null,
  }));
}

export async function getSponsorDetail(sponsorId: string): Promise<SponsorDetail | null> {
  // Basic info + counts
  const summaryRows = await listSponsors({ minTrials: 0, search: undefined, limit: 1 });
  // Fetch by id directly
  const sponsorResult = await db.query(
    `SELECT
       s.id,
       s.name,
       COUNT(t.nct_id) AS trial_count,
       COUNT(t.nct_id) FILTER (WHERE t.payload_json->>'status' ILIKE '%recruiting%') AS active_trial_count,
       COUNT(t.nct_id) FILTER (
         WHERE t.payload_json->>'phase' ILIKE '%Phase 3%'
            OR t.payload_json->>'phase' ILIKE '%Phase III%'
       ) AS phase3_count,
       COUNT(t.nct_id) FILTER (WHERE LOWER(t.payload_json->>'status') = 'recruiting') AS recruiting_count
     FROM sponsors s
     LEFT JOIN trials t ON t.sponsor_id = s.id
     WHERE s.id = $1
     GROUP BY s.id, s.name`,
    [sponsorId]
  );

  if (sponsorResult.rows.length === 0) return null;
  const sr = sponsorResult.rows[0];

  // Trials
  const trialsResult = await db.query(
    `SELECT
       t.nct_id,
       t.payload_json->>'title' AS title,
       t.payload_json->>'phase' AS phase,
       t.payload_json->>'status' AS status,
       (t.payload_json->>'enrollment')::int AS enrollment,
       tos.score AS opportunity_score
     FROM trials t
     LEFT JOIN trial_opportunity_scores tos ON tos.nct_id = t.nct_id
     WHERE t.sponsor_id = $1
     ORDER BY tos.score DESC NULLS LAST, t.updated_at DESC
     LIMIT 100`,
    [sponsorId]
  );

  // Investigators linked to this sponsor's trials
  const investigatorsResult = await db.query(
    `SELECT DISTINCT ON (p.id)
       p.id AS person_id,
       p.full_name,
       p.influence_score,
       p.trial_count,
       o.name AS primary_org,
       (
         SELECT cm.value
         FROM contact_methods cm
         JOIN trial_people tp2 ON tp2.person_id = p.id
         WHERE cm.person_id = p.id
           AND cm.type = 'email'
           AND cm.verification_status IN ('published', 'verified')
         ORDER BY
           CASE cm.verification_status WHEN 'published' THEN 1 WHEN 'verified' THEN 2 ELSE 3 END
         LIMIT 1
       ) AS primary_email
     FROM people p
     JOIN trial_people tp ON tp.person_id = p.id
     JOIN trials t ON t.nct_id = tp.nct_id
     LEFT JOIN organizations o ON o.id = p.primary_institution_id
     WHERE t.sponsor_id = $1
       AND (p.canonical_person_id IS NULL OR p.canonical_person_id = p.id)
     ORDER BY p.id, p.influence_score DESC`,
    [sponsorId]
  );

  // Phase breakdown
  const phasesResult = await db.query(
    `SELECT
       t.payload_json->>'phase' AS phase,
       COUNT(*) AS count
     FROM trials t
     WHERE t.sponsor_id = $1
       AND t.payload_json->>'phase' IS NOT NULL
     GROUP BY t.payload_json->>'phase'
     ORDER BY count DESC`,
    [sponsorId]
  );

  // Countries
  const countriesResult = await db.query(
    `SELECT DISTINCT tl.country
     FROM trial_locations tl
     JOIN trials t ON t.nct_id = tl.nct_id
     WHERE t.sponsor_id = $1
       AND tl.country IS NOT NULL
     ORDER BY tl.country`,
    [sponsorId]
  );

  // Interventions (molecules)
  const interventionsResult = await db.query(
    `SELECT DISTINCT t.payload_json->>'interventionsText' AS intervention
     FROM trials t
     WHERE t.sponsor_id = $1
       AND t.payload_json->>'interventionsText' IS NOT NULL
     LIMIT 20`,
    [sponsorId]
  );

  return {
    id: sr.id,
    name: sr.name,
    trialCount: parseInt(sr.trial_count, 10),
    activeTrialCount: parseInt(sr.active_trial_count, 10),
    phase3Count: parseInt(sr.phase3_count, 10),
    recruitingCount: parseInt(sr.recruiting_count, 10),
    topPhase: null,
    trials: trialsResult.rows.map(r => ({
      nctId: r.nct_id,
      title: r.title ?? '',
      phase: r.phase ?? '',
      status: r.status ?? '',
      enrollment: r.enrollment ?? null,
      opportunityScore: r.opportunity_score ?? null,
    })),
    investigators: investigatorsResult.rows.map(r => ({
      personId: r.person_id,
      fullName: r.full_name,
      influenceScore: r.influence_score ?? 0,
      trialCount: r.trial_count ?? 0,
      primaryOrg: r.primary_org ?? null,
      primaryEmail: r.primary_email ?? null,
    })),
    phases: phasesResult.rows.map(r => ({
      phase: r.phase,
      count: parseInt(r.count, 10),
    })),
    countries: countriesResult.rows.map(r => r.country),
    interventions: interventionsResult.rows
      .map(r => r.intervention as string)
      .filter(Boolean),
  };
}
