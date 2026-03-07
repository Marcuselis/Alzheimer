-- Migration: 013_investigator_contact_match_status
-- Extend investigator contact status taxonomy to support profile/linkedin matching.

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'investigator_contacts'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE investigator_contacts DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE investigator_contacts
ADD CONSTRAINT investigator_contacts_status_check
CHECK (status IN (
  'published',
  'verified',
  'inferred',
  'catch_all',
  'rejected',
  'unknown',
  'matched',
  'possible'
));
