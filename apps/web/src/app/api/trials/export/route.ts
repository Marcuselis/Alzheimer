import { NextResponse } from 'next/server';
import fs from 'fs';
import {
  applyTrialFilters,
  getTrialsDataPath,
  loadRawTrials,
  preprocessTrials,
  sortTrials,
  type ProcessedTrial,
} from '@/lib/trialsData';
import { DEFAULT_EXPORT_COLUMNS, type ExportColumnKey } from '@/lib/trialExport';

export const dynamic = 'force-dynamic';

const ALLOWED_COLUMNS = new Set<ExportColumnKey>(DEFAULT_EXPORT_COLUMNS);

function parseColumns(searchParams: URLSearchParams) {
  const raw = searchParams.get('columns');
  if (!raw) return DEFAULT_EXPORT_COLUMNS;

  const requested = raw
    .split(',')
    .map((column) => column.trim())
    .filter((column): column is ExportColumnKey => ALLOWED_COLUMNS.has(column as ExportColumnKey));

  return requested.length > 0 ? requested : DEFAULT_EXPORT_COLUMNS;
}

function toCsvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function normalizeLocations(locations: string) {
  if (!locations) return '';
  return locations
    .split('|')
    .map((location) => location.trim())
    .filter(Boolean)
    .join(' | ');
}

function getColumnValue(trial: ProcessedTrial, column: ExportColumnKey) {
  if (column === 'nct_id') return trial.nct_id || '';
  if (column === 'title') return trial.title || '';
  if (column === 'sponsor') return trial.sponsor || '';
  if (column === 'phase') return trial.phase || '';
  if (column === 'status') return trial.status || '';
  if (column === 'enrollment') return trial.enrollment || '';
  if (column === 'molecules') return (trial.parsed_molecules || []).join(' | ');
  if (column === 'interventions') return trial.interventions || '';
  if (column === 'locations') return normalizeLocations(trial.locations || '');
  if (column === 'conditions') return (trial.conditions || []).join(' | ');
  if (column === 'clinicaltrials_url') return trial.nct_id ? `https://clinicaltrials.gov/study/${trial.nct_id}` : '';
  return '';
}

function buildCsv(trials: ProcessedTrial[], columns: ExportColumnKey[]) {
  const header = columns.join(',');
  const rows = trials.map((trial) =>
    columns.map((column) => toCsvCell(getColumnValue(trial, column))).join(',')
  );
  return `\uFEFF${[header, ...rows].join('\n')}`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dataPath = getTrialsDataPath();

    if (!fs.existsSync(dataPath)) {
      return NextResponse.json({ error: 'No data available. Please run the CSV import script first.' }, { status: 404 });
    }

    const rawTrials = loadRawTrials(dataPath);
    const trials = preprocessTrials(rawTrials);
    const filteredTrials = applyTrialFilters(trials, searchParams);

    const sortKey = searchParams.get('sortKey') || 'nct_id';
    const sortDirection = searchParams.get('sortDirection') === 'desc' ? 'desc' : 'asc';
    const sortedTrials = sortTrials(filteredTrials, sortKey, sortDirection);
    const columns = parseColumns(searchParams);

    const csv = buildCsv(sortedTrials, columns);
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `market-scan-results-${sortedTrials.length}-${date}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error exporting trials CSV:', error);
    return NextResponse.json({ error: 'Failed to export trials' }, { status: 500 });
  }
}
