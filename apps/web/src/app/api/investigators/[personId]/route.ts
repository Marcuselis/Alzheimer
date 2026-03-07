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
  if (p.includes('3') || p.includes('iii')) return 4;
  if (p.includes('2') || p.includes('ii')) return 2;
  if (p.includes('1') || p.includes('i')) return 1;
  return 1;
}

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { personId: string } }
) {
  try {
    const dataPath = getTrialsDataPath();
    if (!fs.existsSync(dataPath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const trials = loadRawTrials(dataPath);
    const targetSlug = params.personId;

    let fullName: string | null = null;
    let institution: string | null = null;
    let weightSum = 0;
    const trialList: { nctId: string; title: string; sponsor: string; phase: string; status: string; role: string; organization: string | null }[] = [];
    const sponsorSet = new Set<string>();
    const seenNct = new Set<string>();

    for (const trial of trials) {
      if (!trial.principal_investigators) continue;

      for (const entry of trial.principal_investigators.split('|')) {
        const parts = entry.split(',').map(s => s.trim());
        const rawName = parts[0];
        if (!rawName || rawName.length < 3) continue;

        const name = stripTitles(rawName);
        if (!name || name.length < 3) continue;

        if (slugify(name) !== targetSlug) continue;

        // Matched
        if (!fullName) {
          fullName = name;
          institution = parts.length >= 4 ? parts[3] : (parts.length >= 3 ? parts[2] : null);
        }

        if (!seenNct.has(trial.nct_id)) {
          seenNct.add(trial.nct_id);
          weightSum += phaseWeight(trial.phase);
          if (trial.sponsor) sponsorSet.add(trial.sponsor);
          trialList.push({
            nctId: trial.nct_id,
            title: trial.title,
            sponsor: trial.sponsor,
            phase: trial.phase,
            status: trial.status,
            role: 'Principal Investigator',
            organization: institution,
          });
        }
      }
    }

    if (!fullName) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const influenceScore = Math.min(Math.round((weightSum / 25) * 100), 100);

    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ');

    return NextResponse.json({
      personId: targetSlug,
      fullName,
      firstName,
      lastName,
      primaryRole: 'principal_investigator',
      influenceScore,
      trialCount: trialList.length,
      publicationCount: 0,
      orcid: null,
      linkedinUrl: null,
      primaryEmail: null,
      primaryEmailStatus: null,
      primaryEmailConfidence: 0,
      primaryOrganization: institution,
      primaryDomain: null,
      aliasNames: [],
      trials: trialList,
      sponsors: Array.from(sponsorSet),
      allContactMethods: [],
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
