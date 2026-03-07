/**
 * News ingest pipeline — Phase 1 & 2
 * Fetches trial changes, publications, sponsor updates, regulatory filings
 * Creates news events tied to internal graph
 */

import { db } from '../../../api/src/db/client';
import fetch from 'node-fetch';

interface NewsIngestResult {
  eventsCreated: number;
  articlesProcessed: number;
  errors: string[];
}

// ── ClinicalTrials.gov ──────────────────────────────────────────────────────

export async function ingestClinicalTrialsChanges(): Promise<NewsIngestResult> {
  const result: NewsIngestResult = {
    eventsCreated: 0,
    articlesProcessed: 0,
    errors: [],
  };

  try {
    console.log('[NewsIngest] Starting ClinicalTrials.gov change detection...');

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
        const existingEvent = await db.query(
          `SELECT id FROM news_events
           WHERE article_id IN (SELECT id FROM news_articles WHERE url LIKE $1)
           LIMIT 1`,
          [`%${trial.nct_id}%`]
        );

        if (existingEvent.rows.length > 0) {
          console.log(`[NewsIngest] News event already exists for ${trial.nct_id}`);
          continue;
        }

        const isNewTrial = trial.updated_at === trial.created_at;
        const eventType = isNewTrial ? 'trial_launched' : 'trial_status_changed';

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

        let importanceScore = 60;
        if (trial.phase?.includes('3')) importanceScore += 20;
        if (trial.phase?.includes('2')) importanceScore += 10;
        if (trial.status === 'RECRUITING') importanceScore += 15;

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
      `[NewsIngest] ClinicalTrials.gov complete: ${result.eventsCreated} events created`
    );
  } catch (err: any) {
    console.error('[NewsIngest] ClinicalTrials.gov ingest failed:', err.message);
    result.errors.push(`ClinicalTrials.gov ingest: ${err.message}`);
  }

  return result;
}

// ── PubMed Publications ─────────────────────────────────────────────────────

export async function ingestPubMedPublications(): Promise<NewsIngestResult> {
  const result: NewsIngestResult = {
    eventsCreated: 0,
    articlesProcessed: 0,
    errors: [],
  };

  try {
    console.log('[NewsIngest] Starting PubMed publication ingest...');

    // Get date range (last 7 days)
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    // Query PubMed for recent Alzheimer's papers
    const query = `Alzheimer AND ("${fromStr}"[PDAT] : "${toStr}"[PDAT])`;
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=50&rettype=json`;

    const searchResponse = await fetch(searchUrl, { timeout: 15000 });
    if (!searchResponse.ok) {
      throw new Error(`PubMed search failed: ${searchResponse.status}`);
    }

    const searchJson: any = await searchResponse.json();
    const pmids = searchJson.esearchresult?.idlist ?? [];

    console.log(`[NewsIngest] Found ${pmids.length} recent Alzheimer papers`);

    for (const pmid of pmids.slice(0, 20)) {
      try {
        // Check if already processed
        const existingArticle = await db.query(
          `SELECT id FROM news_articles WHERE url LIKE $1`,
          [`%pubmed%${pmid}%`]
        );

        if (existingArticle.rows.length > 0) continue;

        // Fetch full paper details
        const detailUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=json`;
        const detailResponse = await fetch(detailUrl, { timeout: 15000 });

        if (!detailResponse.ok) continue;

        const detailJson: any = await detailResponse.json();
        const article = detailJson?.result?.[pmid];
        if (!article) continue;

        const title = article.title || 'Untitled';
        const authors = article.authors?.map((a: any) => a.name).join(', ') || '';
        const summary = article.abstract || title;

        // Create article
        const articleResult = await db.query(
          `INSERT INTO news_articles (source_id, title, url, published_at, summary)
           SELECT
             (SELECT id FROM news_sources WHERE name = 'PubMed' LIMIT 1),
             $1, $2, NOW(), $3
           RETURNING id`,
          [title, `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, summary]
        );

        const articleId = articleResult.rows[0]?.id;
        const importanceScore = 55; // Base score for publications

        // Create news event
        const eventResult = await db.query(
          `INSERT INTO news_events (
             article_id, event_type, title, summary, importance_score,
             event_date, why_it_matters, recommended_action, source_url
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            articleId,
            'publication_published',
            `New publication: ${title}`,
            `${authors}. ${summary.substring(0, 150)}...`,
            importanceScore,
            new Date(),
            'New research on Alzheimer disease',
            'Read publication',
            `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          ]
        );

        const eventId = eventResult.rows[0]?.id;
        if (eventId) {
          result.eventsCreated++;
        }

        result.articlesProcessed++;
      } catch (err: any) {
        console.error(`[NewsIngest] Error processing PubMed ${pmid}:`, err.message);
        result.errors.push(`PubMed ${pmid}: ${err.message}`);
      }
    }

    console.log(`[NewsIngest] PubMed complete: ${result.eventsCreated} events created`);
  } catch (err: any) {
    console.error('[NewsIngest] PubMed ingest failed:', err.message);
    result.errors.push(`PubMed ingest: ${err.message}`);
  }

  return result;
}

// ── FDA/EMA Regulatory Updates ──────────────────────────────────────────────

export async function ingestRegulatoryUpdates(): Promise<NewsIngestResult> {
  const result: NewsIngestResult = {
    eventsCreated: 0,
    articlesProcessed: 0,
    errors: [],
  };

  try {
    console.log('[NewsIngest] Checking for regulatory updates...');

    // Check FDA drug approvals and actions
    // This would integrate with FDA API or RSS feed
    // For now, implement skeleton that monitors known molecules

    const alzheimersApprovals = [
      { name: 'Lecanemab (Leqembi)', agency: 'FDA', date: '2023-01-06' },
      { name: 'Donanemab', agency: 'FDA', status: 'Phase 3' },
    ];

    for (const drug of alzheimersApprovals) {
      try {
        const existingEvent = await db.query(
          `SELECT id FROM news_events
           WHERE title ILIKE $1 AND event_date > NOW() - INTERVAL '30 days'
           LIMIT 1`,
          [`%${drug.name}%`]
        );

        if (existingEvent.rows.length > 0) continue;

        // Would create event here if new regulatory news detected
        // For MVP, just log capability
        console.log(`[NewsIngest] Monitoring ${drug.name} for regulatory updates`);
      } catch (err: any) {
        result.errors.push(`Regulatory check ${drug.name}: ${err.message}`);
      }
    }

    console.log('[NewsIngest] Regulatory check complete');
  } catch (err: any) {
    console.error('[NewsIngest] Regulatory ingest failed:', err.message);
    result.errors.push(`Regulatory ingest: ${err.message}`);
  }

  return result;
}

// ── Run all ingestion jobs ──────────────────────────────────────────────────

export async function runNewsIngest(): Promise<void> {
  console.log('[NewsIngest] Starting complete news ingest pipeline (Phase 1 + 2)...');

  const results = await Promise.all([
    ingestClinicalTrialsChanges(),
    ingestPubMedPublications(),
    ingestRegulatoryUpdates(),
  ]);

  const totalEvents = results.reduce((sum, r) => sum + r.eventsCreated, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  console.log(`[NewsIngest] Complete: ${totalEvents} events created, ${totalErrors} errors`);

  if (totalErrors > 0) {
    console.error('[NewsIngest] Errors:', results.flatMap(r => r.errors));
  }
}
