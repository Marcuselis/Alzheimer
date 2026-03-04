import { Pool } from 'pg';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

interface Region {
  id: string;
  code: string;
  name: string;
  countries: string[];
  strategic_signal_score: number;
}

interface RegionMetrics {
  active_phase23_trials: number;
  growth_rate_12m: number;
  median_enrollment: number;
  monitoring_burden_score: number;
  competitor_saturation: number;
  sales_readiness_score: number;
}

interface RegionScores {
  clinical_activity_score: number;
  growth_score: number;
  burden_score: number;
  competition_score: number;
  sales_score: number;
  signal_score: number;
  final_attractiveness_score: number;
}

/**
 * Compute region attractiveness scores for a market
 */
export async function computeRegionAttractiveness(marketId: string): Promise<{
  status: string;
  regionsProcessed: number;
  error?: string;
}> {
  try {
    console.log(`[Region Attractiveness] Computing scores for market ${marketId}`);
    
    // Get all regions
    const regionsResult = await db.query('SELECT * FROM regions ORDER BY code');
    const regions: Region[] = regionsResult.rows;
    
    if (regions.length === 0) {
      throw new Error('No regions found. Please seed regions first.');
    }
    
    // Get max active trials across all regions for normalization
    const maxTrialsResult = await db.query(`
      SELECT MAX(trial_count) as max_trials
      FROM (
        SELECT COUNT(DISTINCT mt.nct_id) as trial_count
        FROM market_trials mt
        JOIN trials t ON mt.nct_id = t.nct_id
        JOIN trial_locations tl ON t.nct_id = tl.nct_id
        WHERE mt.market_id = $1
          AND t.payload_json->>'status' LIKE '%Recruiting%'
          AND (
            t.payload_json->>'phase' LIKE '%Phase 2%' OR
            t.payload_json->>'phase' LIKE '%Phase 3%' OR
            t.payload_json->>'phase' LIKE '%Phase II%' OR
            t.payload_json->>'phase' LIKE '%Phase III%'
          )
        GROUP BY tl.country_code
      ) subq
    `, [marketId]);
    
    const maxActiveTrials = parseInt(maxTrialsResult.rows[0]?.max_trials || '1', 10);
    
    let regionsProcessed = 0;
    
    // Process each region
    for (const region of regions) {
      console.log(`[Region Attractiveness] Processing region: ${region.code}`);
      
      // Compute metrics for this region
      const metrics = await computeRegionMetrics(marketId, region);
      
      // Compute scores
      const scores = computeScores(metrics, region, maxActiveTrials);
      
      // Generate score breakdown
      const scoreBreakdown = generateScoreBreakdown(scores, metrics);
      
      // Determine entry phase bucket
      const entryPhaseBucket = determineEntryPhaseBucket(metrics);
      
      // Upsert into region_rollups
      await db.query(`
        INSERT INTO region_rollups (
          region_id, market_id,
          active_phase23_trials, growth_rate_12m, median_enrollment,
          monitoring_burden_score, competitor_saturation, sales_readiness_score,
          clinical_activity_score, growth_score, burden_score,
          competition_score, sales_score, signal_score, final_attractiveness_score,
          score_breakdown_json, computed_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW()
        )
        ON CONFLICT (region_id, market_id) DO UPDATE SET
          active_phase23_trials = EXCLUDED.active_phase23_trials,
          growth_rate_12m = EXCLUDED.growth_rate_12m,
          median_enrollment = EXCLUDED.median_enrollment,
          monitoring_burden_score = EXCLUDED.monitoring_burden_score,
          competitor_saturation = EXCLUDED.competitor_saturation,
          sales_readiness_score = EXCLUDED.sales_readiness_score,
          clinical_activity_score = EXCLUDED.clinical_activity_score,
          growth_score = EXCLUDED.growth_score,
          burden_score = EXCLUDED.burden_score,
          competition_score = EXCLUDED.competition_score,
          sales_score = EXCLUDED.sales_score,
          signal_score = EXCLUDED.signal_score,
          final_attractiveness_score = EXCLUDED.final_attractiveness_score,
          score_breakdown_json = EXCLUDED.score_breakdown_json,
          computed_at = NOW()
      `, [
        region.id,
        marketId,
        metrics.active_phase23_trials,
        metrics.growth_rate_12m,
        metrics.median_enrollment,
        metrics.monitoring_burden_score,
        metrics.competitor_saturation,
        metrics.sales_readiness_score,
        scores.clinical_activity_score,
        scores.growth_score,
        scores.burden_score,
        scores.competition_score,
        scores.sales_score,
        scores.signal_score,
        scores.final_attractiveness_score,
        JSON.stringify(scoreBreakdown),
      ]);
      
      regionsProcessed++;
      console.log(`[Region Attractiveness] Completed region ${region.code}: score=${scores.final_attractiveness_score.toFixed(1)}`);
    }
    
    console.log(`[Region Attractiveness] Completed processing ${regionsProcessed} regions for market ${marketId}`);
    
    return { status: 'completed', regionsProcessed };
  } catch (error: any) {
    console.error('[Region Attractiveness] Error:', error);
    return { status: 'error', regionsProcessed: 0, error: error.message };
  }
}

