-- Migration: 008_trial_contacts
-- Contact enrichment pipeline tables

-- People: deduplicated persons across trials
CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    normalized_name TEXT NOT NULL,
    primary_role TEXT,
    linkedin_url TEXT,
    orcid_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_people_normalized ON people(normalized_name);

-- Organizations: canonical institution records
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    website_url TEXT,
    primary_domain TEXT,
    country TEXT,
    type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_normalized ON organizations(normalized_name);
CREATE INDEX IF NOT EXISTS idx_org_domain ON organizations(primary_domain);

-- Contact methods: emails, LinkedIn URLs, phones per person
CREATE TABLE IF NOT EXISTS contact_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('email', 'linkedin', 'phone', 'website')),
    value TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT,
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
    label TEXT CHECK (label IN ('verified', 'published', 'inferred', 'low-confidence')),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(person_id, type, value)
);

CREATE INDEX IF NOT EXISTS idx_contact_methods_person ON contact_methods(person_id);
CREATE INDEX IF NOT EXISTS idx_contact_methods_confidence ON contact_methods(person_id, confidence DESC);

-- Trial people: who is associated with which trial
CREATE TABLE IF NOT EXISTS trial_people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nct_id TEXT NOT NULL,
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id),
    role TEXT NOT NULL,
    raw_affiliation TEXT,
    source TEXT NOT NULL DEFAULT 'clinicaltrials.gov',
    confidence NUMERIC(4,3) NOT NULL DEFAULT 1.0,
    UNIQUE(nct_id, person_id, role)
);

CREATE INDEX IF NOT EXISTS idx_trial_people_nct ON trial_people(nct_id);
CREATE INDEX IF NOT EXISTS idx_trial_people_person ON trial_people(person_id);

-- Enrichment jobs: track async enrichment runs per trial
CREATE TABLE IF NOT EXISTS enrichment_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nct_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'error')),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_nct ON enrichment_jobs(nct_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status ON enrichment_jobs(status, created_at DESC);

-- Contact sources: raw evidence per person
CREATE TABLE IF NOT EXISTS contact_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_url TEXT,
    raw_snippet TEXT,
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_sources_person ON contact_sources(person_id);
