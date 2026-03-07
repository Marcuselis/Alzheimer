import { NextResponse } from 'next/server';
import fs from 'fs';
import { getTrialsDataPath, loadRawTrials } from '@/lib/trialsData';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const dynamic = 'force-dynamic';

interface SponsorSummary {
  id: string;
  name: string;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildCandidateKeys(raw: string): string[] {
  const once = safeDecode(raw);
  const twice = safeDecode(once);
  return Array.from(new Set([raw, once, twice].map(v => v.trim()).filter(Boolean)));
}

async function fetchSponsorById(sponsorId: string) {
  return fetch(`${API_URL}/api/sponsors/${encodeURIComponent(sponsorId)}`, {
    next: { revalidate: 0 },
  });
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function stripTitles(name: string) {
  return name.replace(/\b(Dr\.?|Prof\.?|MD|PhD|MPH|MBBS|MS|MSc)\b\.?/gi, '').replace(/\s+/g, ' ').trim();
}

function phaseWeight(phase: string): number {
  const p = (phase || '').toLowerCase();
  if (p.includes('3') || p.includes('iii')) return 4;
  if (p.includes('2') || p.includes('ii')) return 2;
  return 1;
}

function buildLocalSponsorDetail(sponsorName: string) {
  const dataPath = getTrialsDataPath();
  if (!fs.existsSync(dataPath)) return null;

  const trials = loadRawTrials(dataPath);
  const sponsorTrials = trials.filter(t => (t.sponsor || '').trim() === sponsorName);
  if (sponsorTrials.length === 0) return null;

  interface InvAcc {
    fullName: string;
    slug: string;
    institution: string | null;
    trialCount: number;
    weightSum: number;
    seen: Set<string>;
  }
  const invMap = new Map<string, InvAcc>();

  for (const trial of sponsorTrials) {
    if (!trial.principal_investigators) continue;
    const weight = phaseWeight(trial.phase);

    for (const entry of trial.principal_investigators.split('|')) {
      const parts = entry.split(',').map(s => s.trim());
      const rawName = parts[0];
      if (!rawName || rawName.length < 3) continue;
      const name = stripTitles(rawName);
      if (!name || name.length < 3) continue;
      const institution = parts.length >= 4 ? parts[3] : (parts.length >= 3 ? parts[2] : null);
      const slug = slugify(name);
      if (!slug) continue;

      const rec = invMap.get(slug);
      if (rec) {
        if (!rec.seen.has(trial.nct_id)) {
          rec.trialCount++;
          rec.weightSum += weight;
          rec.seen.add(trial.nct_id);
        }
        if (!rec.institution && institution) rec.institution = institution;
      } else {
        invMap.set(slug, {
          fullName: name,
          slug,
          institution: institution || null,
          trialCount: 1,
          weightSum: weight,
          seen: new Set([trial.nct_id]),
        });
      }
    }
  }

  const phaseMap = new Map<string, number>();
  const countrySet = new Set<string>();
  const interventionSet = new Set<string>();

  for (const t of sponsorTrials) {
    const phase = t.phase || 'Unknown';
    phaseMap.set(phase, (phaseMap.get(phase) || 0) + 1);

    if (t.locations) {
      t.locations.split('|').forEach(loc => {
        const parts = loc.split(',').map(s => s.trim());
        const country = parts[parts.length - 1];
        if (country) countrySet.add(country);
      });
    }

    if (t.interventions) {
      t.interventions.split('|').slice(0, 3).forEach(i => {
        const clean = i.split(':').slice(-1)[0]?.trim();
        if (clean && clean.length > 2) interventionSet.add(clean);
      });
    }
  }

  const statusOf = (t: typeof sponsorTrials[0]) => (t.status || '').toLowerCase();

  return {
    id: sponsorName,
    name: sponsorName,
    trialCount: sponsorTrials.length,
    activeTrialCount: sponsorTrials.filter(t => {
      const s = statusOf(t);
      return s === 'recruiting' || s === 'not_yet_recruiting' || s === 'active_not_recruiting';
    }).length,
    phase3Count: sponsorTrials.filter(t => {
      const p = (t.phase || '').toLowerCase();
      return p.includes('3') || p.includes('iii');
    }).length,
    recruitingCount: sponsorTrials.filter(t => statusOf(t) === 'recruiting').length,
    topPhase: null,
    trials: sponsorTrials.map(t => ({
      nctId: t.nct_id,
      title: t.title,
      phase: t.phase,
      status: t.status,
      enrollment: t.enrollment ? parseInt(t.enrollment, 10) || null : null,
      opportunityScore: null,
    })),
    investigators: Array.from(invMap.values())
      .sort((a, b) => b.weightSum - a.weightSum || b.trialCount - a.trialCount)
      .slice(0, 20)
      .map(inv => ({
        personId: inv.slug,
        fullName: inv.fullName,
        influenceScore: Math.min(Math.round((inv.weightSum / 25) * 100), 100),
        trialCount: inv.trialCount,
        primaryOrg: inv.institution,
        primaryEmail: null,
      })),
    phases: Array.from(phaseMap.entries())
      .map(([phase, count]) => ({ phase, count }))
      .sort((a, b) => b.count - a.count),
    countries: Array.from(countrySet).sort(),
    interventions: Array.from(interventionSet).slice(0, 15),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { sponsorId: string } }
) {
  const keys = buildCandidateKeys(params.sponsorId);

  try {
    for (const key of keys) {
      // Primary path: stable sponsor ID.
      const primaryResp = await fetchSponsorById(key);
      if (primaryResp.ok) {
        return NextResponse.json(await primaryResp.json(), { status: primaryResp.status });
      }

      // Backward-compatible path: if old links still use sponsor name, resolve to ID first.
      if (primaryResp.status === 404) {
        const searchResp = await fetch(
          `${API_URL}/api/sponsors?search=${encodeURIComponent(key)}&limit=500`,
          { next: { revalidate: 0 } }
        );

        if (searchResp.ok) {
          const data = (await searchResp.json()) as { sponsors?: SponsorSummary[] };
          const exact = (data.sponsors || []).find(
            s => s.name.toLowerCase() === key.toLowerCase()
          );

          if (exact) {
            const resolvedResp = await fetchSponsorById(exact.id);
            if (resolvedResp.ok) {
              return NextResponse.json(await resolvedResp.json(), { status: resolvedResp.status });
            }
          }
        }
      }
    }

    for (const key of keys) {
      const local = buildLocalSponsorDetail(key);
      if (local) return NextResponse.json(local);
    }

    return NextResponse.json({ error: 'Sponsor not found' }, { status: 404 });
  } catch {
    for (const key of keys) {
      const local = buildLocalSponsorDetail(key);
      if (local) return NextResponse.json(local);
    }

    return NextResponse.json({ error: 'API unreachable' }, { status: 503 });
  }
}
