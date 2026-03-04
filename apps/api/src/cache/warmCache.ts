import { buildCacheKey, getOrSetJson } from './cache';
import { db } from '../db/client';

const ALZHEIMERS_MARKET_ID = 'market_alzheimers_phase23';

/**
 * Warm cache for common endpoints after data refresh
 * This ensures fast response times for first user requests
 */
export async function warmCache() {
  try {
    console.log('[CacheWarm] Warming cache for common endpoints...');
    
    // Warm market summary
    const summaryKey = buildCacheKey(['market-summary', ALZHEIMERS_MARKET_ID]);
    await getOrSetJson(
      summaryKey,
      async () => {
        const defResult = await db.query('SELECT * FROM market_definitions WHERE id = $1', [ALZHEIMERS_MARKET_ID]);
        if (defResult.rows.length === 0) return null;
        
        const stateResult = await db.query('SELECT * FROM market_state WHERE market_id = $1', [ALZHEIMERS_MARKET_ID]);
        const state = stateResult.rows[0];
        
        const trialCountResult = await db.query('SELECT COUNT(*) as count FROM market_trials WHERE market_id = $1', [ALZHEIMERS_MARKET_ID]);
        const sponsorCountResult = await db.query(`
          SELECT COUNT(DISTINCT sponsor_id) as count
          FROM mv_market_sponsor_rollup
          WHERE market_id = $1
        `, [ALZHEIMERS_MARKET_ID]);
        const phase3CountResult = await db.query(`
          SELECT SUM(phase3_active_count) as count
          FROM mv_market_sponsor_rollup
          WHERE market_id = $1
        `, [ALZHEIMERS_MARKET_ID]);
        
        return {
          marketId: ALZHEIMERS_MARKET_ID,
          indication: defResult.rows[0].indication_key,
          coverage: {
            trials: parseInt(trialCountResult.rows[0]?.count || '0', 10),
            sponsors: parseInt(sponsorCountResult.rows[0]?.count || '0', 10),
            activePhase3: parseInt(phase3CountResult.rows[0]?.count || '0', 10),
          },
          lastRefreshed: state?.last_success_at?.toISOString() || null,
          lastRefreshAttempt: state?.last_refresh_at?.toISOString() || null,
          sourceHealth: {
            ctgov: state?.last_error ? 'error' : (state?.last_success_at ? 'ok' : 'pending'),
            pubmed: 'available', // PubMed is now available on-demand per sponsor
            websignals: 'skipped',
          },
          definition: defResult.rows[0].definition_json,
        };
      },
      { ttlSeconds: 300 }
    );
    
    // Warm sponsors list
    const sponsorsKey = buildCacheKey(['market', 'alzheimers', 'sponsors']);
    await getOrSetJson(
      sponsorsKey,
      async () => {
        const result = await db.query(`
          SELECT msr.*, s.name as sponsor_name
          FROM mv_market_sponsor_rollup msr
          JOIN sponsors s ON msr.sponsor_id = s.id
          WHERE msr.market_id = $1
          ORDER BY msr.pressure_score DESC
          LIMIT 200
        `, [ALZHEIMERS_MARKET_ID]);
        
        return {
          sponsors: result.rows.map(row => ({
            sponsorId: row.sponsor_id,
            sponsorName: row.sponsor_name,
            pressureScore: row.pressure_score,
            phase3Active: row.phase3_active_count,
            phase2Active: row.phase2_active_count,
            totalActive: row.total_active_count,
            medianEnrollment: row.median_enrollment,
            countriesCount: row.countries_count,
            burdenScore: row.burden_score,
            lastUpdate: row.last_trial_update_date?.toISOString() || null,
            whyNow: row.why_now_snippet,
            evidenceLinkCount: row.evidence_link_count,
          })),
          indication: "Alzheimer's",
          phaseRange: "Phase II-III",
        };
      },
      { ttlSeconds: 600 }
    );
    
    console.log('[CacheWarm] Cache warmed successfully');
  } catch (error: any) {
    console.error('[CacheWarm] Error warming cache:', error);
  }
}
