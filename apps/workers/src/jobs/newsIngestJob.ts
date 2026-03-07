/**
 * News ingest job — runs daily to fetch and classify news events
 * Tier 1: ClinicalTrials.gov, PubMed
 * Tier 2: Sponsor newsrooms, regulatory updates (future)
 */

import { runNewsIngest } from '../enrich/newsIngest';

export async function runDailyNewsIngest(): Promise<void> {
  const startTime = Date.now();
  console.log('[NewsIngestJob] Starting daily news ingest...');

  try {
    await runNewsIngest();
    const duration = Date.now() - startTime;
    console.log(`[NewsIngestJob] Daily news ingest completed in ${duration}ms`);
  } catch (err: any) {
    console.error('[NewsIngestJob] Failed:', err.message);
    throw err;
  }
}
