import { db } from '../db/client';
import { enqueueMarketRefresh } from '../queue/queue';

const ALZHEIMERS_MARKET_ID = 'market_alzheimers_phase23';

/**
 * Check if market data exists and auto-trigger quick refresh if needed
 * This ensures the app loads fast on first use
 */
export async function ensureMarketData() {
  try {
    console.log('[EnsureData] Checking if market data exists...');
    
    // Check if market definition exists
    const marketResult = await db.query(
      'SELECT id FROM market_definitions WHERE id = $1',
      [ALZHEIMERS_MARKET_ID]
    );
    
    if (marketResult.rows.length === 0) {
      console.log('[EnsureData] Market definition not found, creating...');
      // Market will be created by initMarket script or first refresh
    }
    
    // Check if we have any trials in the market
    const trialCountResult = await db.query(`
      SELECT COUNT(*) as count
      FROM market_trials
      WHERE market_id = $1
    `, [ALZHEIMERS_MARKET_ID]);
    
    const trialCount = parseInt(trialCountResult.rows[0]?.count || '0', 10);
    
    // Check last refresh status
    const stateResult = await db.query(
      'SELECT last_success_at, last_error FROM market_state WHERE market_id = $1',
      [ALZHEIMERS_MARKET_ID]
    );
    
    const state = stateResult.rows[0];
    const hasRecentSuccess = state?.last_success_at && 
      new Date(state.last_success_at) > new Date(Date.now() - 24 * 60 * 60 * 1000); // Within 24 hours
    
    if (trialCount === 0 || (!hasRecentSuccess && !state?.last_error)) {
      console.log(`[EnsureData] No data found (trials: ${trialCount}), triggering quick refresh...`);
      
      // Trigger quick refresh (200 studies, ~2-3 minutes)
      const jobId = await enqueueMarketRefresh(ALZHEIMERS_MARKET_ID, true);
      
      console.log(`[EnsureData] Quick refresh job enqueued: ${jobId}`);
      console.log('[EnsureData] App will be ready in ~2-3 minutes. Full refresh can be triggered later.');
      
      return { triggered: true, jobId, quickMode: true };
    } else if (state?.last_error) {
      console.log(`[EnsureData] Last refresh had error: ${state.last_error}`);
      console.log('[EnsureData] Consider triggering a manual refresh');
      return { triggered: false, hasError: true, error: state.last_error };
    } else {
      console.log(`[EnsureData] Market data exists (${trialCount} trials, last refreshed: ${state?.last_success_at})`);
      
      // Warm cache for fast first loads
      try {
        const { warmCache } = await import('../cache/warmCache');
        await warmCache();
      } catch (error) {
        console.error('[EnsureData] Failed to warm cache:', error);
      }
      
      return { triggered: false, trialCount, lastSuccess: state?.last_success_at };
    }
  } catch (error: any) {
    console.error('[EnsureData] Error checking market data:', error);
    return { triggered: false, error: error.message };
  }
}
