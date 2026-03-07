-- Migration: 011_investigator_contacts
-- Contact enrichment layer for investigators derived from trials.json.
--
-- investigator_id is the URL slug (e.g. "maria-svensson") — stable, derived
-- deterministically from the investigator's full name. This ties the contact
-- data back to the profile without needing a UUID for investigators that don't
-- yet exist in the `people` table.

CREATE TABLE IF NOT EXISTS investigator_contacts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigator_id   TEXT NOT NULL,

    type              TEXT NOT NULL CHECK (type IN ('email', 'linkedin', 'phone', 'website')),
    value             TEXT NOT NULL,

    -- Verification tier
    status            TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (status IN ('published', 'verified', 'inferred', 'catch_all', 'rejected', 'unknown')),

    -- Where this contact came from
    source_type       TEXT NOT NULL DEFAULT 'inference'
                        CHECK (source_type IN (
                            'staff_page', 'institution_directory', 'clinicaltrials',
                            'pubmed', 'orcid', 'linkedin', 'manual', 'inference'
                        )),
    source_url        TEXT,
    source_label      TEXT,

    confidence        INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
    is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
    visible           BOOLEAN NOT NULL DEFAULT TRUE,

    -- SMTP verification metadata
    last_verified_at  TIMESTAMPTZ,
    mx_valid          BOOLEAN,
    catch_all         BOOLEAN,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique: one email value per investigator (prevents duplicate runs adding duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_contacts_unique
    ON investigator_contacts (investigator_id, type, value);

-- Fast lookup by investigator
CREATE INDEX IF NOT EXISTS idx_inv_contacts_investigator
    ON investigator_contacts (investigator_id);

-- Find best primary contact quickly
CREATE INDEX IF NOT EXISTS idx_inv_contacts_primary
    ON investigator_contacts (investigator_id, is_primary, status)
    WHERE visible = TRUE;


CREATE TABLE IF NOT EXISTS investigator_enrichment_status (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigator_id  TEXT NOT NULL UNIQUE,
    status           TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started', 'queued', 'running', 'done', 'partial', 'failed')),
    contacts_found   INTEGER NOT NULL DEFAULT 0,
    last_run_at      TIMESTAMPTZ,
    error_message    TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_enrich_status
    ON investigator_enrichment_status (status);
