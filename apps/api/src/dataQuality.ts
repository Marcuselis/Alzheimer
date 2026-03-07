import { db } from './db/client';

export interface DataQualityStats {
  enrichmentCoverage: EnrichmentCoverage;
  verificationBreakdown: VerificationBreakdown[];
  catchAllStats: CatchAllStats;
  duplicateStats: DuplicateStats;
  enrichmentQueue: EnrichmentQueueStats;
  topCatchAllDomains: DomainCount[];
  recentJobs: RecentJob[];
}

interface EnrichmentCoverage {
  totalTrials: number;
  enrichedTrials: number;
  coveragePct: number;
  trialsWithContacts: number;
  totalContacts: number;
  trialsWithVerifiedEmail: number;
}

interface VerificationBreakdown {
  status: string;
  count: number;
  pct: number;
}

interface CatchAllStats {
  totalDomains: number;
  catchAllDomains: number;
  catchAllEmails: number;
  catchAllPct: number;
}

interface DuplicateStats {
  totalPeople: number;
  canonicalPeople: number;
  aliasedPeople: number;
  avgTrialsPerPerson: number;
}

interface EnrichmentQueueStats {
  pending: number;
  running: number;
  done: number;
  failed: number;
  staleDone: number; // done but > 30 days ago
}

interface DomainCount {
  domain: string;
  count: number;
}

interface RecentJob {
  nctId: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  contactsFound: number;
}

