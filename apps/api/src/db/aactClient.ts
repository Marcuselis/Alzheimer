import { Pool } from 'pg';

/**
 * AACT (Aggregate Analysis of ClinicalTrials.gov) Warehouse Client
 * 
 * This client provides READ-ONLY access to the AACT database,
 * which contains a complete snapshot of ClinicalTrials.gov data.
 * 
 * AACT Schema Overview:
 * - studies: Core study information
 * - sponsors: Lead sponsors and collaborators
 * - conditions: Study conditions/diseases
 * - interventions: Study interventions (drugs, procedures)
 * - facilities: Study locations
 * - design_outcomes: Study endpoints
 * - eligibilities: Inclusion/exclusion criteria
 * 
 * Reference: https://aact.ctti-clinicaltrials.org/schema
 */

const aactConnectionString = process.env.AACT_DATABASE_URL || 
  'postgresql://app:app@localhost:5432/aact';

export const aactPool = new Pool({
  connectionString: aactConnectionString,
  max: 10, // Smaller pool since this is read-only
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Execute a READ-ONLY query against the AACT database
 */
export async function aactQuery(text: string, params?: any[]) {
  const start = Date.now();
  
  // Safety check: prevent write operations
  const upperQuery = text.trim().toUpperCase();
  if (
    upperQuery.startsWith('INSERT') ||
    upperQuery.startsWith('UPDATE') ||
    upperQuery.startsWith('DELETE') ||
    upperQuery.startsWith('DROP') ||
    upperQuery.startsWith('CREATE') ||
    upperQuery.startsWith('ALTER') ||
    upperQuery.startsWith('TRUNCATE')
  ) {
    throw new Error('AACT client is READ-ONLY. Write operations are not permitted.');
  }
  
  const res = await aactPool.query(text, params);
  const duration = Date.now() - start;
  
  console.log(`[AACT] ${text.substring(0, 80)}... (${duration}ms, ${res.rowCount} rows)`);
  
  return res;
}

/**
 * Get AACT database statistics
 */
export async function getAACTStats() {
  const stats = await aactQuery(`
    SELECT
      (SELECT COUNT(*) FROM studies) as total_studies,
      (SELECT COUNT(*) FROM sponsors WHERE lead_or_collaborator = 'lead') as total_sponsors,
      (SELECT COUNT(DISTINCT country) FROM facilities) as total_countries,
      (SELECT MAX(study_first_submitted_date) FROM studies) as latest_submission
  `);
  
  return stats.rows[0];
}

/**
 * Test AACT database connection
 */
export async function testAACTConnection(): Promise<boolean> {
  try {
    await aactQuery('SELECT 1');
    console.log('[AACT] Connection test successful');
    return true;
  } catch (error) {
    console.error('[AACT] Connection test failed:', error);
    return false;
  }
}

/**
 * Gracefully close the AACT connection pool
 */
export async function closeAACTPool() {
  await aactPool.end();
  console.log('[AACT] Connection pool closed');
}
