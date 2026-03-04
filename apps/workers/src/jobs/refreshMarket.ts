import { Pool } from 'pg';
import fetch from 'node-fetch';
import { computeContactsForSponsor, storeContactsForSponsor } from '../enrich/contactDiscovery';

// Local utilities (no dependency on @app/api)
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function exponentialBackoff(attempt: number, baseDelayMs: number = 1000, maxDelayMs: number = 30000): Promise<void> {
  const delay = Math.min(
    baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
    maxDelayMs
  );
  await sleep(delay);
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

function normalizePhase(rawPhase: string): 'PHASE2' | 'PHASE23' | 'PHASE3' | 'OTHER' {
  if (!rawPhase) return 'OTHER';
  const upper = rawPhase.toUpperCase();
  if (upper.includes('PHASE 3') || upper.includes('PHASE III')) {
    return 'PHASE3';
  }
  if (upper.includes('PHASE 2/3') || upper.includes('PHASE II/III') || upper.includes('PHASE23')) {
    return 'PHASE23';
  }
  if (upper.includes('PHASE 2') || upper.includes('PHASE II')) {
    return 'PHASE2';
  }
  return 'OTHER';
}

function extractRoute(text: string): 'oral' | 'iv' | 'sc' | 'infusion' | 'mixed' {
  const lower = text.toLowerCase();
  if (lower.includes('infusion') || (lower.includes('iv') && !lower.includes('oral'))) {
    return 'infusion';
  }
  if (lower.includes('subcutaneous') || lower.includes(' sc ') || lower.endsWith(' sc')) {
    return 'sc';
  }
  if (lower.includes('oral')) {
    return 'oral';
  }
  return 'mixed';
}

function computeBurdenScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  if (lower.includes('pet') || lower.includes('positron')) score += 2;
  if (lower.includes('mri') || lower.includes('magnetic resonance')) score += 2;
  if (lower.includes('infusion') || lower.includes(' iv ')) score += 1;
  if (lower.includes('aria')) score += 1;
  return Math.min(score, 6);
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

const CT_API_V2_BASE = 'https://clinicaltrials.gov/api/v2/studies';

// Rate limiting
const RATE_LIMIT_DELAY_MS = 100; // 10 requests/second max
let lastRequestTime = 0;

async function rateLimitedFetch(url: string, options: any = {}, retries: number = 3): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
    await sleep(RATE_LIMIT_DELAY_MS - timeSinceLastRequest);
  }
  
  lastRequestTime = Date.now();
  
  let attempt = 0;
  while (attempt < retries) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          ...options.headers,
        },
        timeout: 30000,
      } as any);
      
      if (response.ok) {
        return response;
      }
      
      if (response.status === 429) {
        // Rate limited - exponential backoff
        await exponentialBackoff(attempt, 2000, 30000);
        attempt++;
        continue;
      }
      
      throw new Error(`CT.gov API error: ${response.status}`);
    } catch (error: any) {
      attempt++;
      if (attempt >= retries) throw error;
      
      await exponentialBackoff(attempt, 1000, 10000);
    }
  }
  
  throw new Error('Max retries exceeded');
}

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

