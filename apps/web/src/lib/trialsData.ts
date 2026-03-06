import fs from 'fs';
import path from 'path';

export interface Trial {
  nct_id: string;
  title: string;
  sponsor: string;
  phase: string;
  status: string;
  enrollment: string;
  locations: string;
  interventions: string;
  conditions?: string[];
  principal_investigators?: string; // Pipe-separated "Name, Affiliation"
}

export interface ProcessedTrial extends Trial {
  parsed_countries: string[];
  parsed_cities: string[];
  parsed_molecules: string[];
}

const NORDIC_COUNTRIES = ['Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland'];

export function getTrialsDataPath() {
  return path.join(process.cwd(), 'data', 'generated', 'trials.json');
}

export function loadRawTrials(dataPath: string) {
  const fileContent = fs.readFileSync(dataPath, 'utf-8');
  return JSON.parse(fileContent) as Trial[];
}

export function preprocessTrials(rawTrials: Trial[]): ProcessedTrial[] {
  return rawTrials.map((trial) => {
    const countries = new Set<string>();
    const cities = new Set<string>();

    if (trial.locations) {
      trial.locations.split('|').forEach((loc) => {
        const parts = loc.split(',').map((part) => part.trim());
        if (parts.length === 0) return;

        const country = parts[parts.length - 1];
        if (country) countries.add(country);

        if (parts.length >= 2) {
          parts.slice(0, -1).forEach((part) => cities.add(part));
        }
      });
    }

    const molecules = new Set<string>();
    if (trial.interventions) {
      trial.interventions.split('|').forEach((intervention) => {
        const parts = intervention.split(':');
        if (parts.length > 1) {
          molecules.add(parts.slice(1).join(':').trim());
        } else {
          molecules.add(intervention.trim());
        }
      });
    }

    return {
      ...trial,
      parsed_countries: Array.from(countries),
      parsed_cities: Array.from(cities),
      parsed_molecules: Array.from(molecules),
    };
  });
}

export function applyTrialFilters(trials: ProcessedTrial[], searchParams: URLSearchParams) {
  let filteredTrials = trials;

  const molecule = searchParams.get('molecule');
  if (molecule) {
    const term = molecule.toLowerCase();
    filteredTrials = filteredTrials.filter((trial) =>
      trial.parsed_molecules.some((item) => item.toLowerCase().includes(term))
    );
  }

  const sponsor = searchParams.get('sponsor');
  if (sponsor) {
    const term = sponsor.toLowerCase();
    filteredTrials = filteredTrials.filter((trial) => (trial.sponsor || '').toLowerCase().includes(term));
  }

  const status = searchParams.get('status');
  if (status) {
    const term = status.toLowerCase();
    filteredTrials = filteredTrials.filter((trial) => (trial.status || '').toLowerCase().includes(term));
  }

  const phases = searchParams
    .getAll('phase')
    .flatMap((phase) => phase.split(','))
    .map((phase) => phase.trim().toUpperCase())
    .filter(Boolean)
    .filter((phase) => phase !== 'ANY PHASE');
  if (phases.length > 0) {
    filteredTrials = filteredTrials.filter((trial) => {
      const trialPhase = (trial.phase || '').toUpperCase();
      return phases.some((phase) => trialPhase.includes(phase));
    });
  }

  const region = searchParams.get('region');
  if (region === 'Nordic') {
    filteredTrials = filteredTrials.filter((trial) =>
      trial.parsed_countries.some((country) =>
        NORDIC_COUNTRIES.some((nordicCountry) => country.toLowerCase().includes(nordicCountry.toLowerCase()))
      )
    );
  }

  const search = searchParams.get('search');
  if (search) {
    const term = search.toLowerCase();
    filteredTrials = filteredTrials.filter((trial) =>
      (trial.title || '').toLowerCase().includes(term) ||
      (trial.nct_id || '').toLowerCase().includes(term) ||
      (trial.sponsor || '').toLowerCase().includes(term)
    );
  }

  const country = searchParams.get('country');
  if (country) {
    const term = country.toLowerCase();
    filteredTrials = filteredTrials.filter((trial) =>
      trial.parsed_countries.some((item) => item.toLowerCase().includes(term))
    );
  }

  const city = searchParams.get('city');
  if (city) {
    const term = city.toLowerCase();
    filteredTrials = filteredTrials.filter((trial) =>
      trial.parsed_cities.some((item) => item.toLowerCase().includes(term))
    );
  }

  return filteredTrials;
}

export function buildFacets(filteredTrials: ProcessedTrial[]) {
  const nordicStats = {
    total: 0,
    sweden: 0,
    denmark: 0,
    norway: 0,
    finland: 0,
  };

  filteredTrials.forEach((trial) => {
    const countries = trial.parsed_countries || [];
    let isNordic = false;

    if (countries.some((country) => country.toLowerCase().includes('sweden'))) {
      nordicStats.sweden++;
      isNordic = true;
    }
    if (countries.some((country) => country.toLowerCase().includes('denmark'))) {
      nordicStats.denmark++;
      isNordic = true;
    }
    if (countries.some((country) => country.toLowerCase().includes('norway'))) {
      nordicStats.norway++;
      isNordic = true;
    }
    if (countries.some((country) => country.toLowerCase().includes('finland'))) {
      nordicStats.finland++;
      isNordic = true;
    }

    if (isNordic) nordicStats.total++;
  });

  const totalCountries = new Set<string>();
  filteredTrials.forEach((trial) => trial.parsed_countries.forEach((country) => totalCountries.add(country)));

  return {
    nordic: nordicStats,
    globalReach: totalCountries.size,
  };
}

export function sortTrials(
  trials: ProcessedTrial[],
  sortKey: string = 'nct_id',
  sortDirection: 'asc' | 'desc' = 'asc'
) {
  return [...trials].sort((a, b) => {
    let aValue: string = (a as any)[sortKey] || '';
    let bValue: string = (b as any)[sortKey] || '';

    if (sortKey === 'molecule') {
      aValue = a.parsed_molecules?.[0] || '';
      bValue = b.parsed_molecules?.[0] || '';
    }

    const aLower = aValue.toString().toLowerCase();
    const bLower = bValue.toString().toLowerCase();

    if (aLower < bLower) return sortDirection === 'asc' ? -1 : 1;
    if (aLower > bLower) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}