export async function getDataQualityStats(): Promise<DataQualityStats> {
  const [
    coverageResult,
    verificationResult,
    catchAllResult,
    catchAllDomainsResult,
    duplicateResult,
    queueResult,
    topCatchAllDomainsResult,
    recentJobsResult,
  ] = await Promise.all([
    // Enrichment coverage
    db.query(`
      SELECT
        (SELECT COUNT(*) FROM trials) AS total_trials,
        (SELECT COUNT(DISTINCT nct_id) FROM enrichment_jobs WHERE status = 'done') AS enriched_trials,
        (SELECT COUNT(DISTINCT tp.nct_id) FROM trial_people tp) AS trials_with_contacts,
        (SELECT COUNT(*) FROM contact_methods WHERE type = 'email') AS total_contacts,
        (
          SELECT COUNT(DISTINCT tp.nct_id)
          FROM trial_people tp
          JOIN contact_methods cm ON cm.person_id = tp.person_id
          WHERE cm.type = 'email'
            AND cm.verification_status IN ('published', 'verified')
        ) AS trials_with_verified_email
    `),

    // Verification status breakdown
    db.query(`
      SELECT
        verification_status AS status,
        COUNT(*) AS count
      FROM contact_methods
      WHERE type = 'email'
      GROUP BY verification_status
      ORDER BY count DESC
    `),

    // Catch-all stats
    db.query(`
      SELECT
        COUNT(DISTINCT SUBSTRING(value FROM '@(.+)$')) AS total_domains,
        COUNT(DISTINCT SUBSTRING(value FROM '@(.+)$')) FILTER (WHERE catch_all = true) AS catch_all_domains,
        COUNT(*) FILTER (WHERE verification_status = 'catch_all') AS catch_all_emails
      FROM contact_methods
      WHERE type = 'email'
    `),

    // Per-domain catch-all info (for top domains table)
    db.query(`
      SELECT
        SUBSTRING(value FROM '@(.+)$') AS domain,
        catch_all,
        COUNT(*) AS count
      FROM contact_methods
      WHERE type = 'email'
        AND value IS NOT NULL
      GROUP BY SUBSTRING(value FROM '@(.+)$'), catch_all
      ORDER BY count DESC
      LIMIT 20
    `),

    // Duplicate / identity stats
    db.query(`
      SELECT
        COUNT(*) AS total_people,
        COUNT(*) FILTER (WHERE canonical_person_id IS NULL OR canonical_person_id = id) AS canonical_people,
        COUNT(*) FILTER (WHERE canonical_person_id IS NOT NULL AND canonical_person_id != id) AS aliased_people,
        AVG(trial_count)::numeric(5,1) AS avg_trials_per_person
      FROM people
    `),

    // Queue stats
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'running') AS running,
        COUNT(*) FILTER (WHERE status = 'done' AND finished_at > NOW() - INTERVAL '30 days') AS done,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'done' AND finished_at <= NOW() - INTERVAL '30 days') AS stale_done
      FROM enrichment_jobs
    `),

    // Top catch-all domains
    db.query(`
      SELECT
        SUBSTRING(value FROM '@(.+)$') AS domain,
        COUNT(*) AS count
      FROM contact_methods
      WHERE type = 'email'
        AND verification_status = 'catch_all'
      GROUP BY SUBSTRING(value FROM '@(.+)$')
      ORDER BY count DESC
      LIMIT 10
    `),

    // Recent enrichment jobs
    db.query(`
      SELECT
        ej.nct_id,
        ej.status,
        ej.started_at,
        ej.finished_at,
        COUNT(DISTINCT tp.person_id) AS contacts_found
      FROM enrichment_jobs ej
      LEFT JOIN trial_people tp ON tp.nct_id = ej.nct_id
      GROUP BY ej.nct_id, ej.status, ej.started_at, ej.finished_at
      ORDER BY ej.started_at DESC NULLS LAST
      LIMIT 20
    `),
  ]).catch(err => {
    throw err;
  });

  const cov = coverageResult.rows[0];
  const totalTrials = parseInt(cov.total_trials, 10);
  const enrichedTrials = parseInt(cov.enriched_trials, 10);

  const totalEmails = verificationResult.rows.reduce((s: number, r: any) => s + parseInt(r.count, 10), 0);

  const catchAllRow = catchAllResult.rows[0];
  const catchAllEmails = parseInt(catchAllRow.catch_all_emails, 10);
  const totalDomains = parseInt(catchAllRow.total_domains, 10);

  const dupRow = duplicateResult.rows[0];
  const qRow = queueResult.rows[0];

  return {
    enrichmentCoverage: {
      totalTrials,
      enrichedTrials,
      coveragePct: totalTrials > 0 ? Math.round((enrichedTrials / totalTrials) * 100) : 0,
      trialsWithContacts: parseInt(cov.trials_with_contacts, 10),
      totalContacts: parseInt(cov.total_contacts, 10),
      trialsWithVerifiedEmail: parseInt(cov.trials_with_verified_email, 10),
    },
    verificationBreakdown: verificationResult.rows.map((r: any) => ({
      status: r.status ?? 'unknown',
      count: parseInt(r.count, 10),
      pct: totalEmails > 0 ? Math.round((parseInt(r.count, 10) / totalEmails) * 100) : 0,
    })),
    catchAllStats: {
      totalDomains,
      catchAllDomains: parseInt(catchAllRow.catch_all_domains, 10),
      catchAllEmails,
      catchAllPct: totalEmails > 0 ? Math.round((catchAllEmails / totalEmails) * 100) : 0,
    },
    duplicateStats: {
      totalPeople: parseInt(dupRow?.total_people ?? '0', 10),
      canonicalPeople: parseInt(dupRow?.canonical_people ?? '0', 10),
      aliasedPeople: parseInt(dupRow?.aliased_people ?? '0', 10),
      avgTrialsPerPerson: parseFloat(dupRow?.avg_trials_per_person ?? '0'),
    },
    enrichmentQueue: {
      pending: parseInt(qRow?.pending ?? '0', 10),
      running: parseInt(qRow?.running ?? '0', 10),
      done: parseInt(qRow?.done ?? '0', 10),
      failed: parseInt(qRow?.failed ?? '0', 10),
      staleDone: parseInt(qRow?.stale_done ?? '0', 10),
    },
    topCatchAllDomains: topCatchAllDomainsResult.rows.map((r: any) => ({
      domain: r.domain,
      count: parseInt(r.count, 10),
    })),
    recentJobs: recentJobsResult.rows.map((r: any) => ({
      nctId: r.nct_id,
      status: r.status,
      startedAt: r.started_at?.toISOString() ?? null,
      finishedAt: r.finished_at?.toISOString() ?? null,
      contactsFound: parseInt(r.contacts_found, 10),
    })),
  };
}
