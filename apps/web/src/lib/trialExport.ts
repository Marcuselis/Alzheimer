export const EXPORT_COLUMNS = [
  { key: 'nct_id', label: 'NCT ID' },
  { key: 'title', label: 'Title' },
  { key: 'sponsor', label: 'Sponsor' },
  { key: 'phase', label: 'Phase' },
  { key: 'status', label: 'Status' },
  { key: 'enrollment', label: 'Enrollment' },
  { key: 'molecules', label: 'Molecules' },
  { key: 'interventions', label: 'Interventions' },
  { key: 'locations', label: 'Locations (All Sites)' },
  { key: 'conditions', label: 'Conditions' },
  { key: 'clinicaltrials_url', label: 'ClinicalTrials URL' },
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]['key'];

export const DEFAULT_EXPORT_COLUMNS = EXPORT_COLUMNS.map((column) => column.key) as ExportColumnKey[];
