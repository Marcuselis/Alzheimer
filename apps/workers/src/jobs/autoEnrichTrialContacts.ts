/**
 * Auto-enrichment cron job.
 *
 * Runs daily. For each trial in the data store:
 *   1. Skip if already enriched within the last N days
 *   2. Skip if a job is already pending/running
 *   3. Enqueue enrichment
 *
 * Also re-queues stale enrichments (older than STALE_DAYS).
 *
 * Trigger conditions (run this job):
 *   - Daily cron (see workers/src/index.ts)
 *   - After a new trial is imported (call triggerAutoEnrichment directly)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { trialContactQueue } from '../workers/trialContactWorker';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

const STALE_DAYS = 30;      // Re-enrich if last enrichment was > 30 days ago
const BATCH_SIZE = 20;      // Max trials to enqueue per cron run (respect web search rate limits)
const PRIORITY_PHASES = ['Phase 3', 'Phase 2/Phase 3', 'Phase 2']; // Enrich these first

interface TrialEntry {
  nct_id: string;
  phase?: string;
  status?: string;
  principal_investigators?: string;
}

async function loadTrialIds(): Promise<TrialEntry[]> {
  // Primary: load from the DB
  const dbResult = await db.query(
    `SELECT t.nct_id,
            t.payload_json->>'phase' AS phase,
            t.payload_json->>'status' AS status
     FROM trials t
     ORDER BY t.payload_json->>'phase' DESC, t.updated_at DESC
     LIMIT 2000`
  ).catch(() => ({ rows: [] as any[] }));

  if (dbResult.rows.length > 0) {
    return dbResult.rows;
  }

  // Fallback: read from the web app JSON file
  const jsonPath = path.join(process.cwd(), '..', 'web', 'data', 'generated', 'trials.json');
  if (!fs.existsSync(jsonPath)) {
    console.warn('[AutoEnrich] No trials source found');
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as TrialEntry[];
  return raw.filter(t => t.principal_investigators); // Only those with PI data
}

async function getEnrichedNctIds(): Promise<Set<string>> {
  const result = await db.query(
    `SELECT DISTINCT nct_id
     FROM enrichment_jobs
     WHERE status = 'done'
       AND finished_at > NOW() - INTERVAL '${STALE_DAYS} days'`
  ).catch(() => ({ rows: [] as any[] }));

  return new Set(result.rows.map((r: any) => r.nct_id));
}

async function getPendingNctIds(): Promise<Set<string>> {
  const result = await db.query(
    `SELECT DISTINCT nct_id
     FROM enrichment_jobs
     WHERE status IN ('pending', 'running')
       AND started_at > NOW() - INTERVAL '2 hours'`
  ).catch(() => ({ rows: [] as any[] }));

  return new Set(result.rows.map((r: any) => r.nct_id));
}

export async function runAutoEnrichment(): Promise<{ queued: number; skipped: number }> {
  console.log('[AutoEnrich] Starting auto-enrichment scan...');

  const [trials, enrichedIds, pendingIds] = await Promise.all([
    loadTrialIds(),
    getEnrichedNctIds(),
    getPendingNctIds(),
  ]);

  // Sort: prioritize high-phase trials
  const sorted = [...trials].sort((a, b) => {
    const aPrio = PRIORITY_PHASES.findIndex(p => a.phase?.includes(p.replace('Phase ', '')));
    const bPrio = PRIORITY_PHASES.findIndex(p => b.phase?.includes(p.replace('Phase ', '')));
    const aIdx = aPrio === -1 ? 999 : aPrio;
    const bIdx = bPrio === -1 ? 999 : bPrio;
    return aIdx - bIdx;
  });

  let queued = 0;
  let skipped = 0;

  for (const trial of sorted) {
    if (queued >= BATCH_SIZE) break;

    if (enrichedIds.has(trial.nct_id) || pendingIds.has(trial.nct_id)) {
      skipped++;
      continue;
    }

    try {
      await trialContactQueue.add(
        'enrich',
        { nctId: trial.nct_id },
        {
          jobId: `contact-enrich:${trial.nct_id}`,
          deduplication: { id: trial.nct_id },
          priority: PRIORITY_PHASES.some(p => trial.phase?.includes(p.replace('Phase ', ''))) ? 1 : 3,
        }
      );
      queued++;
      console.log(`[AutoEnrich] Queued ${trial.nct_id} (phase: ${trial.phase ?? 'unknown'})`);
    } catch (err: any) {
      console.warn(`[AutoEnrich] Failed to queue ${trial.nct_id}:`, err.message);
    }
  }

  console.log(`[AutoEnrich] Done: ${queued} queued, ${skipped} skipped (already enriched/pending)`);
  return { queued, skipped };
}

/**
 * Trigger immediate enrichment for a specific trial (e.g. after new import).
 * Deduplication prevents double-queuing.
 */
export async function triggerEnrichmentForTrial(nctId: string): Promise<void> {
  await trialContactQueue.add(
    'enrich',
    { nctId },
    { jobId: `contact-enrich:${nctId}`, deduplication: { id: nctId } }
  );
  console.log(`[AutoEnrich] Triggered enrichment for ${nctId}`);
}