/**
 * Compute raw metrics for a region
 */
async function computeRegionMetrics(marketId: string, region: Region): Promise<RegionMetrics> {
  // Get active Phase 2/3 trials in this region
  const activeTrialsResult = await db.query(`
    SELECT COUNT(DISTINCT mt.nct_id) as trial_count,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tm.enrollment) FILTER (WHERE tm.enrollment > 0) as median_enroll
    FROM market_trials mt
    JOIN trials t ON mt.nct_id = t.nct_id
    JOIN trial_locations tl ON mt.nct_id = tl.nct_id
    LEFT JOIN trial_metadata tm ON mt.nct_id = tm.nct_id
    WHERE mt.market_id = $1
      AND tl.country_code = ANY($2)
      AND t.payload_json->>'status' LIKE '%Recruiting%'
      AND (
        t.payload_json->>'phase' LIKE '%Phase 2%' OR
        t.payload_json->>'phase' LIKE '%Phase 3%' OR
        t.payload_json->>'phase' LIKE '%Phase II%' OR
        t.payload_json->>'phase' LIKE '%Phase III%'
      )
  `, [marketId, region.countries]);
  
  const active_phase23_trials = parseInt(activeTrialsResult.rows[0]?.trial_count || '0', 10);
  const median_enrollment = activeTrialsResult.rows[0]?.median_enroll 
    ? parseInt(activeTrialsResult.rows[0].median_enroll, 10) 
    : null;
  
  // Compute growth rate (12-month): compare trials started in last 12 months vs previous 12 months
  const growthResult = await db.query(`
    WITH recent_trials AS (
      SELECT COUNT(DISTINCT mt.nct_id) as count
      FROM market_trials mt
      JOIN trials t ON mt.nct_id = t.nct_id
      JOIN trial_locations tl ON mt.nct_id = tl.nct_id
      JOIN trial_metadata tm ON mt.nct_id = tm.nct_id
      WHERE mt.market_id = $1
        AND tl.country_code = ANY($2)
        AND tm.start_date >= NOW() - INTERVAL '12 months'
        AND tm.start_date < NOW()
    ),
    previous_trials AS (
      SELECT COUNT(DISTINCT mt.nct_id) as count
      FROM market_trials mt
      JOIN trials t ON mt.nct_id = t.nct_id
      JOIN trial_locations tl ON mt.nct_id = tl.nct_id
      JOIN trial_metadata tm ON mt.nct_id = tm.nct_id
      WHERE mt.market_id = $1
        AND tl.country_code = ANY($2)
        AND tm.start_date >= NOW() - INTERVAL '24 months'
        AND tm.start_date < NOW() - INTERVAL '12 months'
    )
    SELECT 
      COALESCE((SELECT count FROM recent_trials), 0) as recent_count,
      COALESCE((SELECT count FROM previous_trials), 0) as previous_count
  `, [marketId, region.countries]);
  
  const recentCount = parseInt(growthResult.rows[0]?.recent_count || '0', 10);
  const previousCount = parseInt(growthResult.rows[0]?.previous_count || '0', 10);
  const growth_rate_12m = previousCount > 0 
    ? ((recentCount - previousCount) / previousCount) * 100 
    : (recentCount > 0 ? 100 : 0);
  
  // Compute monitoring burden score
  // Sum burden flags across all trials in region
  const burdenResult = await db.query(`
    SELECT 
      COUNT(DISTINCT mt.nct_id) as trial_count,
      SUM(
        CASE WHEN tf.has_pet THEN 1 ELSE 0 END +
        CASE WHEN tf.has_mri THEN 1 ELSE 0 END +
        CASE WHEN tf.has_infusion THEN 1 ELSE 0 END +
        CASE WHEN tf.mentions_aria THEN 1 ELSE 0 END +
        CASE WHEN tf.has_biomarker THEN 1 ELSE 0 END +
        CASE WHEN (
          SELECT COUNT(DISTINCT tl2.country_code) 
          FROM trial_locations tl2 
          WHERE tl2.nct_id = mt.nct_id
        ) > 1 THEN 1 ELSE 0 END
      ) as total_flags
    FROM market_trials mt
    JOIN trials t ON mt.nct_id = t.nct_id
    JOIN trial_locations tl ON mt.nct_id = tl.nct_id
    LEFT JOIN trial_flags tf ON mt.nct_id = tf.nct_id
    WHERE mt.market_id = $1
      AND tl.country_code = ANY($2)
      AND t.payload_json->>'status' LIKE '%Recruiting%'
      AND (
        t.payload_json->>'phase' LIKE '%Phase 2%' OR
        t.payload_json->>'phase' LIKE '%Phase 3%' OR
        t.payload_json->>'phase' LIKE '%Phase II%' OR
        t.payload_json->>'phase' LIKE '%Phase III%'
      )
  `, [marketId, region.countries]);
  
  const trialCount = parseInt(burdenResult.rows[0]?.trial_count || '0', 10);
  const totalFlags = parseInt(burdenResult.rows[0]?.total_flags || '0', 10);
  const maxFlagsPerTrial = 6; // PET, MRI, infusion, ARIA, biomarker, multi-country
  const monitoring_burden_score = trialCount > 0 
    ? (totalFlags / (trialCount * maxFlagsPerTrial)) 
    : 0;
  
  // Compute competitor saturation
  // Ratio of unique sponsors to total trials (higher = more saturated)
  const saturationResult = await db.query(`
    SELECT 
      COUNT(DISTINCT mt.nct_id) as trial_count,
      COUNT(DISTINCT t.sponsor_id) as sponsor_count
    FROM market_trials mt
    JOIN trials t ON mt.nct_id = t.nct_id
    JOIN trial_locations tl ON mt.nct_id = tl.nct_id
    WHERE mt.market_id = $1
      AND tl.country_code = ANY($2)
      AND t.payload_json->>'status' LIKE '%Recruiting%'
      AND (
        t.payload_json->>'phase' LIKE '%Phase 2%' OR
        t.payload_json->>'phase' LIKE '%Phase 3%' OR
        t.payload_json->>'phase' LIKE '%Phase II%' OR
        t.payload_json->>'phase' LIKE '%Phase III%'
      )
  `, [marketId, region.countries]);
  
  const totalTrials = parseInt(saturationResult.rows[0]?.trial_count || '0', 10);
  const uniqueSponsors = parseInt(saturationResult.rows[0]?.sponsor_count || '0', 10);
  const competitor_saturation = totalTrials > 0 
    ? Math.min(1, uniqueSponsors / totalTrials) 
    : 0;
  
  // Compute sales readiness score (proxy)
  // Based on: sponsor HQ presence, decision centralization, digital trial sophistication
  // For now, use simplified proxies:
  // - HQ presence: ratio of major pharma sponsors (top 20 by global activity)
  // - Decision centralization: ratio of single-country trials
  // - Digital sophistication: ratio of trials with biomarker endpoints
  
  const salesReadinessResult = await db.query(`
    WITH region_trials AS (
      SELECT DISTINCT mt.nct_id, t.sponsor_id, tf.has_biomarker,
        (SELECT COUNT(DISTINCT tl2.country_code) FROM trial_locations tl2 WHERE tl2.nct_id = mt.nct_id) as country_count
      FROM market_trials mt
      JOIN trials t ON mt.nct_id = t.nct_id
      JOIN trial_locations tl ON mt.nct_id = tl.nct_id
      LEFT JOIN trial_flags tf ON mt.nct_id = tf.nct_id
      WHERE mt.market_id = $1
        AND tl.country_code = ANY($2)
        AND t.payload_json->>'status' LIKE '%Recruiting%'
        AND (
          t.payload_json->>'phase' LIKE '%Phase 2%' OR
          t.payload_json->>'phase' LIKE '%Phase 3%' OR
          t.payload_json->>'phase' LIKE '%Phase II%' OR
          t.payload_json->>'phase' LIKE '%Phase III%'
        )
    ),
    major_sponsors AS (
      SELECT DISTINCT sponsor_id
      FROM mv_market_sponsor_rollup
      WHERE market_id = $1
      ORDER BY pressure_score DESC
      LIMIT 20
    )
    SELECT 
      COUNT(*) as total_trials,
      COUNT(*) FILTER (WHERE rt.sponsor_id IN (SELECT sponsor_id FROM major_sponsors))::float / NULLIF(COUNT(*), 0) as hq_presence_ratio,
      COUNT(*) FILTER (WHERE rt.country_count = 1)::float / NULLIF(COUNT(*), 0) as centralization_ratio,
      COUNT(*) FILTER (WHERE rt.has_biomarker = true)::float / NULLIF(COUNT(*), 0) as digital_sophistication_ratio
    FROM region_trials rt
  `, [marketId, region.countries]);
  
  const hqPresence = parseFloat(salesReadinessResult.rows[0]?.hq_presence_ratio || '0');
  const centralization = parseFloat(salesReadinessResult.rows[0]?.centralization_ratio || '0');
  const digitalSophistication = parseFloat(salesReadinessResult.rows[0]?.digital_sophistication_ratio || '0');
  const sales_readiness_score = (hqPresence + centralization + digitalSophistication) / 3;
  
  return {
    active_phase23_trials: active_phase23_trials,
    growth_rate_12m: growth_rate_12m,
    median_enrollment: median_enrollment || 0,
    monitoring_burden_score: monitoring_burden_score,
    competitor_saturation: competitor_saturation,
    sales_readiness_score: sales_readiness_score,
  };
}

