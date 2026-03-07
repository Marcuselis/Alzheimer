/**
 * News ingest pipeline
 * Fetches trial changes, publications, and sponsor updates
 * Creates news events tied to internal graph
 */

import { db } from '../../db/client';
import fetch from 'node-fetch';

interface NewsIngestResult {
  eventsCreated: number;
  articlesProcessed: number;
  errors: string[];
}

/**
 * Detect new/changed trials from ClinicalTrials.gov
 * and create news events for trial launches and status changes
 */
export async function ingestClinicalTrialsChanges(): Promise<NewsIngestResult> {
  const result: NewsIngestResult = {
    eventsCreated: 0,
    articlesProcessed: 0,
    errors: [],
  };

  try {
    console.log('[NewsIngest] Starting ClinicalTrials.gov change detection...');

    // Get trials added/modified in last 7 days from our database
    const recentTrialsResult = await db.query(
      `SELECT
         nct_id,
         payload_json->>'title' AS title,
         payload_json->>'status' AS status,
         payload_json->>'phase' AS phase,
         created_at,
         updated_at
       FROM trials
       WHERE updated_at > NOW() - INTERVAL '7 days'
       ORDER BY updated_at DESC
       LIMIT 50`
    );

    console.log(`[NewsIngest] Found ${recentTrialsResult.rows.length} recently modified trials`);

    for (const trial of recentTrialsResult.rows) {
      try {
        // Check if we already have a news event for this trial
        const existingEvent = await db.query(
          `SELECT id FROM news_events
           WHERE article_id IN (
             SELECT id FROM news_articles WHERE url LIKE $1
           )
           LIMIT 1`,
          [`%${trial.nct_id}%`]
        );

        if (existingEvent.rows.length > 0) {
          console.log(`[NewsIngest] News event already exists for ${trial.nct_id}`);
          continue;
        }

        // Determine event type
        const isNewTrial = trial.updated_at === trial.created_at;
        const eventType = isNewTrial ? 'trial_launched' : 'trial_status_changed';

        // Create article entry
        const articleResult = await db.query(
          `INSERT INTO news_articles (source_id, title, url, published_at, summary)
           SELECT
             (SELECT id FROM news_sources WHERE name = 'ClinicalTrials.gov' LIMIT 1),
             $1, $2, $3, $4
           RETURNING id`,
          [
            trial.title || trial.nct_id,
            `https://clinicaltrials.gov/study/${trial.nct_id}`,
            trial.updated_at,
            `${trial.phase} phase trial - Status: ${trial.status}`,
          ]
        );

        const articleId = articleResult.rows[0]?.id;

        // Determine importance score
        let importanceScore = 60;
        if (trial.phase?.includes('3')) importanceScore += 20;
        if (trial.phase?.includes('2')) importanceScore += 10;
        if (trial.status === 'RECRUITING') importanceScore += 15;

        // Create news event
        const eventResult = await db.query(
          `INSERT INTO news_events (
             article_id, event_type, title, summary, importance_score,
             event_date, why_it_matters, recommended_action, source_url
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            articleId,
            eventType,
            eventType === 'trial_launched'
              ? `New ${trial.phase} Alzheimer's trial started`
              : `Trial ${trial.nct_id} status changed to ${trial.status}`,
            `${trial.title || trial.nct_id} - ${trial.status}`,
            Math.min(importanceScore, 100),
            trial.updated_at,
            `${trial.phase} phase trial${trial.status === 'RECRUITING' ? ' now recruiting' : ''}`,
            'View trial details',
            `https://clinicaltrials.gov/study/${trial.nct_id}`,
          ]
        );

        const eventId = eventResult.rows[0]?.id;

        // Link to trial entity
        if (eventId) {
          await db.query(
            `INSERT INTO news_event_entities (news_event_id, entity_type, entity_id, entity_name)
             VALUES ($1, $2, $3, $4)`,
            [eventId, 'trial', trial.nct_id, trial.title || trial.nct_id]
          );
          result.eventsCreated++;
        }

        result.articlesProcessed++;
      } catch (err: any) {
        console.error(`[NewsIngest] Error processing trial ${trial.nct_id}:`, err.message);
        result.errors.push(`Trial ${trial.nct_id}: ${err.message}`);
      }
    }

    console.log(
      `[NewsIngest] ClinicalTrials.gov complete: ${result.eventsCreated} events created, ${result.articlesProcessed} articles processed`
    );
  } catch (err: any) {
    console.error('[NewsIngest] ClinicalTrials.gov ingest failed:', err.message);
    result.errors.push(`ClinicalTrials.gov ingest: ${err.message}`);
  }

  return result;
}

/**
 * Ingest new Alzheimer's publications from PubMed
 */
export async function ingestPubMedPublications(): Promise<NewsIngestResult> {
  const result: NewsIngestResult = {
    eventsCreated: 0,
    articlesProcessed: 0,
    errors: [],
  };

  try {
    console.log('[NewsIngest] Starting PubMed publication ingest...');

    // Query PubMed for recent Alzheimer's papers
    const pubmedQuery = 'Alzheimer disease[MeSH] AND ("2026/02/01"[PDAT] : "2026/03/07"[PDAT])';
    const pubmedUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(pubmedQuery)}&retmax=10&rettype=json&api_key=${process.env.NCBI_API_KEY || ''}`;

    const response = await fetch(pubmedUrl, { timeout: 15000 });
    if (!response.ok) {
      throw new Error(`PubMed API returned ${response.status}`);
    }

    // Note: PubMed returns XML by default, this is simplified
    // In production, would parse XML and fetch full records
    console.log('[NewsIngest] PubMed API called (simplified - would need XML parsing)');

    // For MVP, skip detailed parsing
    result.articlesProcessed = 0;
  } catch (err: any) {
    console.error('[NewsIngest] PubMed ingest failed:', err.message);
    result.errors.push(`PubMed ingest: ${err.message}`);
  }

  return result;
}

/**
 * Run all news ingest jobs
 */
export async function runNewsIngest(): Promise<void> {
  console.log('[NewsIngest] Starting news ingest pipeline...');

  const clinicalTrialsResult = await ingestClinicalTrialsChanges();
  const pubmedResult = await ingestPubMedPublications();

  const totalEvents = clinicalTrialsResult.eventsCreated + pubmedResult.eventsCreated;
  const totalErrors = clinicalTrialsResult.errors.length + pubmedResult.errors.length;

  console.log(
    `[NewsIngest] Complete: ${totalEvents} events created, ${totalErrors} errors`
  );

  if (totalErrors > 0) {
    console.error('[NewsIngest] Errors:', [
      ...clinicalTrialsResult.errors,
      ...pubmedResult.errors,
    ]);
  }
}
