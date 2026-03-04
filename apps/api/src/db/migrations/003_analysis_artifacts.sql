-- Analysis artifacts system
-- Migration: 003_analysis_artifacts

CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL REFERENCES market_definitions(id),
    type TEXT NOT NULL, -- 'market-map', 'timeline-race', 'pressure', 'risks'
    status TEXT NOT NULL, -- 'pending', 'running', 'completed', 'failed'
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMP,
    params_json JSONB,
    error TEXT,
    transform_version TEXT DEFAULT '1.0.0'
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_market_type ON analysis_runs(market_id, type, started_at DESC);

CREATE TABLE IF NOT EXISTS analysis_outputs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES analysis_runs(id),
    key TEXT NOT NULL, -- 'market-map', 'timeline-race', etc.
    payload_json JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(run_id, key)
);

CREATE INDEX IF NOT EXISTS idx_analysis_outputs_run ON analysis_outputs(run_id);
