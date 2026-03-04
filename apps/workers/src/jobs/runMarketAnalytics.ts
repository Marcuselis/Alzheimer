import { Pool } from 'pg';
import { enqueueAnalysis } from '../../api/src/queue/queue';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

export async function runMarketAnalytics(marketId: string, type: string, params?: any) {
  const runId = `analysis_${marketId}_${type}_${Date.now()}`;
  
  try {
    // Create analysis run
    await db.query(`
      INSERT INTO analysis_runs (id, market_id, type, status, started_at, params_json)
      VALUES ($1, $2, $3, 'running', NOW(), $4)
    `, [runId, marketId, type, JSON.stringify(params || {})]);
    
    let output: any;
    
    switch (type) {
      case 'market-map':
        output = await computeMarketMap(marketId);
        break;
      case 'timeline-race':
        output = await computeTimelineRace(marketId);
        break;
      case 'pressure':
        output = await computePressureLeaderboard(marketId);
        break;
      case 'risks':
        output = await computeRiskHeatmap(marketId);
        break;
      default:
        throw new Error(`Unknown analysis type: ${type}`);
    }
    
    // Store output
    await db.query(`
      INSERT INTO analysis_outputs (id, run_id, key, payload_json)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (run_id, key) DO UPDATE SET
        payload_json = $4,
        created_at = NOW()
    `, [
      `output_${runId}`,
      runId,
      type,
      JSON.stringify(output),
    ]);
    
    // Update run status
    await db.query(`
      UPDATE analysis_runs
      SET status = 'completed', finished_at = NOW()
      WHERE id = $1
    `, [runId]);
    
    return { runId, status: 'completed', output };
  } catch (error: any) {
    await db.query(`
      UPDATE analysis_runs
      SET status = 'failed', error = $1, finished_at = NOW()
      WHERE id = $2
    `, [error.message, runId]);
    
    throw error;
  }
}

async function computeMarketMap(marketId: string) {
  // Cluster by mechanism/intervention type
  const result = await db.query(`
    SELECT
      t.payload_json->>'interventionsText' as molecule,
      t.sponsor_id,
      s.name as sponsor_name,
      t.payload_json->>'phase' as phase,
      COUNT(*) as trial_count
    FROM market_trials mt
    JOIN trials t ON mt.nct_id = t.nct_id
    LEFT JOIN sponsors s ON t.sponsor_id = s.id
    WHERE mt.market_id = $1
    GROUP BY t.payload_json->>'interventionsText', t.sponsor_id, s.name, t.payload_json->>'phase'
    ORDER BY trial_count DESC
  `, [marketId]);
  
  // Group into clusters (simplified - would use ML in production)
  const clusters: Record<string, any[]> = {};
  for (const row of result.rows) {
    const molecule = row.molecule?.toLowerCase() || 'unknown';
    const cluster = molecule.includes('amyloid') ? 'Amyloid' :
                   molecule.includes('tau') ? 'Tau' :
                   molecule.includes('anti') ? 'Antibody' : 'Other';
    
    if (!clusters[cluster]) clusters[cluster] = [];
    clusters[cluster].push({
      molecule: row.molecule,
      sponsor: row.sponsor_name,
      phase: row.phase,
      trialCount: parseInt(row.trial_count, 10),
    });
  }
  
  return { clusters, marketId };
}

async function computeTimelineRace(marketId: string) {
  const result = await db.query(`
    SELECT
      t.sponsor_id,
      s.name as sponsor_name,
      t.payload_json->>'interventionsText' as molecule,
      tm.start_date,
      tm.primary_completion_date,
      COUNT(*) as trial_count
    FROM market_trials mt
    JOIN trials t ON mt.nct_id = t.nct_id
    LEFT JOIN sponsors s ON t.sponsor_id = s.id
    LEFT JOIN trial_metadata tm ON t.nct_id = tm.nct_id
    WHERE mt.market_id = $1
      AND tm.start_date IS NOT NULL
    GROUP BY t.sponsor_id, s.name, t.payload_json->>'interventionsText', tm.start_date, tm.primary_completion_date
    ORDER BY tm.start_date ASC
  `, [marketId]);
  
  return {
    programs: result.rows.map(row => ({
      sponsor: row.sponsor_name,
      molecule: row.molecule,
      startDate: row.start_date?.toISOString(),
      primaryCompletionDate: row.primary_completion_date?.toISOString(),
      trialCount: parseInt(row.trial_count, 10),
    })),
    marketId,
  };
}

async function computePressureLeaderboard(marketId: string) {
  const result = await db.query(`
    SELECT
      msr.sponsor_id,
      s.name as sponsor_name,
      msr.pressure_score,
      msr.phase3_active_count,
      msr.phase2_active_count,
      msr.total_active_count,
      msr.median_enrollment,
      msr.countries_count,
      msr.burden_score
    FROM mv_market_sponsor_rollup msr
    JOIN sponsors s ON msr.sponsor_id = s.id
    WHERE msr.market_id = $1
    ORDER BY msr.pressure_score DESC
  `, [marketId]);
  
  return {
    leaderboard: result.rows.map((row, index) => ({
      rank: index + 1,
      sponsor: row.sponsor_name,
      pressureScore: row.pressure_score,
      phase3Active: row.phase3_active_count,
      totalActive: row.total_active_count,
      enrollment: row.median_enrollment,
      countries: row.countries_count,
      burden: row.burden_score,
    })),
    marketId,
  };
}

async function computeRiskHeatmap(marketId: string) {
  // Risk categories: timeline risk, competitive risk, burden risk
  const result = await db.query(`
    SELECT
      t.sponsor_id,
      s.name as sponsor_name,
      t.payload_json->>'interventionsText' as molecule,
      COUNT(*) as trial_count,
      COUNT(*) FILTER (WHERE t.payload_json->>'status' LIKE '%Recruiting%') as active_count,
      AVG(tf.burden_score) as avg_burden,
      MIN(tm.start_date) as earliest_start,
      MAX(tm.primary_completion_date) as latest_completion
    FROM market_trials mt
    JOIN trials t ON mt.nct_id = t.nct_id
    LEFT JOIN sponsors s ON t.sponsor_id = s.id
    LEFT JOIN trial_flags tf ON t.nct_id = tf.nct_id
    LEFT JOIN trial_metadata tm ON t.nct_id = tm.nct_id
    WHERE mt.market_id = $1
    GROUP BY t.sponsor_id, s.name, t.payload_json->>'interventionsText'
  `, [marketId]);
  
  return {
    risks: result.rows.map(row => ({
      sponsor: row.sponsor_name,
      molecule: row.molecule,
      trialCount: parseInt(row.trial_count, 10),
      activeCount: parseInt(row.active_count, 10),
      burdenRisk: parseFloat(row.avg_burden || '0') > 3 ? 'high' : 'medium',
      timelineRisk: row.latest_completion && new Date(row.latest_completion) < new Date() ? 'high' : 'low',
      competitiveRisk: parseInt(row.active_count, 10) < 2 ? 'high' : 'medium',
      evidenceNctIds: [], // TODO: link to actual NCT IDs
    })),
    marketId,
  };
}
