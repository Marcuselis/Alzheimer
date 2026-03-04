import { NextResponse } from 'next/server';
import fs from 'fs';
import {
  applyTrialFilters,
  buildFacets,
  getTrialsDataPath,
  loadRawTrials,
  preprocessTrials,
} from '@/lib/trialsData';

export const dynamic = 'force-dynamic';

// GET /api/trials - Fetch trials with advanced filtering and facets
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dataPath = getTrialsDataPath();

    if (!fs.existsSync(dataPath)) {
      return NextResponse.json({
        trials: [],
        total: 0,
        facets: {},
        message: 'No data available. Please run the CSV import script first.',
      });
    }

    const rawTrials = loadRawTrials(dataPath);
    const trials = preprocessTrials(rawTrials);
    const filteredTrials = applyTrialFilters(trials, searchParams);

    return NextResponse.json({
      trials: filteredTrials,
      total: filteredTrials.length,
      facets: buildFacets(filteredTrials),
    });
  } catch (error) {
    console.error('Error fetching trials:', error);
    return NextResponse.json(
      {
        trials: [],
        total: 0,
        facets: {},
        error: 'Failed to fetch trials',
      },
      { status: 500 }
    );
  }
}