/**
 * Compute scores from metrics
 */
function computeScores(
  metrics: RegionMetrics,
  region: Region,
  maxActiveTrials: number
): RegionScores {
  // A) Clinical Activity Score (25%)
  const clinical_activity_score = maxActiveTrials > 0
    ? 100 * (metrics.active_phase23_trials / maxActiveTrials)
    : 0;
  
  // B) Growth Momentum Score (15%)
  const growth_score = Math.max(0, Math.min(100, 50 + 5 * metrics.growth_rate_12m));
  
  // C) Monitoring Burden Score (20%) [INVERTED - lower burden is better]
  const burden_score = 100 * (1 - metrics.monitoring_burden_score);
  
  // D) Competitive Saturation Score (10%) [INVERTED]
  const competition_score = 100 * (1 - metrics.competitor_saturation);
  
  // E) Sales Readiness Score (20%)
  const sales_score = 100 * metrics.sales_readiness_score;
  
  // F) Strategic Signal Score (10%)
  const signal_score = region.strategic_signal_score;
  
  // FINAL SCORE
  const final_attractiveness_score =
    0.25 * clinical_activity_score +
    0.15 * growth_score +
    0.20 * burden_score +
    0.10 * competition_score +
    0.20 * sales_score +
    0.10 * signal_score;
  
  return {
    clinical_activity_score,
    growth_score,
    burden_score,
    competition_score,
    sales_score,
    signal_score,
    final_attractiveness_score,
  };
}

