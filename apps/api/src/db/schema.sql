-- Sponsors
CREATE TABLE IF NOT EXISTS sponsors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Programs
CREATE TABLE IF NOT EXISTS programs (
    id TEXT PRIMARY KEY,
    sponsor_id TEXT NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
    molecule TEXT NOT NULL,
    indication TEXT NOT NULL,
    phase TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_programs_sponsor ON programs(sponsor_id);

-- Trials
CREATE TABLE IF NOT EXISTS trials (
    id TEXT PRIMARY KEY,
    program_id TEXT REFERENCES programs(id) ON DELETE SET NULL,
    sponsor_id TEXT REFERENCES sponsors(id) ON DELETE SET NULL,
    nct_id TEXT NOT NULL UNIQUE,
    payload_json JSONB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trials_program ON trials(program_id);
CREATE INDEX IF NOT EXISTS idx_trials_sponsor ON trials(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_trials_nct ON trials(nct_id);

-- Papers
CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    pmid TEXT NOT NULL UNIQUE,
    payload_json JSONB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_papers_program ON papers(program_id);
CREATE INDEX IF NOT EXISTS idx_papers_pmid ON papers(pmid);

-- Program Snapshots (precomputed summaries)
CREATE TABLE IF NOT EXISTS program_snapshots (
    id TEXT PRIMARY KEY,
    program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_program ON program_snapshots(program_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON program_snapshots(created_at DESC);

-- Briefs
CREATE TABLE IF NOT EXISTS briefs (
    id TEXT PRIMARY KEY,
    program_id TEXT REFERENCES programs(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_briefs_program ON briefs(program_id);
CREATE INDEX IF NOT EXISTS idx_briefs_created ON briefs(created_at DESC);

-- Cache entries (for Redis fallback or long-term cache)
CREATE TABLE IF NOT EXISTS cache_entries (
    key TEXT PRIMARY KEY,
    payload_json JSONB NOT NULL,
    fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
    ttl_seconds INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cache_fetched ON cache_entries(fetched_at);

-- Market Definitions
CREATE TABLE IF NOT EXISTS market_definitions (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    indication_key TEXT NOT NULL,
    ctgov_condition_query TEXT NOT NULL,
    phase_range TEXT[] NOT NULL,
    statuses TEXT[] NOT NULL,
    updated_within_days INTEGER,
    geography TEXT[],
    definition_json JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Market State (tracking refresh status)
CREATE TABLE IF NOT EXISTS market_state (
    market_id TEXT PRIMARY KEY REFERENCES market_definitions(id),
    last_refresh_at TIMESTAMP,
    last_success_at TIMESTAMP,
    last_error TEXT,
    coverage_counts_json JSONB,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Market Trials (membership)
CREATE TABLE IF NOT EXISTS market_trials (
    market_id TEXT NOT NULL REFERENCES market_definitions(id),
    nct_id TEXT NOT NULL REFERENCES trials(nct_id),
    added_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (market_id, nct_id)
);

CREATE INDEX IF NOT EXISTS idx_market_trials_market ON market_trials(market_id);
CREATE INDEX IF NOT EXISTS idx_market_trials_nct ON market_trials(nct_id);

-- Enhanced Trials table (add source tracking)
ALTER TABLE trials ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'clinicaltrials.gov';
ALTER TABLE trials ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMP DEFAULT NOW();
ALTER TABLE trials ADD COLUMN IF NOT EXISTS updated_source_date TIMESTAMP;
ALTER TABLE trials ADD COLUMN IF NOT EXISTS raw_json JSONB;

-- Trial Locations
CREATE TABLE IF NOT EXISTS trial_locations (
    nct_id TEXT NOT NULL REFERENCES trials(nct_id),
    country_code TEXT,
    country_name TEXT,
    PRIMARY KEY (nct_id, country_code)
);

CREATE INDEX IF NOT EXISTS idx_trial_locations_nct ON trial_locations(nct_id);

-- Trial Flags (normalized flags)
CREATE TABLE IF NOT EXISTS trial_flags (
    nct_id TEXT PRIMARY KEY REFERENCES trials(nct_id),
    has_pet BOOLEAN DEFAULT FALSE,
    has_mri BOOLEAN DEFAULT FALSE,
    has_infusion BOOLEAN DEFAULT FALSE,
    mentions_aria BOOLEAN DEFAULT FALSE,
    has_biomarker BOOLEAN DEFAULT FALSE,
    route_enum TEXT, -- 'oral', 'iv', 'sc', 'infusion', 'mixed'
    burden_score INTEGER DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Trial Metadata (extracted key fields)
CREATE TABLE IF NOT EXISTS trial_metadata (
    nct_id TEXT PRIMARY KEY REFERENCES trials(nct_id),
    start_date DATE,
    primary_completion_date DATE,
    completion_date DATE,
    enrollment INTEGER,
    endpoints_text TEXT,
    eligibility_criteria TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trial_metadata_dates ON trial_metadata(start_date, primary_completion_date);

-- Materialized View: Market Sponsor Rollup
CREATE TABLE IF NOT EXISTS mv_market_sponsor_rollup (
    market_id TEXT NOT NULL,
    sponsor_id TEXT NOT NULL,
    phase3_active_count INTEGER DEFAULT 0,
    phase2_active_count INTEGER DEFAULT 0,
    total_active_count INTEGER DEFAULT 0,
    median_enrollment INTEGER,
    countries_count INTEGER DEFAULT 0,
    burden_score INTEGER DEFAULT 0,
    last_trial_update_date TIMESTAMP,
    top_conditions_json JSONB,
    top_interventions_json JSONB,
    pressure_score INTEGER DEFAULT 0,
    why_now_snippet TEXT,
    evidence_link_count INTEGER DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (market_id, sponsor_id)
);

CREATE INDEX IF NOT EXISTS idx_mv_sponsor_market ON mv_market_sponsor_rollup(market_id);
CREATE INDEX IF NOT EXISTS idx_mv_sponsor_pressure ON mv_market_sponsor_rollup(market_id, pressure_score DESC);

-- Materialized View: Market Program Rollup
CREATE TABLE IF NOT EXISTS mv_market_program_rollup (
    market_id TEXT NOT NULL,
    program_key TEXT NOT NULL,
    sponsor_id TEXT NOT NULL,
    phase TEXT,
    status_mix_json JSONB,
    trial_count INTEGER DEFAULT 0,
    active_count INTEGER DEFAULT 0,
    enrollment_median INTEGER,
    countries_count INTEGER DEFAULT 0,
    burden_flags_json JSONB,
    endpoints_common_json JSONB,
    timeline_min_start TIMESTAMP,
    timeline_max_primary_completion TIMESTAMP,
    pressure_score INTEGER DEFAULT 0,
    peer_crowding_level TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (market_id, program_key)
);

CREATE INDEX IF NOT EXISTS idx_mv_program_market ON mv_market_program_rollup(market_id);
CREATE INDEX IF NOT EXISTS idx_mv_program_sponsor ON mv_market_program_rollup(market_id, sponsor_id);

-- Materialized View: Market Competitive Clusters
CREATE TABLE IF NOT EXISTS mv_market_competitive_clusters (
    market_id TEXT NOT NULL,
    cluster_key TEXT NOT NULL,
    cluster_label TEXT NOT NULL,
    sponsor_count INTEGER DEFAULT 0,
    trial_count INTEGER DEFAULT 0,
    phase3_count INTEGER DEFAULT 0,
    top_programs_json JSONB,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (market_id, cluster_key)
);

CREATE INDEX IF NOT EXISTS idx_mv_clusters_market ON mv_market_competitive_clusters(market_id);
