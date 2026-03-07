-- Migration: 014_investigator_enrichment_debug
-- Adds explicit debug fields for investigator enrichment runs.

ALTER TABLE investigator_enrichment_status
    ADD COLUMN IF NOT EXISTS stage TEXT,
    ADD COLUMN IF NOT EXISTS failure_reason TEXT,
    ADD COLUMN IF NOT EXISTS outcome_log JSONB;

CREATE INDEX IF NOT EXISTS idx_inv_enrich_stage
    ON investigator_enrichment_status (stage);