/**
 * Generate human-readable score breakdown
 */
function generateScoreBreakdown(scores: RegionScores, metrics: RegionMetrics): any {
  const drivers: string[] = [];
  
  if (scores.clinical_activity_score > 70) {
    drivers.push(`High clinical activity (${metrics.active_phase23_trials} active Phase 2/3 trials)`);
  } else if (scores.clinical_activity_score < 30) {
    drivers.push(`Low clinical activity (${metrics.active_phase23_trials} active Phase 2/3 trials)`);
  }
  
  if (scores.growth_score > 70) {
    drivers.push(`Strong growth momentum (${metrics.growth_rate_12m.toFixed(1)}% YoY)`);
  } else if (scores.growth_score < 30) {
    drivers.push(`Declining activity (${metrics.growth_rate_12m.toFixed(1)}% YoY)`);
  }
  
  if (scores.burden_score > 70) {
    drivers.push('Low monitoring burden');
  } else if (scores.burden_score < 30) {
    drivers.push('High monitoring burden (PET/MRI/infusion requirements)');
  }
  
  if (scores.competition_score > 70) {
    drivers.push('Low competitive saturation');
  } else if (scores.competition_score < 30) {
    drivers.push('High competitive saturation');
  }
  
  if (scores.sales_score > 70) {
    drivers.push('High sales readiness (major pharma presence, centralized decisions)');
  } else if (scores.sales_score < 30) {
    drivers.push('Low sales readiness');
  }
  
  if (scores.signal_score >= 90) {
    drivers.push('Strong strategic signal (tier 1 market)');
  } else if (scores.signal_score >= 60) {
    drivers.push('Moderate strategic signal (tier 2 market)');
  } else {
    drivers.push('Emerging strategic signal (tier 3 market)');
  }
  
  return {
    topDrivers: drivers.slice(0, 3),
    allDrivers: drivers,
    subScores: {
      clinicalActivity: Math.round(scores.clinical_activity_score),
      growth: Math.round(scores.growth_score),
      burden: Math.round(scores.burden_score),
      competition: Math.round(scores.competition_score),
      sales: Math.round(scores.sales_score),
      signal: Math.round(scores.signal_score),
    },
  };
}

/**
 * Determine entry phase bucket
 */
function determineEntryPhaseBucket(metrics: RegionMetrics): string {
  // Simple heuristic: if high activity, suggest "Monitor", else "Phase 2" or "Phase 1"
  if (metrics.active_phase23_trials >= 10) {
    return 'Monitor';
  } else if (metrics.active_phase23_trials >= 3) {
    return 'Phase 2';
  } else {
    return 'Phase 1';
  }
}
