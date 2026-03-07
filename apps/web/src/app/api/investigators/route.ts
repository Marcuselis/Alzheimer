import { NextResponse } from 'next/server';
import fs from 'fs';
import { getTrialsDataPath, loadRawTrials } from '@/lib/trialsData';

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function stripTitles(name: string) {
  return name.replace(/\b(Dr\.?|Prof\.?|MD|PhD|MPH|MBBS|MS|MSc)\b\.?/gi, '').replace(/\s+/g, ' ').trim();
}

function phaseWeight(phase: string): number {
  const p = (phase || '').toLowerCase();
  if (p.includes('3')) return 4;
  if (p.includes('2')) return 2;
  return 1;
}

function toInfluenceScore(weightSum: number): number {
  return Math.min(Math.round((weightSum / 25) * 100), 100);
}

interface InvAcc {
  fullName: string;
  slug: string;
  institution: string | null;
  trialCount: number;
  weightSum: number;
  seen: Set<string>;
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const dataPath = getTrialsDataPath();
    if (!fs.existsSync(dataPath)) {
      return NextResponse.json({ investigators: [], total: 0 });
    }

    const trials = loadRawTrials(dataPath);
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const minScore = parseInt(searchParams.get('minScore') || '0', 10);

    const map = new Map<string, InvAcc>();

    for (const trial of trials) {
      if (!trial.principal_investigators) continue;
      const weight = phaseWeight(trial.phase);

      for (const entry of trial.principal_investigators.split('|')) {
        const parts = entry.split(',').map(s => s.trim());
        const rawName = parts[0];
        if (!rawName || rawName.length < 3) continue;

        const name = stripTitles(rawName);
        if (!name || name.length < 3) continue;

        // Format: Name, Degree, Institution[, Dept/Hospital, City, Country...]
        const institution = parts.length >= 4 ? parts[3] : (parts.length >= 3 ? parts[2] : null);
        const slug = slugify(name);
        if (!slug) continue;

        const rec = map.get(slug);
        if (rec) {
          if (!rec.seen.has(trial.nct_id)) {
            rec.trialCount++;
            rec.weightSum += weight;
            rec.seen.add(trial.nct_id);
          }
          if (!rec.institution && institution) rec.institution = institution;
        } else {
          map.set(slug, { fullName: name, slug, institution: institution || null, trialCount: 1, weightSum: weight, seen: new Set([trial.nct_id]) });
        }
      }
    }

    const investigators = Array.from(map.values())
      .map(inv => ({
        personId: inv.slug,
        fullName: inv.fullName,
        normalizedName: inv.slug,
        primaryOrg: inv.institution,
        influenceScore: toInfluenceScore(inv.weightSum),
        trialCount: inv.trialCount,
        publicationCount: 0,
        primaryEmail: null,
        linkedinUrl: null,
        orcid: null,
      }))
      .filter(inv => inv.influenceScore >= minScore)
      .sort((a, b) => b.influenceScore - a.influenceScore || b.trialCount - a.trialCount)
      .slice(0, limit);

    return NextResponse.json({ investigators, total: map.size });
  } catch {
    return NextResponse.json({ investigators: [], total: 0 });
  }
}
