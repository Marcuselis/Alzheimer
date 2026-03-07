-- Migration: 010_investigator_identity
-- Adds identity resolution and influence scoring to the people table.
--
-- Problem this solves:
--   "Maria Svensson", "Dr. Maria Svensson", "M. Svensson", "Maria K. Svensson"
--   will all appear in trial data as separate strings.
--   We need to consolidate them into a single canonical person record.
--
-- Approach:
--   - canonical_person_id is a self-referential FK: aliases point to the canonical record.
--     If NULL, the row IS the canonical record.
--   - influence_score is a computed integer updated by the worker whenever
--     trial_people or publications are linked.

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS canonical_person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS orcid             TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS primary_institution_id UUID REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS influence_score   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publication_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alias_names       TEXT[] NOT NULL DEFAULT '{}';

-- Index: find canonical record by normalized name
CREATE INDEX IF NOT EXISTS idx_people_canonical ON people(canonical_person_id) WHERE canonical_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_people_orcid ON people(orcid) WHERE orcid IS NOT NULL;

-- Index: fast lookup of all trials for a person (already exists via trial_people)
-- But we also need to find investigators by institution efficiently
CREATE INDEX IF NOT EXISTS idx_trial_people_org ON trial_people(organization_id) WHERE organization_id IS NOT NULL;

-- Opportunity scores per trial (separate table to avoid bloating trials)
CREATE TABLE IF NOT EXISTS trial_opportunity_scores (
    nct_id          TEXT PRIMARY KEY,
    score           INTEGER NOT NULL DEFAULT 0,
    phase_score     INTEGER NOT NULL DEFAULT 0,
    status_score    INTEGER NOT NULL DEFAULT 0,
    sponsor_score   INTEGER NOT NULL DEFAULT 0,
    investigator_score INTEGER NOT NULL DEFAULT 0,
    recency_score   INTEGER NOT NULL DEFAULT 0,
    explanation     TEXT,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- For fast sorting of trials by opportunity
CREATE INDEX IF NOT EXISTS idx_opportunity_score ON trial_opportunity_scores(score DESC);
