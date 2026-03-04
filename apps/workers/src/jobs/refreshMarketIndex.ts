import { Pool } from 'pg';
import fetch from 'node-fetch';

// Local utilities
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeSponsorName(rawName: string): string {
  if (!rawName) return 'unknown';
  let normalized = rawName
    .trim()
    .replace(/\s*,\s*Inc\.?/i, '')
    .replace(/\s*Inc\.?/i, '')
    .replace(/\s*LLC\.?/i, '')
    .replace(/\s*Ltd\.?/i, '')
    .replace(/\s*Corp\.?/i, '')
    .replace(/\s*Corporation/i, '')
    .trim();
  const variations: Record<string, string> = {
    'biogen inc': 'Biogen',
    'eli lilly': 'Eli Lilly',
    'eli lilly and company': 'Eli Lilly',
    'roche': 'Roche',
    'novartis': 'Novartis',
  };
  const lower = normalized.toLowerCase();
  if (variations[lower]) {
    return variations[lower];
  }
  return normalized
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

const CT_API_V2_BASE = 'https://clinicaltrials.gov/api/v2/studies';

interface MarketDefinition {
  id: string;
  key: string;
  indicationKey: string;
  ctgovConditionQuery: string;
  phaseRange: string[];
  statuses: string[];
  updatedWithinDays: number | null;
  geography: string[] | null;
}

/**
 * VAIHE 1: Index Pull - Kevyt, nopea, koko markkina
 * Hakee vain tärkeimmät kentät yhdellä sivutetulla haulla
 */
export async function refreshMarketIndex(
  marketDefinitionId: string,
  options?: { quickMode?: boolean; job?: any; startTime?: number }
): Promise<{
  status: string;
  trialsProcessed: number;
  nctIdsNeedingDetail: string[];
  error?: string;
}> {
  try {
    // Load market definition
    const defResult = await db.query('SELECT * FROM market_definitions WHERE id = $1', [marketDefinitionId]);
    if (defResult.rows.length === 0) {
      throw new Error(`Market definition not found: ${marketDefinitionId}`);
    }
    
    const definition: MarketDefinition = defResult.rows[0].definition_json;
    
    // Check last refresh
    const stateResult = await db.query('SELECT * FROM market_state WHERE market_id = $1', [marketDefinitionId]);
    const lastSuccess = stateResult.rows[0]?.last_success_at;
    
    // Build CT.gov query - SIMPLIFIED to avoid 404 errors
    // Sanitize the query to remove any invalid characters for CT.gov API v2
    let query = definition.ctgovConditionQuery || '';
    
    // Remove brackets which are not valid in CT.gov condition queries
    query = query.replace(/[\[\]{}]/g, '');
    
    // Ensure the query is not empty
    if (!query.trim()) {
      // Fallback to a simple Alzheimer query
      query = '("Alzheimer Disease" OR "Alzheimer")';
    }
    
    console.log(`[Index Pull] Query: ${query}`);
    
    let totalProcessed = 0;
    const maxTrials = options?.quickMode ? 200 : 1000; // Quick: 200, Full: 1000
    const pageSize = 100;
    const nctIdsNeedingDetail: string[] = [];
    
    // Batch check existing trials upfront
    const allNctIds: string[] = [];
    let nextPageToken: string | null = null;
    let pagesProcessed = 0;
    
    // Use CT.gov API v2 with pagination
    while (totalProcessed < maxTrials) {
      const url = nextPageToken
        ? `${CT_API_V2_BASE}?query.cond=${encodeURIComponent(query)}&pageSize=${pageSize}&pageToken=${nextPageToken}`
        : `${CT_API_V2_BASE}?query.cond=${encodeURIComponent(query)}&pageSize=${pageSize}`;
      
      console.log(`[Index Pull] Fetching: ${url}`);
      console.log(`[Index Pull] Page ${pagesProcessed + 1} (trials: ${totalProcessed}/${maxTrials})`);
      
      // Report progress to job
      if (options?.job) {
        const progressPercent = 20 + Math.floor((totalProcessed / maxTrials) * 50); // 20-70%
        const elapsedMs = options.startTime ? Date.now() - options.startTime : undefined;
        await options.job.updateProgress({
          percent: progressPercent,
          stage: 'fetching',
          message: `Fetching from CT.gov: page ${pagesProcessed + 1} (${totalProcessed}/${maxTrials} trials)`,
          source: 'CT.gov',
          trialsProcessed: totalProcessed,
          maxTrials,
          ...(elapsedMs != null && { elapsedMs }),
        });
      }
      
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlzheimerAnalyst/1.0)' },
        timeout: 30000,
      } as any);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Index Pull] API returned ${response.status}: ${errorText}`);
        throw new Error(`CT.gov API error: ${response.status}`);
      }
      
      const jsonData: any = await response.json();
      const studies = jsonData.studies || [];
      nextPageToken = jsonData.nextPageToken || null;
      
      console.log(`[Index Pull] Received ${studies.length} studies, nextPageToken: ${nextPageToken ? 'YES' : 'NO'}`);
      
      if (studies.length === 0) {
        console.log('[Index Pull] No studies returned, breaking loop');
        break;
      }
      
      // Rate limit: avoid 429 from CT.gov (be polite between page requests)
      if (pagesProcessed > 0) await sleep(200);
      
      // Extract NCT IDs from v2 API response
      const pageNctIds = studies
        .map((s: any) => s.protocolSection?.identificationModule?.nctId)
        .filter(Boolean);
      allNctIds.push(...pageNctIds);
      
      if (allNctIds.length >= pageSize || studies.length < pageSize) {
        // Batch check existing trials
        const existingTrialsResult = await db.query(
          'SELECT nct_id, updated_source_date, detail_fetched_at FROM trials WHERE nct_id = ANY($1)',
          [allNctIds]
        );
        const existingTrials = new Map(
          existingTrialsResult.rows.map(r => [
            r.nct_id,
            { updatedSourceDate: r.updated_source_date, detailFetchedAt: r.detail_fetched_at }
          ])
        );
        
        // Batch normalize sponsors (v2 API format)
        const sponsorNames = new Set<string>();
        studies.forEach((study: any) => {
          const sponsor = study.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name;
          if (sponsor) {
            sponsorNames.add(normalizeSponsorName(sponsor));
          }
        });
        
        const sponsorMap = new Map<string, string>();
        if (sponsorNames.size > 0) {
          const existingSponsors = await db.query(
            'SELECT id, name FROM sponsors WHERE name = ANY($1)',
            [Array.from(sponsorNames)]
          );
          existingSponsors.rows.forEach(r => sponsorMap.set(r.name, r.id));
          
          // Create missing sponsors
          const missingSponsors = Array.from(sponsorNames).filter(name => !sponsorMap.has(name));
          for (const name of missingSponsors) {
            const sponsorId = `sponsor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await db.query(
              'INSERT INTO sponsors (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
              [sponsorId, name]
            );
            const checkResult = await db.query('SELECT id FROM sponsors WHERE name = $1', [name]);
            sponsorMap.set(name, checkResult.rows[0]?.id || sponsorId);
          }
        }
        
        // Prepare index data
        const indexDataToInsert: any[] = [];
        const trialsToInsert: any[] = [];
        const marketTrialsToInsert: any[] = [];
        
        for (const study of studies) {
          // Parse v2 API response structure
          const protocol = study.protocolSection || {};
          const identification = protocol.identificationModule || {};
          const status = protocol.statusModule || {};
          const design = protocol.designModule || {};
          const sponsors = protocol.sponsorCollaboratorsModule || {};
          const conditions = protocol.conditionsModule || {};
          const arms = protocol.armsInterventionsModule || {};
          
          const nctId = identification.nctId;
          if (!nctId) continue;
          
          const sourceUpdatedAt = status.lastUpdatePostDateStruct?.date;
          const existing = existingTrials.get(nctId);
          
          // Check if we need detail fetch
          const needsDetail = !existing?.detailFetchedAt || 
            (sourceUpdatedAt && existing.updatedSourceDate && 
             new Date(sourceUpdatedAt) > existing.updatedSourceDate);
          
          if (needsDetail) {
            nctIdsNeedingDetail.push(nctId);
          }
          
          // Skip if no update needed (idempotency)
          if (existing?.updatedSourceDate && sourceUpdatedAt) {
            if (new Date(sourceUpdatedAt) <= existing.updatedSourceDate) {
              continue; // No update needed
            }
          }
          
          // Prepare index JSON from v2 API structure
          const indexData = {
            nctId,
            title: identification.briefTitle || '',
            status: status.overallStatus || '',
            phase: design.phases?.[0] || '',
            startDate: status.startDateStruct?.date || null,
            primaryCompletionDate: status.primaryCompletionDateStruct?.date || null,
            completionDate: status.completionDateStruct?.date || null,
            enrollment: design.enrollmentInfo?.count || 0,
            sponsor: sponsors.leadSponsor?.name || '',
            conditions: conditions.conditions || [],
            interventions: arms.interventions?.map((i: any) => i.name) || [],
            lastUpdatePostDate: sourceUpdatedAt,
          };
          
          const rawSponsor = sponsors.leadSponsor?.name || '';
          const normalizedSponsorName = normalizeSponsorName(rawSponsor);
          const sponsorId = sponsorMap.get(normalizedSponsorName) || 'unknown';
          
          indexDataToInsert.push({
            nctId,
            indexData: JSON.stringify(indexData),
            sponsorId,
            updatedSourceDate: sourceUpdatedAt ? new Date(sourceUpdatedAt) : null,
          });
          
          trialsToInsert.push({
            id: `trial_${nctId}`,
            sponsorId,
            nctId,
          });
          
          marketTrialsToInsert.push({ marketId: marketDefinitionId, nctId });
          
          totalProcessed++;
        }
        
        // Bulk insert in transaction (batched for fewer round-trips)
        const client = await db.connect();
        const BATCH = 30;
        try {
          await client.query('BEGIN');
          
          for (let b = 0; b < indexDataToInsert.length; b += BATCH) {
            const chunk = indexDataToInsert.slice(b, b + BATCH);
            const values: any[] = [];
            const placeholders: string[] = [];
            chunk.forEach((item, i) => {
              const off = i * 5;
              placeholders.push(`($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}::jsonb, $${off + 5})`);
              values.push(`trial_${item.nctId}`, item.sponsorId, item.nctId, item.indexData, item.updatedSourceDate);
            });
            await client.query(`
              INSERT INTO trials (id, sponsor_id, nct_id, payload_json, index_json, updated_source_date, source, fetched_at)
              SELECT v.id, v.sponsor_id, v.nct_id, v.payload_json, v.payload_json, v.updated_source_date, 'clinicaltrials.gov', NOW()
              FROM (VALUES ${placeholders.join(', ')}) AS v(id, sponsor_id, nct_id, payload_json, updated_source_date)
              ON CONFLICT (nct_id) DO UPDATE SET
                index_json = EXCLUDED.index_json,
                payload_json = EXCLUDED.payload_json,
                sponsor_id = EXCLUDED.sponsor_id,
                updated_source_date = EXCLUDED.updated_source_date,
                fetched_at = NOW()
            `, values);
          }
          
          for (let b = 0; b < marketTrialsToInsert.length; b += BATCH) {
            const chunk = marketTrialsToInsert.slice(b, b + BATCH);
            const values: any[] = [];
            const placeholders: string[] = [];
            chunk.forEach((m, i) => {
              const off = i * 2;
              placeholders.push(`($${off + 1}, $${off + 2})`);
              values.push(m.marketId, m.nctId);
            });
            await client.query(`
              INSERT INTO market_trials (market_id, nct_id)
              VALUES ${placeholders.join(', ')}
              ON CONFLICT (market_id, nct_id) DO NOTHING
            `, values);
          }
          
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        
        // Reset for next batch
        allNctIds.length = 0;
      }
      
      pagesProcessed++;
      
      // Stop if we hit the limit or no more pages
      if (totalProcessed >= maxTrials || !nextPageToken) break;
    }
    
    // Update market state
    await db.query(`
      INSERT INTO market_state (market_id, last_refresh_at, last_success_at, index_coverage_json)
      VALUES ($1, NOW(), NOW(), $2)
      ON CONFLICT (market_id) DO UPDATE SET
        last_refresh_at = NOW(),
        last_success_at = NOW(),
        index_coverage_json = $2,
        last_error = NULL,
        updated_at = NOW()
    `, [marketDefinitionId, JSON.stringify({
      trialsProcessed: totalProcessed,
      nctIdsNeedingDetail: nctIdsNeedingDetail.length,
      timestamp: new Date().toISOString(),
    })]);
    
    console.log(`[Index Pull] Completed: ${totalProcessed} trials, ${nctIdsNeedingDetail.length} need detail`);
    
    return {
      status: 'completed',
      trialsProcessed: totalProcessed,
      nctIdsNeedingDetail,
    };
  } catch (error: any) {
    console.error('[Index Pull] Error:', error.message || error);
    console.error('[Index Pull] Stack:', error.stack);
    
    await db.query(`
      INSERT INTO market_state (market_id, last_refresh_at, last_error, index_coverage_json)
      VALUES ($1, NOW(), $2, $3)
      ON CONFLICT (market_id) DO UPDATE SET
        last_refresh_at = NOW(),
        last_error = $2,
        index_coverage_json = $3,
        updated_at = NOW()
    `, [
      marketDefinitionId,
      error.message,
      JSON.stringify({ error: error.message, timestamp: new Date().toISOString() }),
    ]);
    
    return {
      status: 'error',
      trialsProcessed: 0,
      nctIdsNeedingDetail: [],
      error: error.message,
    };
  }
}
