-- Migration: 005_index_detail_split
-- Split trials data into index (lightweight) and detail (heavy) for performance

-- Add index_json and detail_json columns to trials table
ALTER TABLE trials ADD COLUMN IF NOT EXISTS index_json JSONB;
ALTER TABLE trials ADD COLUMN IF NOT EXISTS detail_json JSONB;
ALTER TABLE trials ADD COLUMN IF NOT EXISTS detail_fetched_at TIMESTAMP;

-- Create index on detail_fetched_at for delta queries
CREATE INDEX IF NOT EXISTS idx_trials_detail_fetched ON trials(detail_fetched_at);

-- Create index on index_json for fast queries
CREATE INDEX IF NOT EXISTS idx_trials_index_json ON trials USING GIN (index_json);

-- Migrate existing payload_json to index_json (if not already done)
UPDATE trials 
SET index_json = payload_json 
WHERE index_json IS NULL AND payload_json IS NOT NULL;

-- Add coverage tracking columns
ALTER TABLE market_state ADD COLUMN IF NOT EXISTS index_coverage_json JSONB;
ALTER TABLE market_state ADD COLUMN IF NOT EXISTS detail_coverage_json JSONB;
