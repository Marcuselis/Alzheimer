/**
 * Debug script to test investigator enrichment pipeline
 * Run: npx ts-node src/debug/testEnrichment.ts
 */

import { searchWeb } from '../sources/webSearch';
import { linkedinCandidateSearch } from '../enrich/linkedinCandidateSearch';
import { profileDiscovery } from '../enrich/profileDiscovery';
import { normalizeOrg, inferDomainFromName } from '../enrich/orgNormalization';

async function testEnrichment() {
  const testName = 'Krista L. Lanctot';
  const testInstitution = 'Sunnybrook Research Institute';

  console.log('\n=== TESTING INVESTIGATOR ENRICHMENT PIPELINE ===\n');
  console.log(`Test case: "${testName}" at "${testInstitution}"\n`);

  // Step 1: Domain resolution
  console.log('📍 Step 1: Domain Resolution');
  const orgRecord = normalizeOrg(testInstitution);
  console.log(`  Normalized: ${orgRecord ? JSON.stringify(orgRecord) : 'null'}`);
  const inferred = inferDomainFromName(testInstitution);
  console.log(`  Inferred: ${inferred || 'null'}`);
  const domain = orgRecord?.domain ?? inferred;
  console.log(`  ✓ Final domain: ${domain || 'NONE'}\n`);

  // Step 2: Web search test
  console.log('🔍 Step 2: Web Search');
  try {
    const query = `site:linkedin.com/in "${testName}"`;
    console.log(`  Query: ${query}`);
    const results = await searchWeb(query, 5);
    console.log(`  ✓ Found ${results.length} results`);
    results.forEach((r, i) => {
      console.log(`    ${i + 1}. ${r.url}`);
    });
  } catch (err: any) {
    console.log(`  ✗ Error: ${err.message}`);
  }
  console.log('');

  // Step 3: LinkedIn search
  console.log('💼 Step 3: LinkedIn Candidate Search');
  try {
    const candidates = await linkedinCandidateSearch({
      fullName: testName,
      institution: testInstitution,
      topic: 'alzheimer neurology',
    });
    console.log(`  ✓ Found ${candidates.length} candidates`);
    candidates.forEach((c, i) => {
      console.log(`    ${i + 1}. ${c.url} (score: ${c.score}, status: ${c.status})`);
    });
  } catch (err: any) {
    console.log(`  ✗ Error: ${err.message}`);
  }
  console.log('');

  // Step 4: Profile discovery
  console.log('🔗 Step 4: Profile Discovery');
  try {
    const profiles = await profileDiscovery({
      fullName: testName,
      institution: testInstitution,
      domain,
      topic: 'alzheimer neurology',
    });
    console.log(`  ✓ Found ${profiles.length} profiles`);
    profiles.forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.url} (score: ${p.score}, status: ${p.status})`);
    });
  } catch (err: any) {
    console.log(`  ✗ Error: ${err.message}`);
  }

  console.log('\n=== DIAGNOSTICS ===');
  console.log(`REDIS_URL: ${process.env.REDIS_URL ? '✓ set' : '✗ NOT SET'}`);
  console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? '✓ set' : '✗ NOT SET'}`);
  console.log('');
}

testEnrichment().catch(console.error);
