-- Contact Candidates
-- Migration: 007_contact_candidates

CREATE TABLE IF NOT EXISTS contact_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    persona_type TEXT NOT NULL CHECK (persona_type IN ('pain_owner', 'decision_owner')),
    persona_role TEXT NOT NULL,
    full_name TEXT,
    title TEXT,
    company TEXT,
    linkedin_url TEXT,
    source TEXT NOT NULL DEFAULT 'public_web',
    confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
    evidence_json JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_candidates_sponsor_market ON contact_candidates(sponsor_id, market_id);
CREATE INDEX IF NOT EXISTS idx_contact_candidates_market ON contact_candidates(market_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_candidates_unique_linkedin ON contact_candidates(sponsor_id, market_id, persona_type, linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_candidates_unique_name_title ON contact_candidates(sponsor_id, market_id, persona_type, full_name, title) WHERE full_name IS NOT NULL;
