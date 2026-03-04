import { Pool } from 'pg';
import { aactQuery } from '../../../api/src/db/aactClient';

/**
 * Import Alzheimer Phase II-III Trials from AACT Warehouse
 * 
 * This ETL job extracts Alzheimer's disease trials from the AACT
 * warehouse and populates our application database tables.
 * 
 * Process:
 * 1. Query AACT for Alzheimer Phase 2/3 trials
 * 2. Normalize data into our schema
 * 3. Upsert trials, sponsors, and metadata
 * 4. Compute market rollups
 */

const appDb = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

interface AACTStudy {
  nct_id: string;
  brief_title: string;
  overall_status: string;
  phase: string;
  enrollment: number;
  start_date: Date | null;
  primary_completion_date: Date | null;
  completion_date: Date | null;
  sponsor_name: string;
  study_first_submitted_date: Date | null;
  last_update_submitted_date: Date | null;
}

function normalizeSponsorName(rawName: string): string {
  if (!rawName) return 'Unknown';
  
  let normalized = rawName
    .trim()
    .replace(/\s*,\s*Inc\.?/i, '')
    .replace(/\s*Inc\.?/i, '')
    .replace(/\s*LLC\.?/i, '')
    .replace(/\s*Ltd\.?/i, '')
    .replace(/\s*Corp\.?/i, '')
    .replace(/\s*Corporation/i, '')
    .trim();
  
  // Known variations
  const variations: Record<string, string> = {
    'biogen inc': 'Biogen',
    'biogen': 'Biogen',
    'eli lilly': 'Eli Lilly',
    'eli lilly and company': 'Eli Lilly',
    'roche': 'Roche',
    'novartis': 'Novartis',
    'pfizer': 'Pfizer',
    'eisai': 'Eisai',
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
  if (upper.includes('PHASE 2/3') || upper.includes('PHASE II/III') || upper.includes('PHASE 2/PHASE 3')) {
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

/**
 * Main import function
 */
export async function importAlzheimersFromAACT(options?: {
  marketId?: string;
  limit?: number;
}): Promise<{
  status: string;
  trialsProcessed: number;
  error?: string;
}> {
  const marketId = options?.marketId || 'market_alzheimer_phase23';
  const limit = options?.limit || 5000;
  
  console.log(`[AACT Import] Starting import for market ${marketId}`);
  console.log(`[AACT Import] Query limit: ${limit} studies`);
  
  let totalProcessed = 0;
  
  try {
    // Step A: Query AACT for Alzheimer Phase II-III trials
    console.log('[AACT Import] Querying AACT database...');
    
    const aactStudies = await aactQuery(`
      SELECT DISTINCT
        s.nct_id,
        s.brief_title,
        s.overall_status,
        s.phase,
        s.enrollment,
        s.start_date,
        s.primary_completion_date,
        s.completion_date,
        sp.name as sponsor_name,
        s.study_first_submitted_date,
        s.last_update_submitted_date
      FROM studies s
      LEFT JOIN sponsors sp ON sp.nct_id = s.nct_id AND sp.lead_or_collaborator = 'lead'
      WHERE
        (
          s.phase ILIKE '%Phase 2%' 
          OR s.phase ILIKE '%Phase 3%'
          OR s.phase ILIKE '%Phase II%'
          OR s.phase ILIKE '%Phase III%'
        )
        AND (
          s.brief_title ILIKE '%Alzheimer%'
          OR EXISTS (
            SELECT 1 FROM conditions c
            WHERE c.nct_id = s.nct_id
            AND (
              c.name ILIKE '%Alzheimer%'
              OR c.downcase_name ILIKE '%alzheimer%'
            )
          )
        )
      ORDER BY s.last_update_submitted_date DESC NULLS LAST
      LIMIT $1
    `, [limit]);
    
    const studies = aactStudies.rows as AACTStudy[];
    console.log(`[AACT Import] Found ${studies.length} Alzheimer Phase II-III trials`);
    
    if (studies.length === 0) {
      console.log('[AACT Import] No studies found - possibly AACT not loaded yet');
      return { status: 'completed', trialsProcessed: 0 };
    }
    
    // Step B: Normalize and upsert into our schema
    console.log('[AACT Import] Normalizing and upserting studies...');
    
    // Pre-normalize sponsors in bulk
    const sponsorNames = new Set<string>();
    studies.forEach(study => {
      const normalized = normalizeSponsorName(study.sponsor_name);
      sponsorNames.add(normalized);
    });
    
    const sponsorMap = new Map<string, string>();
    
    // Get existing sponsors
    const existingSponsors = await appDb.query(
      'SELECT id, name FROM sponsors WHERE name = ANY($1)',
      [Array.from(sponsorNames)]
    );
    existingSponsors.rows.forEach(r => sponsorMap.set(r.name, r.id));
    
    // Create missing sponsors
    const missingSponsors = Array.from(sponsorNames).filter(name => !sponsorMap.has(name));
    for (const name of missingSponsors) {
      const sponsorId = `sponsor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await appDb.query(
        'INSERT INTO sponsors (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [sponsorId, name]
      );
      const checkResult = await appDb.query('SELECT id FROM sponsors WHERE name = $1', [name]);
      sponsorMap.set(name, checkResult.rows[0]?.id || sponsorId);
    }
    
    console.log(`[AACT Import] Processed ${sponsorMap.size} unique sponsors`);
    
    // Step C: Upsert trials in bulk transaction
    const client = await appDb.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const study of studies) {
        const nctId = study.nct_id;
        const normalizedSponsorName = normalizeSponsorName(study.sponsor_name);
        const sponsorId = sponsorMap.get(normalizedSponsorName) || 'unknown';
        
        // Fetch additional data from AACT for this study
        const conditionsResult = await aactQuery(
          'SELECT name FROM conditions WHERE nct_id = $1',
          [nctId]
        );
        const conditions = conditionsResult.rows.map(r => r.name);
        
        const interventionsResult = await aactQuery(
          'SELECT name, intervention_type FROM interventions WHERE nct_id = $1',
          [nctId]
        );
        const interventions = interventionsResult.rows.map(r => r.name);
        const interventionsText = interventions.join(', ');
        
        const facilitiesResult = await aactQuery(
          'SELECT DISTINCT country FROM facilities WHERE nct_id = $1',
          [nctId]
        );
        const countries = facilitiesResult.rows.map(r => r.country);
        
        // Build trial payload
        const trialPayload = {
          nctId,
          title: study.brief_title,
          status: study.overall_status,
          phase: study.phase,
          enrollment: study.enrollment || 0,
          sponsor: study.sponsor_name,
          conditions,
          interventionsText,
          startDate: study.start_date,
          primaryCompletionDate: study.primary_completion_date,
          completionDate: study.completion_date,
        };
        
        // Upsert trial
        await client.query(`
          INSERT INTO trials (
            id, program_id, sponsor_id, nct_id, payload_json,
            source, fetched_at, updated_source_date
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, 'aact', NOW(), $6)
          ON CONFLICT (nct_id) DO UPDATE SET
            payload_json = EXCLUDED.payload_json,
            sponsor_id = EXCLUDED.sponsor_id,
            source = EXCLUDED.source,
            fetched_at = NOW(),
            updated_source_date = EXCLUDED.updated_source_date
        `, [
          `trial_${nctId}`,
          null,
          sponsorId,
          nctId,
          JSON.stringify(trialPayload),
          study.last_update_submitted_date,
        ]);
        
        // Upsert raw payload
        await client.query(`
          INSERT INTO raw_source_payloads (
            id, source, source_key, source_updated_at, fetched_at, payload_json
          )
          VALUES ($1, 'aact', $2, $3, NOW(), $4::jsonb)
          ON CONFLICT (source, source_key) DO UPDATE SET
            source_updated_at = EXCLUDED.source_updated_at,
            fetched_at = NOW(),
            payload_json = EXCLUDED.payload_json
        `, [
          `raw_${nctId}`,
          nctId,
          study.last_update_submitted_date,
          JSON.stringify({ nctId, study, conditions, interventions, countries }),
        ]);
        
        // Upsert metadata
        await client.query(`
          INSERT INTO trial_metadata (
            nct_id, start_date, primary_completion_date,
            completion_date, enrollment
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (nct_id) DO UPDATE SET
            start_date = EXCLUDED.start_date,
            primary_completion_date = EXCLUDED.primary_completion_date,
            completion_date = EXCLUDED.completion_date,
            enrollment = EXCLUDED.enrollment,
            updated_at = NOW()
        `, [
          nctId,
          study.start_date,
          study.primary_completion_date,
          study.completion_date,
          study.enrollment || null,
        ]);
        
        // Upsert locations
        for (const country of countries) {
          if (!country) continue;
          
          await client.query(`
            INSERT INTO trial_locations (nct_id, country_code, country_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (nct_id, country_code) DO NOTHING
          `, [nctId, country, country]);
        }
        
        // Compute and upsert flags
        const allText = [
          study.brief_title,
          interventionsText,
          conditions.join(' '),
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
        
        await client.query(`
          INSERT INTO trial_flags (
            nct_id, has_pet, has_mri, has_infusion, mentions_aria,
            has_biomarker, route_enum, burden_score
          )
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
        `, [
          nctId,
          flags.has_pet,
          flags.has_mri,
          flags.has_infusion,
          flags.mentions_aria,
          flags.has_biomarker,
          flags.route_enum,
          flags.burden_score,
        ]);
        
        // Link to market
        await client.query(`
          INSERT INTO market_trials (market_id, nct_id)
          VALUES ($1, $2)
          ON CONFLICT (market_id, nct_id) DO NOTHING
        `, [marketId, nctId]);
        
        totalProcessed++;
      }
      
      await client.query('COMMIT');
      console.log(`[AACT Import] Successfully imported ${totalProcessed} trials`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
    // Step D: Compute market rollups
    console.log('[AACT Import] Computing market rollups...');
    await computeMarketRollups(marketId);
    
    // Update market state
    await appDb.query(`
      INSERT INTO market_state (
        market_id, last_refresh_at, last_success_at, coverage_counts_json
      )
      VALUES ($1, NOW(), NOW(), $2)
      ON CONFLICT (market_id) DO UPDATE SET
        last_refresh_at = NOW(),
        last_success_at = NOW(),
        coverage_counts_json = $2,
        last_error = NULL,
        updated_at = NOW()
    `, [
      marketId,
      JSON.stringify({
        trialsProcessed: totalProcessed,
        source: 'aact',
        timestamp: new Date().toISOString(),
      }),
    ]);
    
    console.log(`[AACT Import] Import completed successfully`);
    
    return {
      status: 'completed',
      trialsProcessed: totalProcessed,
    };
    
  } catch (error: any) {
    console.error('[AACT Import] Error:', error);
    
    // Update market state with error
    await appDb.query(`
      INSERT INTO market_state (market_id, last_refresh_at, last_error)
      VALUES ($1, NOW(), $2)
      ON CONFLICT (market_id) DO UPDATE SET
        last_refresh_at = NOW(),
        last_error = $2,
        updated_at = NOW()
    `, [marketId, error.message]);
    
    return {
      status: 'error',
      trialsProcessed: totalProcessed,
      error: error.message,
    };
  }
}

/**
 * Compute market rollups (sponsor stats, pressure scores, etc.)
 */
async function computeMarketRollups(marketId: string) {
  console.log(`[AACT Import] Computing rollups for market ${marketId}`);
  
  // Sponsor rollup
  await appDb.query(`
    INSERT INTO mv_market_sponsor_rollup (
      market_id, sponsor_id, phase3_active_count, phase2_active_count,
      total_active_count, median_enrollment, countries_count, burden_score,
      last_trial_update_date, top_conditions_json, top_interventions_json,
      pressure_score, why_now_snippet, evidence_link_count
    )
    SELECT
      mt.market_id,
      t.sponsor_id,
      COUNT(*) FILTER (WHERE (t.payload_json->>'status' ILIKE '%Recruiting%' OR t.payload_json->>'status' ILIKE '%Active%') 
                         AND (t.payload_json->>'phase' ILIKE '%Phase 3%' OR t.payload_json->>'phase' ILIKE '%Phase III%')) as phase3_active,
      COUNT(*) FILTER (WHERE (t.payload_json->>'status' ILIKE '%Recruiting%' OR t.payload_json->>'status' ILIKE '%Active%')
                         AND (t.payload_json->>'phase' ILIKE '%Phase 2%' OR t.payload_json->>'phase' ILIKE '%Phase II%')) as phase2_active,
      COUNT(*) FILTER (WHERE t.payload_json->>'status' ILIKE '%Recruiting%' OR t.payload_json->>'status' ILIKE '%Active%') as total_active,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (t.payload_json->>'enrollment')::int) 
        FILTER (WHERE (t.payload_json->>'enrollment')::int > 0) as median_enroll,
      COUNT(DISTINCT tl.country_code) as countries,
      COALESCE(SUM(tf.burden_score), 0) as burden,
      MAX(t.updated_source_date) as last_update,
      -- Collect conditions arrays (not individual values - simpler and works with GROUP BY)
      jsonb_agg(t.payload_json->'conditions') 
        FILTER (WHERE t.payload_json->'conditions' IS NOT NULL AND jsonb_array_length(t.payload_json->'conditions') > 0) as top_conditions,
      jsonb_agg(DISTINCT t.payload_json->>'interventionsText') 
        FILTER (WHERE t.payload_json->>'interventionsText' IS NOT NULL) as top_interventions,
      50 as pressure,
      'Active Alzheimer trials' as why_now,
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
  
  console.log(`[AACT Import] Rollups computed successfully`);
}
