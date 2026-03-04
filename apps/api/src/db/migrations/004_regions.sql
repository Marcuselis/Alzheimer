-- Regions and Region Attractiveness Scoring
-- Migration: 004_regions

-- Regions table
CREATE TABLE IF NOT EXISTS regions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    countries TEXT[] NOT NULL,
    strategic_signal_score INTEGER NOT NULL DEFAULT 30,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regions_code ON regions(code);

-- Region rollups (serving table for precomputed scores)
CREATE TABLE IF NOT EXISTS region_rollups (
    region_id UUID NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    market_id TEXT NOT NULL REFERENCES market_definitions(id) ON DELETE CASCADE,
    active_phase23_trials INTEGER DEFAULT 0,
    growth_rate_12m NUMERIC DEFAULT 0,
    median_enrollment INTEGER,
    monitoring_burden_score NUMERIC DEFAULT 0,
    competitor_saturation NUMERIC DEFAULT 0,
    sales_readiness_score NUMERIC DEFAULT 0,
    clinical_activity_score NUMERIC DEFAULT 0,
    growth_score NUMERIC DEFAULT 0,
    burden_score NUMERIC DEFAULT 0,
    competition_score NUMERIC DEFAULT 0,
    sales_score NUMERIC DEFAULT 0,
    signal_score NUMERIC DEFAULT 0,
    final_attractiveness_score NUMERIC DEFAULT 0,
    score_breakdown_json JSONB,
    computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (region_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_region_rollups_market ON region_rollups(market_id);
CREATE INDEX IF NOT EXISTS idx_region_rollups_region ON region_rollups(region_id);
CREATE INDEX IF NOT EXISTS idx_region_rollups_score ON region_rollups(market_id, final_attractiveness_score DESC);