export async function refreshMarket(
  marketDefinitionIdOrIndication: string,
  phaseRange?: string[],
  options?: { quickMode?: boolean }
): Promise<{
  status: string;
  trialsProcessed: number;
  error?: string;
}> {
  const quickMode = options?.quickMode || false;
  // Support both market ID and indication string
  let marketDefinitionId = marketDefinitionIdOrIndication;
  
  // If it's an indication string, find or create market
  if (!marketDefinitionId.startsWith('market_')) {
    const indication = marketDefinitionIdOrIndication;
    const phases = phaseRange || ['PHASE2', 'PHASE23', 'PHASE3'];
    
    // Find existing market or create default
    const findResult = await db.query(
      'SELECT id FROM market_definitions WHERE indication_key = $1 LIMIT 1',
      [indication.toLowerCase()]
    );
    
    if (findResult.rows.length > 0) {
      marketDefinitionId = findResult.rows[0].id;
    } else {
      // Create default market for indication
      marketDefinitionId = `market_${indication.toLowerCase().replace(/\s+/g, '_')}_phase23`;
      const defaultDef = {
        id: marketDefinitionId,
        key: indication.toLowerCase().replace(/\s+/g, '_'),
        indicationKey: indication.toLowerCase(),
        ctgovConditionQuery: `("${indication}" OR "${indication}'s")`,
        phaseRange: phases,
        statuses: ['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION', 'NOT_YET_RECRUITING', 'COMPLETED'],
        updatedWithinDays: 30,
        geography: null,
      };
      
      await db.query(`
        INSERT INTO market_definitions (id, key, indication_key, ctgov_condition_query, phase_range, statuses, updated_within_days, geography, definition_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `, [
        defaultDef.id,
        defaultDef.key,
        defaultDef.indicationKey,
        defaultDef.ctgovConditionQuery,
        defaultDef.phaseRange,
        defaultDef.statuses,
        defaultDef.updatedWithinDays,
        defaultDef.geography,
        JSON.stringify(defaultDef),
      ]);
    }
  }
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
    
    // Build CT.gov query - sanitize to remove invalid characters
    let query = (definition.ctgovConditionQuery || '').replace(/[\[\]{}]/g, '');
    
    // Fallback if query is empty
    if (!query.trim()) {
      query = '("Alzheimer Disease" OR "Alzheimer")';
    }
    
    // Note: CT.gov API v2 doesn't support the complex filter syntax we were using
    // Phase and status filters need to use the proper API v2 query parameters
    // For now, we only filter by condition and let the API handle pagination
    // TODO: Add proper filter.advanced parameters for phase/status filtering
    
    console.log(`[Market Refresh] Query: ${query}`);
    
    // Fetch studies (paginated)
    const fields = 'NCTId,BriefTitle,OverallStatus,Phase,StartDate,PrimaryCompletionDate,CompletionDate,EnrollmentCount,LeadSponsorName,CollaboratorName,Condition,InterventionName,InterventionType,LocationCountry,LastUpdatePostDate';
    
    let totalProcessed = 0;
    let minRank = 1;
    // Quick mode: process 200 studies for fast initial load (2-3 min instead of 15+ min)
    // Full mode: process up to 1000 studies for complete refresh
    const maxRank = quickMode ? 200 : 1000;
    const pageSize = 100;
    
    while (minRank <= maxRank) {
      const url = `${CT_QUERY_BASE}?expr=${encodeURIComponent(query)}&fields=${fields}&min_rnk=${minRank}&max_rnk=${Math.min(minRank + pageSize - 1, maxRank)}&fmt=json`;
      
      console.log(`[Market Refresh] Fetching page ${minRank}-${Math.min(minRank + pageSize - 1, maxRank)}`);
      
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 30000,
      } as any);
      
      if (!response.ok) {
        throw new Error(`CT.gov API error: ${response.status}`);
      }
      
      const jsonData: any = await response.json();
      const studies = jsonData.StudyFieldsResponse?.StudyFields || [];
      const totalFound = jsonData.StudyFieldsResponse?.NStudiesFound || 0;
      
      if (studies.length === 0) break;
      
      // OPTIMIZATION: Batch check existing trials upfront
      const nctIds = studies
        .map(s => s.FieldValues?.NCTId?.[0])
        .filter(Boolean);
      
      const existingTrialsResult = await db.query(
        'SELECT nct_id, updated_source_date FROM trials WHERE nct_id = ANY($1)',
        [nctIds]
      );
      const existingTrials = new Map(
        existingTrialsResult.rows.map(r => [r.nct_id, r.updated_source_date])
      );
      
      // OPTIMIZATION: Batch normalize sponsors upfront
      const sponsorNames = new Set<string>();
      studies.forEach(study => {
        const sponsor = study.FieldValues?.LeadSponsorName?.[0];
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
        
        // Create missing sponsors in bulk
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
      
      // Prepare bulk insert data
      const rawPayloadsToInsert: any[] = [];
      const trialsToInsert: any[] = [];
      const metadataToInsert: any[] = [];
      const locationsToInsert: any[] = [];
      const flagsToInsert: any[] = [];
      const marketTrialsToInsert: any[] = [];
      
      // Process each study (now just preparing data, no DB calls)
      for (const study of studies) {
        const fields = study.FieldValues || {};
        const getFirst = (arr: any[]) => Array.isArray(arr) && arr.length > 0 ? arr[0] : '';
        
        const nctId = getFirst(fields.NCTId);
        if (!nctId) continue;
        
        const sourceUpdatedAt = getFirst(fields.LastUpdatePostDate);
        
        // Check if we need to refetch (idempotency check) - using pre-fetched data
        const existingDate = existingTrials.get(nctId);
        if (existingDate && sourceUpdatedAt) {
          if (new Date(sourceUpdatedAt) <= existingDate) {
            // Skip - no update needed
            continue;
          }
        }
        
        // Prepare raw payload
        const rawPayload = {
          nctId,
          fields: study.FieldValues,
          raw: study,
        };
        rawPayloadsToInsert.push({
          id: `raw_${nctId}`,
          source: 'clinicaltrials.gov',
          sourceKey: nctId,
          sourceUpdatedAt: sourceUpdatedAt ? new Date(sourceUpdatedAt) : null,
          payload: JSON.stringify(rawPayload),
        });
        
        // Get sponsor ID from pre-normalized map
        const rawSponsor = getFirst(fields.LeadSponsorName);
        const normalizedSponsorName = normalizeSponsorName(rawSponsor);
        const sponsorId = sponsorMap.get(normalizedSponsorName) || 'unknown';
        
        // Normalize phase
        const rawPhase = getFirst(fields.Phase);
        const phaseEnum = normalizePhase(rawPhase);
        
        const enrollment = parseInt(getFirst(fields.EnrollmentCount) || '0', 10);
        const startDate = getFirst(fields.StartDate);
        const primaryCompletionDate = getFirst(fields.PrimaryCompletionDate);
        const completionDate = getFirst(fields.CompletionDate);
        
        const trialPayload = {
          nctId,
          title: getFirst(fields.BriefTitle),
          status: getFirst(fields.OverallStatus),
          phase: rawPhase,
          enrollment,
          sponsor: rawSponsor,
          conditions: fields.Condition || [],
          interventionsText: (fields.InterventionName || []).join(', '),
          startDate,
          primaryCompletionDate,
          completionDate,
        };
        
        // Prepare trial data for bulk insert
        trialsToInsert.push({
          id: `trial_${nctId}`,
          programId: null,
          sponsorId,
          nctId,
          payload: JSON.stringify(trialPayload),
          updatedSourceDate: getFirst(fields.LastUpdatePostDate) ? new Date(getFirst(fields.LastUpdatePostDate)) : null,
        });
        
        // Prepare metadata for bulk insert
        metadataToInsert.push({
          nctId,
          startDate: startDate ? new Date(startDate) : null,
          primaryCompletionDate: primaryCompletionDate ? new Date(primaryCompletionDate) : null,
          completionDate: completionDate ? new Date(completionDate) : null,
          enrollment: enrollment > 0 ? enrollment : null,
        });
        
        // Prepare locations for bulk insert
        const countries = fields.LocationCountry || [];
        countries.forEach((country: string) => {
          locationsToInsert.push({ nctId, countryCode: country, countryName: country });
        });
        
        // Compute flags using normalization utilities
        const allText = [
          getFirst(fields.BriefTitle),
          (fields.InterventionName || []).join(' '),
          (fields.Condition || []).join(' '),
        ].join(' ').toLowerCase();
        
        const flags = {
          has_pet: allText.includes('pet') || allText.includes('positron'),
          has_mri: allText.includes('mri') || allText.includes('magnetic resonance'),
          has_infusion: allText.includes('infusion') || allText.includes('iv'),
          mentions_aria: allText.includes('aria'),
          has_biomarker: allText.includes('biomarker') || allText.includes('amyloid') || allText.includes('tau'),
          route_enum: extractRoute(allText),
          burden_score: computeBurdenScore(allText),
        };
        
        // Prepare flags for bulk insert
        flagsToInsert.push({
          nctId,
          ...flags,
        });
        
        // Prepare market trial link for bulk insert
        marketTrialsToInsert.push({ marketId: marketDefinitionId, nctId });
        
        totalProcessed++;
      }
      
      // OPTIMIZATION: Bulk insert all data in a transaction for speed
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        
        // Bulk insert raw payloads
        if (rawPayloadsToInsert.length > 0) {
          for (const r of rawPayloadsToInsert) {
            await client.query(`
              INSERT INTO raw_source_payloads (id, source, source_key, source_updated_at, fetched_at, payload_json)
              VALUES ($1, $2, $3, $4, NOW(), $5::jsonb)
              ON CONFLICT (source, source_key) DO UPDATE SET
                source_updated_at = EXCLUDED.source_updated_at,
                fetched_at = NOW(),
                payload_json = EXCLUDED.payload_json
            `, [r.id, r.source, r.sourceKey, r.sourceUpdatedAt, r.payload]);
          }
        }
        
        // Bulk insert trials
        if (trialsToInsert.length > 0) {
          for (const t of trialsToInsert) {
            await client.query(`
              INSERT INTO trials (id, program_id, sponsor_id, nct_id, payload_json, source, fetched_at, updated_source_date)
              VALUES ($1, $2, $3, $4, $5::jsonb, 'clinicaltrials.gov', NOW(), $6)
              ON CONFLICT (nct_id) DO UPDATE SET
                payload_json = EXCLUDED.payload_json,
                sponsor_id = EXCLUDED.sponsor_id,
                fetched_at = NOW(),
                updated_source_date = EXCLUDED.updated_source_date
            `, [t.id, t.programId, t.sponsorId, t.nctId, t.payload, t.updatedSourceDate]);
          }
        }
        
        // Bulk insert metadata
        if (metadataToInsert.length > 0) {
          for (const m of metadataToInsert) {
            await client.query(`
              INSERT INTO trial_metadata (nct_id, start_date, primary_completion_date, completion_date, enrollment, endpoints_text, eligibility_criteria)
              VALUES ($1, $2, $3, $4, $5, '', '')
              ON CONFLICT (nct_id) DO UPDATE SET
                start_date = EXCLUDED.start_date,
                primary_completion_date = EXCLUDED.primary_completion_date,
                completion_date = EXCLUDED.completion_date,
                enrollment = EXCLUDED.enrollment,
                updated_at = NOW()
            `, [m.nctId, m.startDate, m.primaryCompletionDate, m.completionDate, m.enrollment]);
          }
        }
        
        // Bulk insert locations
        if (locationsToInsert.length > 0) {
          for (const l of locationsToInsert) {
            await client.query(`
              INSERT INTO trial_locations (nct_id, country_code, country_name)
              VALUES ($1, $2, $3)
              ON CONFLICT (nct_id, country_code) DO NOTHING
            `, [l.nctId, l.countryCode, l.countryName]);
          }
        }
        
        // Bulk insert flags
        if (flagsToInsert.length > 0) {
          for (const f of flagsToInsert) {
            await client.query(`
              INSERT INTO trial_flags (nct_id, has_pet, has_mri, has_infusion, mentions_aria, has_biomarker, route_enum, burden_score)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (nct_id) DO UPDATE SET
                has_pet = EXCLUDED.has_pet,
                has_mri = EXCLUDED.has_mri,
                has_infusion = EXCLUDED.has_infusion,
                mentions_aria = EXCLUDED.mentions_aria,
                has_biomarker = EXCLUDED.has_biomarker,
                route_enum = EXCLUDED.route_enum,
                burden_score = EXCLUDED.burden_score,
                updated_at = NOW()
            `, [f.nctId, f.has_pet, f.has_mri, f.has_infusion, f.mentions_aria, f.has_biomarker, f.route_enum, f.burden_score]);
          }
        }
        
        // Bulk insert market trials
        if (marketTrialsToInsert.length > 0) {
          for (const m of marketTrialsToInsert) {
            await client.query(`
              INSERT INTO market_trials (market_id, nct_id)
              VALUES ($1, $2)
              ON CONFLICT (market_id, nct_id) DO NOTHING
            `, [m.marketId, m.nctId]);
          }
        }
        
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
      if (minRank + pageSize > totalFound) break;
      minRank += pageSize;
    }
    
    // Update market state
    await db.query(`
      INSERT INTO market_state (market_id, last_refresh_at, last_success_at, coverage_counts_json)
      VALUES ($1, NOW(), NOW(), $2)
      ON CONFLICT (market_id) DO UPDATE SET
        last_refresh_at = NOW(),
        last_success_at = NOW(),
        coverage_counts_json = $2,
        last_error = NULL,
        updated_at = NOW()
    `, [marketDefinitionId, JSON.stringify({
      trialsProcessed: totalProcessed,
      timestamp: new Date().toISOString(),
    })]);
    
    // Refresh materialized views synchronously so data is immediately available
    console.log(`[Market Refresh] Refreshing materialized views for market ${marketDefinitionId}...`);
    try {
      await refreshMarketRollups(marketDefinitionId);
      console.log(`[Market Refresh] Materialized views refreshed successfully`);
    } catch (err) {
      console.error('[Market Refresh] Rollup error:', err);
      // Don't fail the entire refresh if rollups fail, but log it
    }
    
    // Compute contact discovery for all sponsors in market (best-effort, non-blocking)
    console.log(`[Market Refresh] Computing contact discovery for market ${marketDefinitionId}...`);
    try {
      await computeContactDiscoveryForMarket(marketDefinitionId);
      console.log(`[Market Refresh] Contact discovery completed successfully`);
    } catch (err) {
      console.error('[Market Refresh] Contact discovery error:', err);
      // Don't fail the entire refresh if contact discovery fails, but log it
    }
    
    return { status: 'completed', trialsProcessed: totalProcessed };
  } catch (error: any) {
    console.error('[Market Refresh] Error:', error);
    
    // Update state with error and partial results
    const sourcesStatus = {
      ctgov: 'error' as const,
      pubmed: 'skipped' as const,
      websignals: 'skipped' as const,
    };
    
    await db.query(`
      INSERT INTO market_state (market_id, last_refresh_at, last_error, coverage_counts_json)
      VALUES ($1, NOW(), $2, $3)
      ON CONFLICT (market_id) DO UPDATE SET
        last_refresh_at = NOW(),
        last_error = $2,
        coverage_counts_json = $3,
        updated_at = NOW()
    `, [
      marketDefinitionId,
      error.message,
      JSON.stringify({
        trialsProcessed: totalProcessed || 0,
        timestamp: new Date().toISOString(),
        sourcesStatus,
        error: error.message,
      }),
    ]);
    
    return { 
      status: 'error', 
      trialsProcessed: totalProcessed || 0, 
      error: error.message,
      sourcesStatus,
    };
  }
}

