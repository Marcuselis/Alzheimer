/**
 * Curated institution resolver — maps common names to authoritative domains
 * and search hints for staff/researcher discovery.
 *
 * For institutions without curated entries, falls back to naive domain inference.
 */

export interface InstitutionEntry {
  aliases: string[];
  primaryDomains: string[];
  searchHints: string[];
  notes?: string;
}

const CURATED_INSTITUTIONS: Record<string, InstitutionEntry> = {
  'sunnybrook': {
    aliases: [
      'Sunnybrook Research Institute',
      'Sunnybrook Health Sciences Centre',
      'Sunnybrook Hospital',
      'Sunnybrook',
      'SRI',
    ],
    primaryDomains: ['sunnybrook.ca', 'sri.ca'],
    searchHints: [
      'site:sunnybrook.ca researcher',
      'site:sunnybrook.ca neurology',
      'site:sunnybrook.ca faculty',
      'site:sunnybrook.ca staff',
    ],
    notes: 'Toronto-based academic health center'
  },
  'mayo': {
    aliases: [
      'Mayo Clinic',
      'Mayo',
      'Mayo Foundation',
    ],
    primaryDomains: ['mayo.edu'],
    searchHints: [
      'site:mayo.edu researcher',
      'site:mayo.edu alzheimer',
      'site:mayo.edu neurology',
    ],
  },
  'jhu': {
    aliases: [
      'Johns Hopkins',
      'Johns Hopkins University',
      'JHU',
    ],
    primaryDomains: ['jhu.edu', 'jhmi.edu'],
    searchHints: [
      'site:jhmi.edu researcher',
      'site:alzheimers.jhu.edu',
    ],
  },
  'upenn': {
    aliases: [
      'University of Pennsylvania',
      'Penn',
      'UPenn',
      'Penn Medicine',
    ],
    primaryDomains: ['upenn.edu', 'pennmedicine.org'],
    searchHints: [
      'site:pennmedicine.org researcher',
      'site:upenn.edu neurology',
    ],
  },
  'stanford': {
    aliases: [
      'Stanford University',
      'Stanford',
    ],
    primaryDomains: ['stanford.edu'],
    searchHints: [
      'site:stanford.edu researcher',
      'site:stanford.edu neurology',
    ],
  },
  'ucsf': {
    aliases: [
      'University of California San Francisco',
      'UCSF',
    ],
    primaryDomains: ['ucsf.edu'],
    searchHints: [
      'site:ucsf.edu researcher',
      'site:memory.ucsf.edu',
    ],
  },
  'harvard': {
    aliases: [
      'Harvard University',
      'Harvard',
      'Harvard Medical School',
    ],
    primaryDomains: ['harvard.edu'],
    searchHints: [
      'site:harvard.edu researcher',
      'site:hms.harvard.edu',
    ],
  },
  'nih': {
    aliases: [
      'National Institutes of Health',
      'NIH',
      'National Institute on Aging',
      'NIA',
    ],
    primaryDomains: ['nih.gov'],
    searchHints: [
      'site:nia.nih.gov researcher',
      'site:nih.gov alzheimer',
    ],
  },
  'osu': {
    aliases: [
      'Ohio State University',
      'Ohio State',
      'OSU',
    ],
    primaryDomains: ['osu.edu'],
    searchHints: [
      'site:osu.edu researcher',
      'site:osu.edu neurology',
    ],
  },
  'duke': {
    aliases: [
      'Duke University',
      'Duke',
      'Duke Medicine',
    ],
    primaryDomains: ['duke.edu'],
    searchHints: [
      'site:duke.edu researcher',
      'site:dukehealth.org',
    ],
  },
};

/**
 * Resolve institution to authoritative domain + search hints.
 * Returns null if not found in curated registry.
 */
export function resolveInstitution(institutionName: string | null): InstitutionEntry | null {
  if (!institutionName) return null;

  const normalized = institutionName.toLowerCase().trim();

  // Direct key lookup
  if (CURATED_INSTITUTIONS[normalized]) {
    return CURATED_INSTITUTIONS[normalized];
  }

  // Alias lookup
  for (const [key, entry] of Object.entries(CURATED_INSTITUTIONS)) {
    if (entry.aliases.some(a =>
      normalized.includes(a.toLowerCase()) ||
      a.toLowerCase().includes(normalized)
    )) {
      return entry;
    }
  }

  return null;
}

/**
 * Get all search hints for an institution (curated + domain-based).
 */
export function getSearchHints(institutionName: string | null, domain: string | null): string[] {
  const entry = resolveInstitution(institutionName);
  if (entry) {
    return entry.searchHints;
  }

  // Fallback: generate hints from domain
  if (domain) {
    return [
      `site:${domain} researcher`,
      `site:${domain} faculty`,
      `site:${domain} neurology`,
    ];
  }

  return [];
}
