import { searchWeb } from '../sources/webSearch';
import type { MatchStatus } from './linkedinCandidateSearch';

export interface ProfileDiscoveryInput {
  fullName: string;
  institution: string | null;
  domain: string | null;
  country?: string | null;
  topic?: string | null;
}

export interface ProfileCandidate {
  url: string;
  title: string;
  snippet: string;
  score: number;
  status: MatchStatus;
  isOfficialPage: boolean;
  nameMatch: boolean;
  institutionMatch: boolean;
  countryMatch: boolean;
}

function norm(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(v: string): string[] {
  return norm(v).split(' ').filter(t => t.length >= 2);
}

function isProfileLikeUrl(url: string): boolean {
  return [
    '/profile',
    '/people',
    '/person',
    '/staff',
    '/faculty',
    '/team',
    '/research',
    '/investigator',
    '/contact',
    '/directory',
  ].some(k => url.toLowerCase().includes(k));
}

function scoreProfile(
  fullName: string,
  institution: string | null,
  country: string | null | undefined,
  title: string,
  snippet: string,
  url: string
): ProfileCandidate {
  const text = norm(`${title} ${snippet}`);
  const nameTokens = tokenize(fullName).filter(t => t.length >= 3);
  const institutionTokens = tokenize(institution || '').filter(
    t => !['the', 'and', 'for', 'of', 'university', 'hospital', 'center', 'centre', 'institute'].includes(t)
  );
  const countryTokens = tokenize(country || '');

  const nameMatch = nameTokens.length > 0 && nameTokens.filter(t => text.includes(t)).length >= Math.max(1, Math.min(2, nameTokens.length));
  const institutionMatch = institutionTokens.length > 0 && institutionTokens.some(t => text.includes(t));
  const countryMatch = countryTokens.length > 0 && countryTokens.some(t => text.includes(t));
  const officialPage = isProfileLikeUrl(url);

  let score = 0;
  if (nameMatch) score += 45;
  if (institutionMatch) score += 25;
  if (officialPage) score += 15;
  if (countryMatch) score += 8;
  if (!nameMatch) score -= 30;

  const bounded = Math.max(0, Math.min(100, score));
  const status: MatchStatus = bounded >= 70 ? 'matched' : bounded >= 40 ? 'possible' : 'rejected';

  return {
    url,
    title,
    snippet,
    score: bounded,
    status,
    isOfficialPage: officialPage,
    nameMatch,
    institutionMatch,
    countryMatch,
  };
}

export async function profileDiscovery(input: ProfileDiscoveryInput): Promise<ProfileCandidate[]> {
  const base = input.institution || input.domain || 'research';
  const queries = [
    `"${input.fullName}" "${base}" profile`,
    `"${input.fullName}" "${base}" staff`,
    input.domain ? `site:${input.domain} "${input.fullName}"` : `"${input.fullName}" "${base}"`,
  ];

  const merged = new Map<string, { title: string; snippet: string }>();
  for (const q of queries) {
    const results = await searchWeb(q, 8);
    for (const r of results) {
      const url = r.url || '';
      if (!url || /linkedin\.com\/in\//i.test(url)) continue;
      if (!merged.has(url)) merged.set(url, { title: r.title || '', snippet: r.snippet || '' });
    }
  }

  const scored = Array.from(merged.entries()).map(([url, meta]) =>
    scoreProfile(input.fullName, input.institution, input.country, meta.title, meta.snippet, url)
  );

  return scored.sort((a, b) => b.score - a.score).slice(0, 5);
}
