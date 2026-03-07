/**
 * Read-only DB access for investigator contacts.
 * All writes happen in the worker (investigatorContactEnrichment.ts).
 */

import { db } from './db/client';

export type ContactStatus = 'published' | 'verified' | 'inferred' | 'catch_all' | 'rejected' | 'unknown' | 'matched' | 'possible';
export type ContactType = 'email' | 'linkedin' | 'phone' | 'website';
export type SourceType =
  | 'staff_page' | 'institution_directory' | 'clinicaltrials'
  | 'pubmed' | 'orcid' | 'linkedin' | 'manual' | 'inference';
export type EnrichmentStatusValue = 'not_started' | 'queued' | 'running' | 'done' | 'partial' | 'failed';

export interface InvestigatorContact {
  id: string;
  investigatorId: string;
  type: ContactType;
  value: string;
  status: ContactStatus;
  sourceType: SourceType;
  sourceUrl: string | null;
  sourceLabel: string | null;
  confidence: number;
  isPrimary: boolean;
  visible: boolean;
  lastVerifiedAt: string | null;
  mxValid: boolean | null;
  catchAll: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnrichmentOutcomeLog {
  institutionRaw: string | null;
  domainResolved: string | null;
  domainSource: 'normalized' | 'inferred' | null;
  webSearchAttempted: boolean;
  webSearchResultCount: number;
  pagesScraped: number;
  publishedEmailFound: boolean;
  candidatesGenerated: number;
  candidatesChecked: number;
  verifiedCount: number;
  rejectedCount: number;
  catchAllCount: number;
  unknownCount: number;
  failureReasons: string[];
}

export interface InvestigatorEnrichmentStatus {
  investigatorId: string;
  status: EnrichmentStatusValue;
  contactsFound: number;
  lastRunAt: string | null;
  errorMessage: string | null;
  outcomeLog: EnrichmentOutcomeLog | null;
  updatedAt: string;
}

function mapContactRow(r: any): InvestigatorContact {
  return {
    id: r.id,
    investigatorId: r.investigator_id,
    type: r.type,
    value: r.value,
    status: r.status,
    sourceType: r.source_type,
    sourceUrl: r.source_url ?? null,
    sourceLabel: r.source_label ?? null,
    confidence: r.confidence,
    isPrimary: r.is_primary,
    visible: r.visible,
    lastVerifiedAt: r.last_verified_at?.toISOString() ?? null,
    mxValid: r.mx_valid ?? null,
    catchAll: r.catch_all ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function getContactsForInvestigator(investigatorId: string): Promise<InvestigatorContact[]> {
  const result = await db.query(
    `SELECT *
     FROM investigator_contacts
     WHERE investigator_id = $1
       AND visible = TRUE
     ORDER BY
       is_primary DESC,
       CASE status
         WHEN 'published'  THEN 1
         WHEN 'matched'    THEN 2
         WHEN 'verified'   THEN 3
         WHEN 'possible'   THEN 4
         WHEN 'inferred'   THEN 5
         WHEN 'catch_all'  THEN 6
         WHEN 'unknown'    THEN 7
         WHEN 'rejected'   THEN 8
       END,
       confidence DESC`,
    [investigatorId]
  );
  return result.rows.map(mapContactRow);
}

export async function getBestEmailForInvestigator(investigatorId: string): Promise<InvestigatorContact | null> {
  const result = await db.query(
    `SELECT *
     FROM investigator_contacts
     WHERE investigator_id = $1
       AND type = 'email'
       AND visible = TRUE
       AND status != 'rejected'
     ORDER BY
       CASE status
         WHEN 'published'  THEN 1
         WHEN 'verified'   THEN 2
         WHEN 'inferred'   THEN 3
         WHEN 'catch_all'  THEN 4
         ELSE 5
       END,
       confidence DESC
     LIMIT 1`,
    [investigatorId]
  );
  return result.rows.length > 0 ? mapContactRow(result.rows[0]) : null;
}

export async function getEnrichmentStatus(investigatorId: string): Promise<InvestigatorEnrichmentStatus> {
  const result = await db.query(
    `SELECT * FROM investigator_enrichment_status WHERE investigator_id = $1`,
    [investigatorId]
  );
  if (result.rows.length === 0) {
    return {
      investigatorId,
      status: 'not_started',
      contactsFound: 0,
      lastRunAt: null,
      errorMessage: null,
      outcomeLog: null,
      updatedAt: new Date().toISOString(),
    };
  }
  const r = result.rows[0];
  return {
    investigatorId: r.investigator_id,
    status: r.status,
    contactsFound: r.contacts_found,
    lastRunAt: r.last_run_at?.toISOString() ?? null,
    errorMessage: r.error_message ?? null,
    outcomeLog: r.outcome_log ?? null,
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function getBestEmailsBatch(
  investigatorIds: string[]
): Promise<Map<string, InvestigatorContact>> {
  if (investigatorIds.length === 0) return new Map();

  const result = await db.query(
    `SELECT DISTINCT ON (investigator_id)
       *
     FROM investigator_contacts
     WHERE investigator_id = ANY($1)
       AND type = 'email'
       AND visible = TRUE
       AND status != 'rejected'
     ORDER BY
       investigator_id,
       CASE status
         WHEN 'published'  THEN 1
         WHEN 'verified'   THEN 2
         WHEN 'inferred'   THEN 3
         WHEN 'catch_all'  THEN 4
         ELSE 5
       END,
       confidence DESC`,
    [investigatorIds]
  );

  const out = new Map<string, InvestigatorContact>();
  for (const row of result.rows) {
    out.set(row.investigator_id, mapContactRow(row));
  }
  return out;
}

export async function getEnrichmentStatusBatch(
  investigatorIds: string[]
): Promise<Map<string, InvestigatorEnrichmentStatus>> {
  if (investigatorIds.length === 0) return new Map();

  const result = await db.query(
    `SELECT * FROM investigator_enrichment_status WHERE investigator_id = ANY($1)`,
    [investigatorIds]
  );

  const out = new Map<string, InvestigatorEnrichmentStatus>();
  for (const r of result.rows) {
    out.set(r.investigator_id, {
      investigatorId: r.investigator_id,
      status: r.status,
      contactsFound: r.contacts_found,
      lastRunAt: r.last_run_at?.toISOString() ?? null,
      errorMessage: r.error_message ?? null,
      outcomeLog: r.outcome_log ?? null,
      updatedAt: r.updated_at.toISOString(),
    });
  }
  return out;
}
