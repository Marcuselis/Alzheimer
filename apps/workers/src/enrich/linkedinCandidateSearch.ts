import { searchWeb } from '../sources/webSearch';

export type MatchStatus = 'matched' | 'possible' | 'rejected';

export interface LinkedInSearchInput {
  fullName: string;
  institution: string | null;
  country?: string | null;
  topic?: string | null;
}

export interface LinkedInCandidate {
  url: string;
  title: string;
  snippet: string;
  score: number;
  status: MatchStatus;
  nameMatch: boolean;
  institutionMatch: boolean;
  roleMatch: boolean;
  countryMatch: boolean;
}

function norm(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(v: string): string[] {
  return norm(v).split(' ').filter(t => t.length >= 2);
}

function titleRoleMatch(text: string, topic?: string | null): boolean {
  const keywords = [
    'clinical',
    'research',
    'trial',
    'neurology',
    'alzheimer',
    'medical',
    'scientist',
    'investigator',
    'director',
    'head',
    'lead',
    'manager',
    'vp',
    'vice president',
  ];

  if (topic) {
    keywords.push(...tokenize(topic));
  }

  return keywords.some(k => text.includes(k));
}

function scoreLinkedInCandidate(
  fullName: string,
  institution: string | null,
  country: string | null | undefined,
  topic: string | null | undefined,
  title: string,
  snippet: string,
  url: string
): LinkedInCandidate {
  const text = norm(`${title} ${snippet}`);
  const nameTokens = tokenize(fullName).filter(t => t.length >= 3);
  const institutionTokens = tokenize(institution || '').filter(
    t => !['the', 'and', 'for', 'of', 'university', 'hospital', 'center', 'centre', 'institute'].includes(t)
  );
  const countryTokens = tokenize(country || '');

  const nameHitCount = nameTokens.filter(t => text.includes(t)).length;
  const nameMatch = nameTokens.length > 0 && nameHitCount >= Math.max(1, Math.min(2, nameTokens.length));

  const institutionMatch = institutionTokens.length > 0 && institutionTokens.some(t => text.includes(t));
  const roleMatch = titleRoleMatch(text, topic);
  const countryMatch = countryTokens.length > 0 && countryTokens.some(t => text.includes(t));

  let score = 0;
  if (/linkedin\.com\/in\//i.test(url)) score += 25;
  if (nameMatch) score += 45;
  if (institutionMatch) score += 18;
  if (roleMatch) score += 8;
  if (countryMatch) score += 6;

  if (!nameMatch) score -= 35;

  const bounded = Math.max(0, Math.min(100, score));
  const status: MatchStatus = bounded >= 75 ? 'matched' : bounded >= 45 ? 'possible' : 'rejected';

  return {
    url,
    title,
    snippet,
    score: bounded,
    status,
    nameMatch,
    institutionMatch,
    roleMatch,
    countryMatch,
  };
}

export async function linkedinCandidateSearch(input: LinkedInSearchInput): Promise<LinkedInCandidate[]> {
  const queries = [
    `site:linkedin.com/in "${input.fullName}" "${input.institution || ''}"`,
    `site:linkedin.com/in "${input.fullName}" "${input.topic || 'alzheimer'}"`,
    `site:linkedin.com/in "${input.fullName}" clinical research`,
  ];

  const merged = new Map<string, { title: string; snippet: string }>();

  for (const q of queries) {
    const results = await searchWeb(q, 8);
    for (const r of results) {
      if (!/linkedin\.com\/in\//i.test(r.url)) continue;
      if (!merged.has(r.url)) merged.set(r.url, { title: r.title || '', snippet: r.snippet || '' });
    }
  }

  const scored = Array.from(merged.entries()).map(([url, meta]) =>
    scoreLinkedInCandidate(
      input.fullName,
      input.institution,
      input.country,
      input.topic,
      meta.title,
      meta.snippet,
      url
    )
  );

  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}
