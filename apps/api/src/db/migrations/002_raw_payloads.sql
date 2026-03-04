-- Raw source payloads for auditability
-- Migration: 002_raw_payloads

CREATE TABLE IF NOT EXISTS raw_source_payloads (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL, -- 'clinicaltrials.gov', 'pubmed', etc.
    source_key TEXT NOT NULL, -- nct_id, pmid, etc.
    source_updated_at TIMESTAMP,
    fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
    payload_json JSONB NOT NULL,
    UNIQUE(source, source_key)
);

CREATE INDEX IF NOT EXISTS idx_raw_payloads_source_key ON raw_source_payloads(source, source_key);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_fetched ON raw_source_payloads(fetched_at DESC);

-- Add transform_version to snapshots for traceability
ALTER TABLE program_snapshots ADD COLUMN IF NOT EXISTS transform_version TEXT DEFAULT '1.0.0';
ALTER TABLE mv_market_sponsor_rollup ADD COLUMN IF NOT EXISTS transform_version TEXT DEFAULT '1.0.0';
ALTER TABLE mv_market_program_rollup ADD COLUMN IF NOT EXISTS transform_version TEXT DEFAULT '1.0.0';
