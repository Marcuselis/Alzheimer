/**
 * Investigator read queries — used by the API layer.
 * All writes happen in the workers; this file only reads.
 */

import { db } from './db/client';

export interface InvestigatorProfile {
  personId: string;
  fullName: string;
  firstName: string;
  lastName: string;
  primaryRole: string;
  influenceScore: number;
  trialCount: number;
  publicationCount: number;
  orcid: string | null;
  linkedinUrl: string | null;
  primaryEmail: string | null;
  primaryEmailStatus: string | null;
  primaryEmailConfidence: number;
  primaryOrganization: string | null;
  primaryDomain: string | null;
  aliasNames: string[];
  trials: InvestigatorTrial[];
  sponsors: string[];
  allContactMethods: ContactMethodRow[];
}

export interface InvestigatorTrial {
  nctId: string;
  title: string;
  sponsor: string;
  phase: string;
  status: string;
  role: string;
  organization: string | null;
}

export interface ContactMethodRow {
  type: string;
  value: string;
  verificationStatus: string | null;
  confidence: number;
  label: string | null;
  isPrimary: boolean;
}

export interface InvestigatorListItem {
  personId: string;
  fullName: string;
  primaryOrganization: string | null;
  influenceScore: number;
  trialCount: number;
  primaryEmail: string | null;
  primaryEmailStatus: string | null;
  linkedinUrl: string | null;
}

export async function getInvestigatorProfile(personId: string): Promise<InvestigatorProfile | null> {
  // Core person record
  const personResult = await db.query(
    `SELECT
       p.id, p.full_name, p.first_name, p.last_name, p.primary_role,
       p.influence_score, p.trial_count, p.publication_count,
       p.orcid, p.alias_names,
       o.name AS org_name, o.primary_domain AS domain
     FROM people p
     LEFT JOIN organizations o ON o.id = p.primary_institution_id
     WHERE p.id = $1 AND p.canonical_person_id IS NULL`,
    [personId]
  );

  if (personResult.rows.length === 0) {
    // Maybe this is an alias — follow to canonical
    const aliasCheck = await db.query(
      'SELECT canonical_person_id FROM people WHERE id = $1',
      [personId]
    );
    const canonicalId = aliasCheck.rows[0]?.canonical_person_id;
    if (canonicalId) return getInvestigatorProfile(canonicalId);
    return null;
  }

  const p = personResult.rows[0];

  // Trials
  const trialsResult = await db.query(
    `SELECT
       tp.nct_id,
       t.payload_json->>'title' AS title,
       s.name AS sponsor,
       t.payload_json->>'phase' AS phase,
       t.payload_json->>'status' AS status,
       tp.role,
       o.name AS org_name
     FROM trial_people tp
     LEFT JOIN trials t ON t.nct_id = tp.nct_id
     LEFT JOIN sponsors s ON s.id = t.sponsor_id
     LEFT JOIN organizations o ON o.id = tp.organization_id
     WHERE tp.person_id = $1
     ORDER BY t.payload_json->>'phase' DESC, tp.nct_id`,
    [personId]
  );

  // Unique sponsors
  const sponsors = [...new Set(trialsResult.rows.map((r: any) => r.sponsor).filter(Boolean))];

  // Contact methods
  const contactResult = await db.query(
    `SELECT type, value, verification_status, confidence, label, is_primary
     FROM contact_methods
     WHERE person_id = $1
     ORDER BY is_primary DESC, confidence DESC`,
    [personId]
  );

  const allContactMethods: ContactMethodRow[] = contactResult.rows.map((r: any) => ({
    type: r.type,
    value: r.value,
    verificationStatus: r.verification_status,
    confidence: parseFloat(r.confidence) || 0,
    label: r.label,
    isPrimary: r.is_primary,
  }));

  const primaryEmail = allContactMethods.find(c => c.type === 'email' && c.isPrimary);
  const linkedinUrl = allContactMethods.find(c => c.type === 'linkedin' && c.isPrimary)?.value ?? null;

  return {
    personId: p.id,
    fullName: p.full_name,
    firstName: p.first_name,
    lastName: p.last_name,
    primaryRole: p.primary_role,
    influenceScore: p.influence_score,
    trialCount: p.trial_count,
    publicationCount: p.publication_count,
    orcid: p.orcid,
    linkedinUrl,
    primaryEmail: primaryEmail?.value ?? null,
    primaryEmailStatus: primaryEmail?.verificationStatus ?? null,
    primaryEmailConfidence: primaryEmail?.confidence ?? 0,
    primaryOrganization: p.org_name,
    primaryDomain: p.domain,
    aliasNames: p.alias_names ?? [],
    trials: trialsResult.rows.map((r: any) => ({
      nctId: r.nct_id,
      title: r.title ?? r.nct_id,
      sponsor: r.sponsor ?? 'Unknown',
      phase: r.phase ?? '',
      status: r.status ?? '',
      role: r.role,
      organization: r.org_name,
    })),
    sponsors,
    allContactMethods,
  };
}

export async function listTopInvestigators(options: {
  limit?: number;
  orgId?: string;
  minInfluenceScore?: number;
}): Promise<InvestigatorListItem[]> {
  const { limit = 50, orgId, minInfluenceScore = 0 } = options;

  const result = await db.query(
    `SELECT
       p.id,
       p.full_name,
       p.influence_score,
       p.trial_count,
       o.name AS org_name,
       cm_email.value AS primary_email,
       cm_email.verification_status AS email_status,
       cm_li.value AS linkedin_url
     FROM people p
     LEFT JOIN organizations o ON o.id = p.primary_institution_id
     LEFT JOIN LATERAL (
       SELECT value, verification_status
       FROM contact_methods
       WHERE person_id = p.id AND type = 'email' AND is_primary = true
       ORDER BY confidence DESC LIMIT 1
     ) cm_email ON TRUE
     LEFT JOIN LATERAL (
       SELECT value
       FROM contact_methods
       WHERE person_id = p.id AND type = 'linkedin' AND is_primary = true
       LIMIT 1
     ) cm_li ON TRUE
     WHERE p.canonical_person_id IS NULL
       AND p.influence_score >= $1
       ${orgId ? 'AND p.primary_institution_id = $3' : ''}
     ORDER BY p.influence_score DESC
     LIMIT $2`,
    orgId ? [minInfluenceScore, limit, orgId] : [minInfluenceScore, limit]
  );

  return result.rows.map((r: any) => ({
    personId: r.id,
    fullName: r.full_name,
    primaryOrganization: r.org_name ?? null,
    influenceScore: r.influence_score,
    trialCount: r.trial_count,
    primaryEmail: r.primary_email ?? null,
    primaryEmailStatus: r.email_status ?? null,
    linkedinUrl: r.linkedin_url ?? null,
  }));
}
