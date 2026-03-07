/**
 * Org normalization and domain resolution.
 *
 * Turns messy institution strings from ClinicalTrials.gov into canonical
 * names and email domains we can actually use.
 */

export interface OrgRecord {
  canonicalName: string;
  normalizedKey: string; // lowercase, stripped
  domain: string;
  websiteUrl: string;
  country: string;
  type: 'university' | 'hospital' | 'research_institute' | 'pharma' | 'cro' | 'other';
  aliases: string[];
}

// Curated institution registry — add more as enrichment runs encounter new orgs
const ORG_REGISTRY: OrgRecord[] = [
  // Nordic institutions
  {
    canonicalName: 'Karolinska University Hospital',
    normalizedKey: 'karolinska university hospital',
    domain: 'karolinska.se',
    websiteUrl: 'https://www.karolinska.se',
    country: 'Sweden',
    type: 'hospital',
    aliases: [
      'karolinska universitetssjukhuset',
      'karolinska universitetssjukhuset huddinge',
      'karolinska universitetssjukhuset solna',
      'karolinska university hospital, huddinge',
      'karolinska university hospital, solna',
    ],
  },
  {
    canonicalName: 'Karolinska Institutet',
    normalizedKey: 'karolinska institutet',
    domain: 'ki.se',
    websiteUrl: 'https://www.ki.se',
    country: 'Sweden',
    type: 'university',
    aliases: ['karolinska institute', 'ki', 'karolinska institutionen'],
  },
  {
    canonicalName: 'Uppsala University',
    normalizedKey: 'uppsala university',
    domain: 'uu.se',
    websiteUrl: 'https://www.uu.se',
    country: 'Sweden',
    type: 'university',
    aliases: ['uppsala universitet', 'university of uppsala'],
  },
  {
    canonicalName: 'Uppsala University Hospital',
    normalizedKey: 'uppsala university hospital',
    domain: 'akademiska.se',
    websiteUrl: 'https://www.akademiska.se',
    country: 'Sweden',
    type: 'hospital',
    aliases: ['akademiska sjukhuset', 'akademiska hospital'],
  },
  {
    canonicalName: 'Lund University',
    normalizedKey: 'lund university',
    domain: 'lu.se',
    websiteUrl: 'https://www.lu.se',
    country: 'Sweden',
    type: 'university',
    aliases: ['lunds universitet', 'university of lund'],
  },
  {
    canonicalName: 'Skane University Hospital',
    normalizedKey: 'skane university hospital',
    domain: 'skane.se',
    websiteUrl: 'https://www.skane.se',
    country: 'Sweden',
    type: 'hospital',
    aliases: ['skåne universitetssjukhus', 'sus', 'university hospital of skane', 'skane university hospital, malmo', 'skane university hospital, lund'],
  },
  {
    canonicalName: 'University of Gothenburg',
    normalizedKey: 'university of gothenburg',
    domain: 'gu.se',
    websiteUrl: 'https://www.gu.se',
    country: 'Sweden',
    type: 'university',
    aliases: ['göteborgs universitet', 'gothenburg university', 'goteborg university'],
  },
  {
    canonicalName: 'Sahlgrenska University Hospital',
    normalizedKey: 'sahlgrenska university hospital',
    domain: 'sahlgrenska.se',
    websiteUrl: 'https://www.sahlgrenska.se',
    country: 'Sweden',
    type: 'hospital',
    aliases: ['sahlgrenska universitetssjukhuset', 'sahlgrenska sjukhuset'],
  },
  {
    canonicalName: 'Oslo University Hospital',
    normalizedKey: 'oslo university hospital',
    domain: 'ous-hf.no',
    websiteUrl: 'https://www.ous-hf.no',
    country: 'Norway',
    type: 'hospital',
    aliases: ['oslo universitetssykehus', 'oslo university hospital hf', 'rikshospitalet', 'ulleval university hospital'],
  },
  {
    canonicalName: 'University of Oslo',
    normalizedKey: 'university of oslo',
    domain: 'uio.no',
    websiteUrl: 'https://www.uio.no',
    country: 'Norway',
    type: 'university',
    aliases: ['universitetet i oslo'],
  },
  {
    canonicalName: 'Copenhagen University Hospital',
    normalizedKey: 'copenhagen university hospital',
    domain: 'regionh.dk',
    websiteUrl: 'https://www.rigshospitalet.dk',
    country: 'Denmark',
    type: 'hospital',
    aliases: ['rigshospitalet', 'bispebjerg hospital', 'herlev hospital', 'gentofte hospital'],
  },
  {
    canonicalName: 'University of Copenhagen',
    normalizedKey: 'university of copenhagen',
    domain: 'ku.dk',
    websiteUrl: 'https://www.ku.dk',
    country: 'Denmark',
    type: 'university',
    aliases: ['kobenhavns universitet', 'københavns universitet', 'ku'],
  },
  {
    canonicalName: 'University of Helsinki',
    normalizedKey: 'university of helsinki',
    domain: 'helsinki.fi',
    websiteUrl: 'https://www.helsinki.fi',
    country: 'Finland',
    type: 'university',
    aliases: ['helsingin yliopisto'],
  },
  {
    canonicalName: 'Helsinki University Hospital',
    normalizedKey: 'helsinki university hospital',
    domain: 'hus.fi',
    websiteUrl: 'https://www.hus.fi',
    country: 'Finland',
    type: 'hospital',
    aliases: ['hus', 'helsingin ja uudenmaan sairaanhoitopiiri', 'helsinki university central hospital'],
  },

  // Major US/global AD research centers
  {
    canonicalName: 'Mayo Clinic',
    normalizedKey: 'mayo clinic',
    domain: 'mayo.edu',
    websiteUrl: 'https://www.mayo.edu',
    country: 'USA',
    type: 'hospital',
    aliases: ['mayo clinic rochester', 'mayo clinic arizona', 'mayo clinic florida'],
  },
  {
    canonicalName: 'Johns Hopkins University',
    normalizedKey: 'johns hopkins university',
    domain: 'jhu.edu',
    websiteUrl: 'https://www.jhu.edu',
    country: 'USA',
    type: 'university',
    aliases: ['johns hopkins', 'jhu', 'johns hopkins school of medicine'],
  },
  {
    canonicalName: 'Massachusetts General Hospital',
    normalizedKey: 'massachusetts general hospital',
    domain: 'mgh.harvard.edu',
    websiteUrl: 'https://www.massgeneral.org',
    country: 'USA',
    type: 'hospital',
    aliases: ['mgh', 'mass general hospital', 'mass general'],
  },
  {
    canonicalName: 'University of California San Francisco',
    normalizedKey: 'university of california san francisco',
    domain: 'ucsf.edu',
    websiteUrl: 'https://www.ucsf.edu',
    country: 'USA',
    type: 'university',
    aliases: ['ucsf', 'uc san francisco'],
  },
  {
    canonicalName: 'Washington University in St. Louis',
    normalizedKey: 'washington university in st louis',
    domain: 'wustl.edu',
    websiteUrl: 'https://www.wustl.edu',
    country: 'USA',
    type: 'university',
    aliases: ['washu', 'wash u', 'washington university', 'washington university school of medicine'],
  },
  {
    canonicalName: 'University College London',
    normalizedKey: 'university college london',
    domain: 'ucl.ac.uk',
    websiteUrl: 'https://www.ucl.ac.uk',
    country: 'UK',
    type: 'university',
    aliases: ['ucl', 'university of london'],
  },
];

