-- Migration: 009_contact_verification
-- Adds verification tracking fields to contact_methods

ALTER TABLE contact_methods
  ADD COLUMN IF NOT EXISTS verification_status TEXT
    CHECK (verification_status IN ('published', 'verified', 'inferred', 'catch_all', 'rejected', 'unknown'))
    DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mx_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS catch_all BOOLEAN;

-- Index for querying unverified contacts that still need checking
CREATE INDEX IF NOT EXISTS idx_contact_methods_needs_verification
  ON contact_methods(verification_status, last_verified_at)
  WHERE type = 'email' AND verification_status IN ('inferred', 'unknown');
