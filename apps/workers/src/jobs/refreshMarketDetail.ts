import { Pool } from 'pg';
import fetch from 'node-fetch';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function exponentialBackoff(attempt: number, baseDelayMs: number = 1000, maxDelayMs: number = 30000): Promise<void> {
  const delay = Math.min(
    baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
    maxDelayMs
  );
  await sleep(delay);
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

const CT_API_BASE = 'https://clinicaltrials.gov/api/v2/studies';

/**
 * VAIHE 2: Detail Pull - Hidas, vain muutoksille
 * Hakee täydet tiedot vain niille NCT:ille joita tarvitaan
 */
const DETAIL_CONCURRENCY = 8;
const DETAIL_DELAY_MS = 50;
const DETAIL_UPDATE_BATCH = 25;

export async function refreshMarketDetail(
  nctIds: string[],
  concurrency: number = DETAIL_CONCURRENCY
): Promise<{
  status: string;
  trialsProcessed: number;
  error?: string;
}> {
  if (nctIds.length === 0) {
    return { status: 'completed', trialsProcessed: 0 };
  }
  
  console.log(`[Detail Pull] Fetching details for ${nctIds.length} trials (concurrency: ${concurrency})`);
  
  let totalProcessed = 0;
  const errors: string[] = [];
  const pendingUpdates: { nctId: string; detailJson: string }[] = [];
  
  async function flushUpdates() {
    if (pendingUpdates.length === 0) return;
    const batch = pendingUpdates.splice(0, pendingUpdates.length);
    const values: any[] = [];
    const placeholders: string[] = [];
    batch.forEach((row, i) => {
      const off = i * 2;
      placeholders.push(`($${off + 1}, $${off + 2}::jsonb)`);
      values.push(row.nctId, row.detailJson);
    });
    await db.query(`
      UPDATE trials t
      SET detail_json = v.detail_json, detail_fetched_at = NOW()
      FROM (VALUES ${placeholders.join(', ')}) AS v(nct_id, detail_json)
      WHERE t.nct_id = v.nct_id
    `, values);
  }
  
  for (let i = 0; i < nctIds.length; i += concurrency) {
    const batch = nctIds.slice(i, i + concurrency);
    
    await Promise.all(
      batch.map(async (nctId) => {
        try {
          const url = `${CT_API_BASE}/${nctId}`;
          let attempt = 0;
          let response: Response | null = null;
          
          while (attempt < 3) {
            try {
              response = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlzheimerAnalyst/1.0)' },
                timeout: 30000,
              } as any);
              if (response.ok) break;
              if (response.status === 429) {
                await exponentialBackoff(attempt, 2000, 30000);
                attempt++;
                continue;
              }
              throw new Error(`CT.gov API error: ${response.status}`);
            } catch (error: any) {
              attempt++;
              if (attempt >= 3) throw error;
              await exponentialBackoff(attempt, 1000, 10000);
            }
          }
          
          if (!response || !response.ok) throw new Error('Failed to fetch detail');
          const studyData = await response.json();
          
          const protocolSection = studyData.protocolSection || {};
          const identificationModule = protocolSection.identificationModule || {};
          const statusModule = protocolSection.statusModule || {};
          const designModule = protocolSection.designModule || {};
          const eligibilityModule = protocolSection.eligibilityModule || {};
          const armsInterventionsModule = protocolSection.armsInterventionsModule || {};
          const outcomesModule = protocolSection.outcomesModule || {};
          const contactsLocationsModule = protocolSection.contactsLocationsModule || {};
          
          const detailData = {
            primaryOutcomes: outcomesModule.primaryOutcomes || [],
            secondaryOutcomes: outcomesModule.secondaryOutcomes || [],
            otherOutcomes: outcomesModule.otherOutcomes || [],
            eligibilityCriteria: eligibilityModule.eligibilityCriteria || '',
            healthyVolunteers: eligibilityModule.healthyVolunteers || '',
            gender: eligibilityModule.gender || '',
            minimumAge: eligibilityModule.minimumAge || '',
            maximumAge: eligibilityModule.maximumAge || '',
            locations: (contactsLocationsModule.locations || []).map((loc: any) => ({
              facility: loc.facility || '',
              city: loc.city || '',
              state: loc.state || '',
              zip: loc.zip || '',
              country: loc.country || '',
              status: loc.status || '',
              geoPoint: loc.geoPoint || null,
            })),
            arms: (armsInterventionsModule.armGroups || []).map((arm: any) => ({
              armGroupLabel: arm.armGroupLabel || '',
              armGroupType: arm.armGroupType || '',
              description: arm.description || '',
            })),
            interventions: (armsInterventionsModule.interventions || []).map((intervention: any) => ({
              interventionType: intervention.interventionType || '',
              interventionName: intervention.interventionName || '',
              description: intervention.description || '',
            })),
            studyType: designModule.studyType || '',
            phases: designModule.phases || [],
            allocation: designModule.allocation || '',
            interventionModel: designModule.interventionModel || '',
            maskingInfo: designModule.maskingInfo || {},
            nctId: identificationModule.nctId || nctId,
            officialTitle: identificationModule.officialTitle || '',
            briefTitle: identificationModule.briefTitle || '',
          };
          
          pendingUpdates.push({ nctId, detailJson: JSON.stringify(detailData) });
          totalProcessed++;
          if (pendingUpdates.length >= DETAIL_UPDATE_BATCH) {
            await flushUpdates();
          }
          
          await sleep(DETAIL_DELAY_MS);
        } catch (error: any) {
          console.error(`[Detail Pull] Error fetching ${nctId}:`, error.message);
          errors.push(`${nctId}: ${error.message}`);
        }
      })
    );
    
    await flushUpdates();
    if ((i + concurrency) % 50 === 0 || i + concurrency >= nctIds.length) {
      console.log(`[Detail Pull] Processed ${Math.min(i + concurrency, nctIds.length)}/${nctIds.length} trials`);
    }
  }
  
  await flushUpdates();
  
  if (errors.length > 0) {
    console.warn(`[Detail Pull] ${errors.length} errors occurred`);
  }
  
  return {
    status: errors.length === nctIds.length ? 'error' : 'completed',
    trialsProcessed: totalProcessed,
    error: errors.length > 0 ? `${errors.length} errors: ${errors.slice(0, 3).join(', ')}` : undefined,
  };
}