// Build index for fast lookup
const INDEX_BY_KEY = new Map<string, OrgRecord>();
const INDEX_BY_ALIAS = new Map<string, OrgRecord>();

for (const org of ORG_REGISTRY) {
  INDEX_BY_KEY.set(org.normalizedKey, org);
  for (const alias of org.aliases) {
    INDEX_BY_ALIAS.set(alias.toLowerCase().trim(), org);
  }
}

/**
 * Strip noise from an institution string and return lowercase key.
 */
function makeKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/,?\s*(department|dept|division|div|school|faculty|center|centre|institute|unit)\s+of\b.*/gi, '')
    .replace(/\b(the|a|an)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeOrg(rawName: string): OrgRecord | null {
  const key = makeKey(rawName);

  // 1. Exact canonical key match
  if (INDEX_BY_KEY.has(key)) return INDEX_BY_KEY.get(key)!;

  // 2. Exact alias match
  if (INDEX_BY_ALIAS.has(key)) return INDEX_BY_ALIAS.get(key)!;

  // 3. Fuzzy: check if key starts with or contains a canonical key
  for (const [orgKey, org] of INDEX_BY_KEY) {
    if (key.startsWith(orgKey) || key.includes(orgKey)) return org;
  }
  for (const [aliasKey, org] of INDEX_BY_ALIAS) {
    if (key.startsWith(aliasKey) || key.includes(aliasKey)) return org;
  }

  return null;
}

/**
 * Try to infer a domain from a raw institution name when no registry entry exists.
 * Returns null if we can't make a reasonable guess.
 */
export function inferDomainFromName(rawName: string): string | null {
  const lower = rawName.toLowerCase();

  // Country-specific patterns
  if (lower.includes('university') && lower.includes('sweden')) return null; // too vague
  if (lower.match(/\bki\b/)) return 'ki.se';

  // Extract meaningful words for a slug
  const slug = lower
    .replace(/university|hospital|medical|center|centre|clinic|institute/g, '')
    .replace(/[^a-z ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 2)
    .join('');

  if (slug.length < 3) return null;

  // Guess TLD from country indicators
  if (lower.includes('sweden') || lower.includes('swedish') || lower.includes('karolinska') || lower.includes('stockholm')) {
    return `${slug}.se`;
  }
  if (lower.includes('norway') || lower.includes('norwegian') || lower.includes('oslo')) {
    return `${slug}.no`;
  }
  if (lower.includes('denmark') || lower.includes('danish') || lower.includes('copenhagen')) {
    return `${slug}.dk`;
  }
  if (lower.includes('finland') || lower.includes('finnish') || lower.includes('helsinki')) {
    return `${slug}.fi`;
  }
  if (lower.includes('uk') || lower.includes('united kingdom') || lower.includes('london') || lower.includes('oxford') || lower.includes('cambridge')) {
    return `${slug}.ac.uk`;
  }

  return null; // don't guess .com/.edu blindly
}

/**
 * Generate email candidates for a person given a domain.
 * Returns ordered list from most to least likely pattern.
 */
export function generateEmailCandidates(
  firstName: string,
  lastName: string,
  domain: string
): Array<{ email: string; pattern: string }> {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const l = lastName.toLowerCase().replace(/[^a-z]/g, '');
  const fi = f.charAt(0);

  if (!f || !l || !domain) return [];

  return [
    { email: `${f}.${l}@${domain}`, pattern: 'firstname.lastname' },
    { email: `${fi}.${l}@${domain}`, pattern: 'f.lastname' },
    { email: `${f}${l}@${domain}`, pattern: 'firstnamelastname' },
    { email: `${f}_${l}@${domain}`, pattern: 'firstname_lastname' },
    { email: `${l}.${f}@${domain}`, pattern: 'lastname.firstname' },
    { email: `${l}${fi}@${domain}`, pattern: 'lastnamef' },
  ];
}

/**
 * Parse a name string into first/last components.
 */
export function parseName(fullName: string): { firstName: string; lastName: string; normalized: string } {
  // Strip titles and degrees: Dr., Prof., PhD, MD, MSc, etc.
  const cleaned = fullName
    .replace(/\b(dr|prof|professor|mr|mrs|ms|sir)\b\.?/gi, '')
    .replace(/,?\s*(phd|md|msc|mph|dmsc|dphil|dsc|frcp|frcpc|frcpi|frcs|facp|mbbs|mbchb)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = cleaned.split(/\s+/);
  if (parts.length === 0) return { firstName: '', lastName: '', normalized: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '', normalized: parts[0].toLowerCase() };

  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(' ');
  const normalized = `${firstName} ${lastName}`.toLowerCase().trim();

  return { firstName, lastName, normalized };
}