async function normalizeSponsor(normalizedName: string): Promise<string> {
  if (!normalizedName || normalizedName === 'unknown') {
    return 'unknown';
  }
  
  // Check if sponsor exists (by normalized name)
  const result = await db.query('SELECT id FROM sponsors WHERE name = $1', [normalizedName]);
  if (result.rows.length > 0) {
    return result.rows[0].id;
  }
  
  // Create new sponsor
  const sponsorId = `sponsor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await db.query('INSERT INTO sponsors (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [sponsorId, normalizedName]);
  
  // Re-query in case of race condition
  const checkResult = await db.query('SELECT id FROM sponsors WHERE name = $1', [normalizedName]);
  return checkResult.rows[0]?.id || sponsorId;
}

export async function refreshMarketRollups(marketId: string) {
  console.log(`[Market Refresh] Computing rollups for market ${marketId}`);
  
  // Sponsor rollup
  await db.query(`
    INSERT INTO mv_market_sponsor_rollup (
      market_id, sponsor_id, phase3_active_count, phase2_active_count,
      total_active_count, median_enrollment, countries_count, burden_score,
      last_trial_update_date, top_conditions_json, top_interventions_json,
      pressure_score, why_now_snippet, evidence_link_count
    )
    SELECT
      mt.market_id,
      t.sponsor_id,
      COUNT(*) FILTER (WHERE t.payload_json->>'status' LIKE '%Recruiting%' AND (t.payload_json->>'phase' LIKE '%Phase 3%' OR t.payload_json->>'phase' LIKE '%Phase III%')) as phase3_active,
      COUNT(*) FILTER (WHERE t.payload_json->>'status' LIKE '%Recruiting%' AND (t.payload_json->>'phase' LIKE '%Phase 2%' OR t.payload_json->>'phase' LIKE '%Phase II%')) as phase2_active,
      COUNT(*) FILTER (WHERE t.payload_json->>'status' LIKE '%Recruiting%') as total_active,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (t.payload_json->>'enrollment')::int) FILTER (WHERE (t.payload_json->>'enrollment')::int > 0) as median_enroll,
      COUNT(DISTINCT tl.country_code) as countries,
      COALESCE(SUM(tf.burden_score), 0) as burden,
      MAX(t.updated_source_date) as last_update,
      jsonb_agg(DISTINCT t.payload_json->'conditions') FILTER (WHERE t.payload_json->'conditions' IS NOT NULL) as top_conditions,
      jsonb_agg(DISTINCT t.payload_json->'interventionsText') FILTER (WHERE t.payload_json->'interventionsText' IS NOT NULL) as top_interventions,
      0 as pressure, -- computed below
      '' as why_now,
      COUNT(*) as evidence_count
    FROM market_trials mt
    JOIN trials t ON mt.nct_id = t.nct_id
    LEFT JOIN trial_flags tf ON t.nct_id = tf.nct_id
    LEFT JOIN trial_locations tl ON t.nct_id = tl.nct_id
    WHERE mt.market_id = $1
    GROUP BY mt.market_id, t.sponsor_id
    ON CONFLICT (market_id, sponsor_id) DO UPDATE SET
      phase3_active_count = EXCLUDED.phase3_active_count,
      phase2_active_count = EXCLUDED.phase2_active_count,
      total_active_count = EXCLUDED.total_active_count,
      median_enrollment = EXCLUDED.median_enrollment,
      countries_count = EXCLUDED.countries_count,
      burden_score = EXCLUDED.burden_score,
      last_trial_update_date = EXCLUDED.last_trial_update_date,
      top_conditions_json = EXCLUDED.top_conditions_json,
      top_interventions_json = EXCLUDED.top_interventions_json,
      evidence_link_count = EXCLUDED.evidence_link_count,
      updated_at = NOW()
  `, [marketId]);
  
  // Compute pressure scores
  // Get max values for normalization
  const maxResult = await db.query(`
    SELECT
      MAX(phase3_active_count) as max_phase3,
      MAX(total_active_count) as max_total,
      MAX(countries_count) as max_countries,
      MAX(median_enrollment) as max_enrollment,
      MAX(burden_score) as max_burden
    FROM mv_market_sponsor_rollup
    WHERE market_id = $1
  `, [marketId]);
  
  const maxes = maxResult.rows[0] || {};
  
  await db.query(`
    UPDATE mv_market_sponsor_rollup
    SET
      pressure_score = LEAST(100, GREATEST(0,
        25 * CASE WHEN $2 > 0 THEN phase3_active_count::float / $2 ELSE 0 END +
        20 * CASE WHEN $3 > 0 THEN total_active_count::float / $3 ELSE 0 END +
        15 * CASE WHEN $4 > 0 THEN countries_count::float / $4 ELSE 0 END +
        15 * CASE WHEN $5 > 0 THEN median_enrollment::float / $5 ELSE 0 END +
        15 * CASE WHEN $6 > 0 THEN burden_score::float / $6 ELSE 0 END +
        10 * CASE WHEN last_trial_update_date > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END
      )::int),
      why_now_snippet = CASE
        WHEN phase3_active_count > 0 THEN 'Active Phase III trials with ' || countries_count || ' countries'
        WHEN total_active_count > 0 THEN 'Active trials with ' || total_active_count || ' studies'
        ELSE 'Recent market activity'
      END
    WHERE market_id = $1
  `, [
    marketId,
    maxes.max_phase3 || 1,
    maxes.max_total || 1,
    maxes.max_countries || 1,
    maxes.max_enrollment || 1,
    maxes.max_burden || 1,
  ]);
  
  console.log(`[Market Refresh] Rollups completed for market ${marketId}`);
}

async function computeContactDiscoveryForMarket(marketId: string) {
  console.log(`[Market Refresh] Computing contact discovery for market ${marketId}`);
  
  // Get all sponsors with persona recommendations
  // If no persona recommendations exist yet, skip contact discovery
  const sponsorsResult = await db.query(`
    SELECT DISTINCT 
      pr.sponsor_id,
      pr.pain_owner_persona,
      pr.decision_owner_persona,
      s.name as sponsor_name
    FROM persona_recommendations pr
    JOIN sponsors s ON pr.sponsor_id = s.id
    WHERE pr.market_id = $1
  `, [marketId]);
  
  const sponsors = sponsorsResult.rows;
  
  if (sponsors.length === 0) {
    console.log(`[Market Refresh] No persona recommendations found for market ${marketId}, skipping contact discovery`);
    return;
  }
  
  console.log(`[Market Refresh] Found ${sponsors.length} sponsors to compute contacts for`);
  
  for (const row of sponsors) {
    const sponsorId = row.sponsor_id;
    const sponsorName = row.sponsor_name;
    
    try {
      // Compute contacts (best-effort, may fail silently)
      const contacts = await computeContactsForSponsor({
        sponsorId,
        marketId,
        sponsorName,
        personaRoles: {
          painOwnerPersona: row.pain_owner_persona,
          decisionOwnerPersona: row.decision_owner_persona,
        },
      });
      
      // Store contacts
      await storeContactsForSponsor(
        sponsorId,
        marketId,
        {
          painOwnerPersona: row.pain_owner_persona,
          decisionOwnerPersona: row.decision_owner_persona,
        },
        contacts
      );
      
      const totalContacts = contacts.pain_owner.length + contacts.decision_owner.length;
      console.log(`[Market Refresh] Contacts computed for sponsor ${sponsorId}: ${totalContacts} candidates`);
    } catch (error: any) {
      console.error(`[Market Refresh] Error computing contacts for sponsor ${sponsorId}:`, error.message);
      // Continue with other sponsors - this is best-effort
    }
  }
  
  console.log(`[Market Refresh] Contact discovery completed for market ${marketId}`);
}
