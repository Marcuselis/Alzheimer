import { db } from '../db/client';

const regions = [
  {
    code: 'US',
    name: 'United States',
    countries: ['US'],
    strategic_signal_score: 90,
  },
  {
    code: 'EU5',
    name: 'EU5',
    countries: ['DE', 'FR', 'IT', 'ES', 'GB'],
    strategic_signal_score: 90,
  },
  {
    code: 'UK',
    name: 'United Kingdom',
    countries: ['GB'],
    strategic_signal_score: 60,
  },
  {
    code: 'JP',
    name: 'Japan',
    countries: ['JP'],
    strategic_signal_score: 60,
  },
  {
    code: 'CN',
    name: 'China',
    countries: ['CN'],
    strategic_signal_score: 30,
  },
  {
    code: 'APAC_ex_China',
    name: 'APAC (ex-China)',
    countries: ['AU', 'NZ', 'KR', 'SG', 'TW', 'HK', 'MY', 'TH', 'ID', 'PH', 'VN'],
    strategic_signal_score: 30,
  },
  {
    code: 'LATAM',
    name: 'Latin America',
    countries: ['BR', 'MX', 'AR', 'CL', 'CO', 'PE'],
    strategic_signal_score: 30,
  },
];

async function seedRegions() {
  console.log('[Seed] Seeding regions...');
  
  for (const region of regions) {
    await db.query(`
      INSERT INTO regions (code, name, countries, strategic_signal_score)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        countries = EXCLUDED.countries,
        strategic_signal_score = EXCLUDED.strategic_signal_score,
        updated_at = NOW()
    `, [region.code, region.name, region.countries, region.strategic_signal_score]);
    
    console.log(`[Seed] Seeded region: ${region.code} - ${region.name}`);
  }
  
  console.log('[Seed] Regions seeding completed');
  process.exit(0);
}

seedRegions().catch((err) => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
