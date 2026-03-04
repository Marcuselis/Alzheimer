import { db } from '../db/client';

async function initMarket() {
  try {
    // Create default Alzheimer's market definition
    const marketDef = {
      id: 'market_alzheimers_phase23',
      key: 'alzheimers_phase23',
      indicationKey: 'alzheimers',
      ctgovConditionQuery: '("Alzheimer Disease" OR "Alzheimer\'s" OR "Mild Cognitive Impairment" OR MCI) AND NOT ("vascular dementia" OR "Parkinson")',
      phaseRange: ['PHASE2', 'PHASE23', 'PHASE3'],
      statuses: ['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION', 'NOT_YET_RECRUITING', 'COMPLETED'],
      updatedWithinDays: 30,
      geography: null,
    };
    
    await db.query(`
      INSERT INTO market_definitions (id, key, indication_key, ctgov_condition_query, phase_range, statuses, updated_within_days, geography, definition_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        definition_json = $9,
        updated_at = NOW()
    `, [
      marketDef.id,
      marketDef.key,
      marketDef.indicationKey,
      marketDef.ctgovConditionQuery,
      marketDef.phaseRange,
      marketDef.statuses,
      marketDef.updatedWithinDays,
      marketDef.geography,
      JSON.stringify(marketDef),
    ]);
    
    console.log('[Init] Market definition created: alzheimers_phase23');
    return true;
  } catch (error) {
    console.error('[Init] Failed:', error);
    throw error;
  }
}

// Only run and exit if called directly as a script
if (require.main === module) {
  initMarket()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { initMarket };
