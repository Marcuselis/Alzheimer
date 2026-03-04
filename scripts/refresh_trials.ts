
import fs from 'fs';
import path from 'path';
import https from 'https';

// --- Types for ClinicalTrials.gov API v2 ---
interface ApiLocation {
    facility?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    geoPoint?: {
        lat: number;
        lon: number;
    };
}

interface ApiIntervention {
    type?: string;
    name?: string;
}

interface ApiStudy {
    protocolSection: {
        identificationModule: {
            nctId: string;
            briefTitle: string;
        };
        statusModule: {
            overallStatus: string;
        };
        sponsorCollaboratorsModule: {
            leadSponsor: {
                name: string;
            };
        };
        conditionsModule: {
            conditions: string[];
        };
        designModule?: {
            phases?: string[];
            studyType?: string;
            enrollmentInfo?: {
                count?: number;
            };
        };
        contactsLocationsModule?: {
            locations?: ApiLocation[];
        };
        armsInterventionsModule?: {
            interventions?: ApiIntervention[];
        };
    };
}

// --- Output Type (Matches existing trials.json) ---
interface Trial {
    nct_id: string;
    title: string;
    sponsor: string;
    phase: string;
    status: string;
    enrollment: string;
    locations: string;     // Pipe-separated strings: "Facility, City, Country"
    interventions: string; // Pipe-separated strings: "TYPE: Name"
    conditions: string[];
    geo?: ([number, number] | null)[]; // Array of [lat, lng]
}

const BASE_URL = "https://clinicaltrials.gov/api/v2/studies";

// Parameters based on user request
const PARAMS = {
    "query.cond": "Alzheimer Disease",
    "filter.overallStatus": "RECRUITING|NOT_YET_RECRUITING|ACTIVE_NOT_RECRUITING",
    // "query.studyType": "INTERVENTIONAL", // Caused 400 error
    "pageSize": "100",
    "fields": "protocolSection.identificationModule.nctId,protocolSection.identificationModule.briefTitle,protocolSection.statusModule.overallStatus,protocolSection.sponsorCollaboratorsModule.leadSponsor.name,protocolSection.conditionsModule.conditions,protocolSection.designModule.phases,protocolSection.designModule.enrollmentInfo.count,protocolSection.designModule.studyType,protocolSection.contactsLocationsModule.locations,protocolSection.armsInterventionsModule.interventions"
};

function fetchPage(pageToken?: string): Promise<{ studies: ApiStudy[], nextPageToken?: string }> {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE_URL);
        Object.entries(PARAMS).forEach(([key, value]) => url.searchParams.append(key, value));
        if (pageToken) {
            url.searchParams.append('pageToken', pageToken);
        }

        console.log(`Fetching: ${url.toString()}`);

        https.get(url.toString(), (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        reject(new Error(`API Error: ${res.statusCode} - ${data}`));
                        return;
                    }
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function main() {
    console.log("Starting ClinicalTrials.gov API sync...");

    let allStudies: ApiStudy[] = [];
    let nextPageToken: string | undefined = undefined;

    try {
        do {
            const data = await fetchPage(nextPageToken);
            if (data.studies) {
                allStudies = allStudies.concat(data.studies);
                console.log(`Fetched ${data.studies.length} studies. Total: ${allStudies.length}`);
            }
            nextPageToken = data.nextPageToken;
        } while (nextPageToken);

        console.log("Processing and transforming data...");
        // Filter for INTERVENTIONAL AND text match for Alzheimer in conditions (Strict Filter)
        const filteredStudies = allStudies.filter(s => {
            const isInterventional = s.protocolSection.designModule?.studyType === 'INTERVENTIONAL';
            const hasAlzheimer = s.protocolSection.conditionsModule?.conditions?.some(c =>
                c.toLowerCase().includes('alzheimer')
            );
            return isInterventional && hasAlzheimer;
        });

        console.log(`Filtered ${allStudies.length} studies to ${filteredStudies.length} INTERVENTIONAL Alzheimer studies.`);

        const trials: Trial[] = filteredStudies.map(study => {
            const proto = study.protocolSection;

            // Transform Locations
            // Format: "Facility, City, Country|..."
            const locations = (proto.contactsLocationsModule?.locations || []).map(loc => {
                const parts = [loc.facility, loc.city, loc.country].filter(Boolean);
                return parts.join(', ');
            }).join('|') || "";

            const geo = (proto.contactsLocationsModule?.locations || [])
                .map(loc => loc.geoPoint ? [loc.geoPoint.lat, loc.geoPoint.lon] as [number, number] : null);

            // Transform Interventions
            // Format: "TYPE: Name|..."
            const interventions = proto.armsInterventionsModule?.interventions?.map(inv => {
                return `${inv.type ? inv.type.toUpperCase() : 'OTHER'}: ${inv.name}`;
            }).join('|') || "";

            // Transform Phase
            // API returns array e.g. ["PHASE3"], we want string "PHASE3"
            const phase = proto.designModule?.phases?.join('|') || "N/A";

            return {
                nct_id: proto.identificationModule.nctId,
                title: proto.identificationModule.briefTitle,
                sponsor: proto.sponsorCollaboratorsModule.leadSponsor.name,
                phase: phase,
                status: proto.statusModule.overallStatus,
                enrollment: proto.designModule?.enrollmentInfo?.count?.toString() || "0",
                locations: locations,
                interventions: interventions,
                conditions: proto.conditionsModule?.conditions || [],
                geo: geo.length > 0 ? geo : undefined
            };
        });

        // Ensure output directory exists
        const outDir = path.join(process.cwd(), 'data', 'generated');
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        const outPath = path.join(outDir, 'trials.json');
        fs.writeFileSync(outPath, JSON.stringify(trials, null, 2));

        console.log(`Successfully saved ${trials.length} trials to ${outPath}`);

    } catch (err) {
        console.error("Failed to fetch trials:", err);
        process.exit(1);
    }
}

main();
