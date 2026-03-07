-- Migration: 012_enrichment_outcome_log
-- Adds structured per-run outcome tracking to investigator_enrichment_status.
-- Stores a JSONB outcome_log capturing exactly which stage succeeded/failed
-- so that failure patterns can be analyzed and prioritized for improvement.

ALTER TABLE investigator_enrichment_status
    ADD COLUMN IF NOT EXISTS outcome_log JSONB;

-- outcome_log shape:
-- {
--   "institutionRaw": "Mayo Clinic",
--   "domainResolved": "mayo.edu",
--   "domainSource": "normalized" | "inferred" | null,
--   "webSearchAttempted": true,
--   "webSearchResultCount": 3,
--   "pagesScraped": 2,
--   "publishedEmailFound": false,
--   "candidatesGenerated": 5,
--   "candidatesChecked": 5,
--   "verifiedCount": 0,
--   "rejectedCount": 3,
--   "catchAllCount": 2,
--   "unknownCount": 0,
--   "failureReasons": ["no_domain", "web_search_no_results", "all_smtp_rejected"]
-- }

-- Index for querying by failure reason (e.g. find all "no_domain" failures)
CREATE INDEX IF NOT EXISTS idx_inv_enrich_outcome_log
    ON investigator_enrichment_status USING gin (outcome_log)
    WHERE outcome_log IS NOT NULL;
