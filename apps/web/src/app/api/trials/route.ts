import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

interface Trial {
    nct_id: string;
    title: string;
    sponsor: string;
    phase: string;
    status: string;
    enrollment: string;
    locations: string;
    interventions: string;
    conditions?: string[]; // Optional in case of legacy data, but script now provides it
    // Computed fields for filtering
    parsed_countries?: string[];
    parsed_cities?: string[];
    parsed_molecules?: string[];
}

// GET /api/trials - Fetch trials with advanced filtering and facets
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);

        // Read the trials JSON file
        const dataPath = path.join(process.cwd(), 'data', 'generated', 'trials.json');

        if (!fs.existsSync(dataPath)) {
            return NextResponse.json({
                trials: [],
                total: 0,
                facets: {},
                message: 'No data available. Please run the CSV import script first.'
            });
        }

        const fileContent = fs.readFileSync(dataPath, 'utf-8');
        let rawTrials: Trial[] = JSON.parse(fileContent);

        // Pre-process trials to extract filterable fields
        // This acts as a lightweight "ETL" on the fly since our dataset is small (<1MB)
        const trials = rawTrials.map(t => {
            const countries = new Set<string>();
            const cities = new Set<string>();

            if (t.locations) {
                t.locations.split('|').forEach(loc => {
                    const parts = loc.split(',').map(p => p.trim());
                    if (parts.length > 0) {
                        const country = parts[parts.length - 1];
                        if (country) countries.add(country);

                        // Heuristic: City is usually before the postal code or region
                        // If we have at least 3 parts: Facility, City, ..., Country
                        if (parts.length >= 2) {
                            // Attempt to grab the city (simple heuristic, not perfect)
                            // Usually the second item or third from last
                            // Let's grab all parts except the last one (Country) as potential search text for now
                            // A stricter approach for "City" would need a geo-db, but for filtering "containment" checks work well.
                            parts.slice(0, -1).forEach(p => cities.add(p));
                        }
                    }
                });
            }

            const molecules = new Set<string>();
            if (t.interventions) {
                t.interventions.split('|').forEach(inver => {
                    // Extract "Drug Name" from "DRUG: Drug Name"
                    const parts = inver.split(':');
                    if (parts.length > 1) {
                        molecules.add(parts[1].trim());
                    } else {
                        molecules.add(inver.trim());
                    }
                });
            }

            return {
                ...t,
                parsed_countries: Array.from(countries),
                parsed_cities: Array.from(cities),
                parsed_molecules: Array.from(molecules)
            };
        });

        let filteredTrials = trials;

        // --- Filtering ---

        // 1. Molecule (Intervention)
        const moleculeInfo = searchParams.get('molecule');
        if (moleculeInfo) {
            const term = moleculeInfo.toLowerCase();
            filteredTrials = filteredTrials.filter(t =>
                t.parsed_molecules?.some(m => m.toLowerCase().includes(term))
            );
        }

        // 2. Sponsor
        const sponsor = searchParams.get('sponsor');
        if (sponsor) {
            filteredTrials = filteredTrials.filter(t =>
                t.sponsor?.toLowerCase().includes(sponsor.toLowerCase())
            );
        }

        // 3. Status
        const status = searchParams.get('status');
        if (status) {
            filteredTrials = filteredTrials.filter(t =>
                t.status?.toLowerCase().includes(status.toLowerCase())
            );
        }

        // 4. Phase
        const phase = searchParams.get('phase');
        if (phase && phase !== 'Any Phase') {
            filteredTrials = filteredTrials.filter(t =>
                t.phase?.includes(phase.toUpperCase())
            );
        }

        // 5. Region (Nordic Filter)
        const region = searchParams.get('region');
        const nordicCountries = ['Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland'];
        if (region === 'Nordic') {
            filteredTrials = filteredTrials.filter(t =>
                t.parsed_countries?.some(c => nordicCountries.some(nc => c.toLowerCase().includes(nc.toLowerCase())))
            );
        }

        // 6. Generic Text Search (Title, NCT, etc.)
        const search = searchParams.get('search');
        if (search) {
            const term = search.toLowerCase();
            filteredTrials = filteredTrials.filter(t =>
                t.title?.toLowerCase().includes(term) ||
                t.nct_id?.toLowerCase().includes(term) ||
                t.sponsor?.toLowerCase().includes(term)
            );
        }

        // 7. Specific Country/City Search
        const country = searchParams.get('country');
        if (country) {
            filteredTrials = filteredTrials.filter(t =>
                t.parsed_countries?.some(c => c.toLowerCase().includes(country.toLowerCase()))
            );
        }

        const city = searchParams.get('city');
        if (city) {
            filteredTrials = filteredTrials.filter(t =>
                t.parsed_cities?.some(c => c.toLowerCase().includes(city.toLowerCase()))
            );
        }


        // --- Facets (Nordic Presence) ---
        // Calculate stats for the dashboard regardless of current filters
        // (Use 'trials' source, not 'filteredTrials', unless we want facets to update with filters - usually dashboard is global)
        const nordicStats = {
            total: 0,
            sweden: 0,
            denmark: 0,
            norway: 0,
            finland: 0
        };

        // We calculate stats on the FILTERED results or GLOBAL?
        // User request visual: "Nordic Presence" implies a global overview or at least context-aware.
        // Let's do it on the whole dataset to show the "landscape" initially, 
        // effectively "Global Reach" = 28 (from user image) vs Nordic 
        // Actually, let's return the counts based on the *current filters* so it's dynamic.

        filteredTrials.forEach(t => {
            const countries = t.parsed_countries || [];
            let isNordic = false;

            if (countries.some(c => c.toLowerCase().includes('sweden'))) { nordicStats.sweden++; isNordic = true; }
            if (countries.some(c => c.toLowerCase().includes('denmark'))) { nordicStats.denmark++; isNordic = true; }
            if (countries.some(c => c.toLowerCase().includes('norway'))) { nordicStats.norway++; isNordic = true; }
            if (countries.some(c => c.toLowerCase().includes('finland'))) { nordicStats.finland++; isNordic = true; }

            if (isNordic) nordicStats.total++;
        });

        const totalCountries = new Set<string>();
        filteredTrials.forEach(t => t.parsed_countries?.forEach(c => totalCountries.add(c)));

        return NextResponse.json({
            trials: filteredTrials,
            total: filteredTrials.length,
            facets: {
                nordic: nordicStats,
                globalReach: totalCountries.size
            }
        });

    } catch (error) {
        console.error('Error fetching trials:', error);
        return NextResponse.json({
            trials: [],
            total: 0,
            facets: {},
            error: 'Failed to fetch trials'
        }, { status: 500 });
    }
}

