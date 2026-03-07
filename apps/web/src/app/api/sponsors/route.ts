import { NextResponse } from 'next/server';
import fs from 'fs';
import { getTrialsDataPath, loadRawTrials } from '@/lib/trialsData';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const dynamic = 'force-dynamic';

function topPhase(phases: string[]): string | null {
  const order = ['3', 'iii', '2', 'ii', '1', 'i'];
  for (const key of order) {
    const match = phases.find(p => p.toLowerCase().includes(key));
    if (match) return match;
  }
  return phases[0] ?? null;
}

function buildLocalSponsors(request: Request) {
  const dataPath = getTrialsDataPath();
  if (!fs.existsSync(dataPath)) {
    return { sponsors: [], total: 0 };
  }

  const trials = loadRawTrials(dataPath);
  const { searchParams } = new URL(request.url);
  const minTrials = parseInt(searchParams.get('minTrials') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '150', 10);
  const search = (searchParams.get('search') || '').toLowerCase();

  interface SponsorAcc {
    name: string;
    trialCount: number;
    activeTrialCount: number;
    phase3Count: number;
    recruitingCount: number;
    phases: string[];
  }

  const map = new Map<string, SponsorAcc>();

  for (const trial of trials) {
    const name = (trial.sponsor || '').trim();
    if (!name) continue;

    const status = (trial.status || '').toLowerCase();
    const phase = (trial.phase || '').toLowerCase();

    const isRecruiting = status === 'recruiting';
    const isActive = isRecruiting || status === 'not_yet_recruiting' || status === 'active_not_recruiting';
    const isPhase3 = phase.includes('3') || phase.includes('iii');

    const rec = map.get(name);
    if (rec) {
      rec.trialCount++;
      if (isActive) rec.activeTrialCount++;
      if (isRecruiting) rec.recruitingCount++;
      if (isPhase3) rec.phase3Count++;
      rec.phases.push(trial.phase);
    } else {
      map.set(name, {
        name,
        trialCount: 1,
        activeTrialCount: isActive ? 1 : 0,
        recruitingCount: isRecruiting ? 1 : 0,
        phase3Count: isPhase3 ? 1 : 0,
        phases: [trial.phase],
      });
    }
  }

  const sponsors = Array.from(map.values())
    .filter(s => s.trialCount >= minTrials)
    .filter(s => !search || s.name.toLowerCase().includes(search))
    .sort((a, b) => b.recruitingCount - a.recruitingCount || b.trialCount - a.trialCount)
    .slice(0, limit)
    .map(s => ({
      // Local fallback has no DB IDs; use name as stable local identifier.
      id: s.name,
      name: s.name,
      trialCount: s.trialCount,
      activeTrialCount: s.activeTrialCount,
      phase3Count: s.phase3Count,
      recruitingCount: s.recruitingCount,
      topPhase: topPhase(s.phases),
    }));

  return { sponsors, total: map.size };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const qs = searchParams.toString();
    const url = `${API_URL}/api/sponsors${qs ? `?${qs}` : ''}`;

    const resp = await fetch(url, {
      next: { revalidate: 0 },
    });

    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data?.sponsors) && data.sponsors.length > 0) {
        return NextResponse.json(data, { status: resp.status });
      }
    }

    return NextResponse.json(buildLocalSponsors(request));
  } catch {
    return NextResponse.json(buildLocalSponsors(request));
  }
}
