SELECT 
  investigator_id,
  status,
  contacts_found,
  error_message,
  outcome_log,
  last_run_at
FROM investigator_enrichment_status
WHERE investigator_id LIKE '%lanctot%'
ORDER BY last_run_at DESC
LIMIT 1;

-- Also check what contacts were written
SELECT 
  id, type, value, status, confidence, visible,
  source_type, source_label
FROM investigator_contacts
WHERE investigator_id LIKE '%lanctot%'
ORDER BY is_primary DESC, confidence DESC;
