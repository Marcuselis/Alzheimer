-- Performance indexes for common access patterns
-- Migration: 001_add_indexes

-- Trials indexes
CREATE INDEX IF NOT EXISTS idx_trials_sponsor_phase_status ON trials(sponsor_id, updated_source_date DESC) 
  WHERE sponsor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trials_updated_source_date ON trials(updated_source_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_trials_market_phase_status ON trials(sponsor_id, updated_source_date DESC);

-- Market trials indexes
CREATE INDEX IF NOT EXISTS idx_market_trials_market_nct ON market_trials(market_id, nct_id);

-- Materialized view indexes
CREATE INDEX IF NOT EXISTS idx_mv_sponsor_rollup_pressure ON mv_market_sponsor_rollup(market_id, pressure_score DESC);

CREATE INDEX IF NOT EXISTS idx_mv_program_rollup_market_key ON mv_market_program_rollup(market_id, program_key);

-- Unique constraints (idempotent - won't fail if already exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trials_nct_id_unique'
  ) THEN
    ALTER TABLE trials ADD CONSTRAINT trials_nct_id_unique UNIQUE (nct_id);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'papers_pmid_unique'
  ) THEN
    ALTER TABLE papers ADD CONSTRAINT papers_pmid_unique UNIQUE (pmid);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sponsors_name_unique'
  ) THEN
    ALTER TABLE sponsors ADD CONSTRAINT sponsors_name_unique UNIQUE (name);
  END IF;
END $$;
