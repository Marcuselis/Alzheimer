import { db } from '../db/client';

async function seed() {
  try {
    // Insert demo sponsors
    await db.query(`
      INSERT INTO sponsors (id, name) VALUES
        ('sponsor_biogen', 'Biogen'),
        ('sponsor_eli_lilly', 'Eli Lilly'),
        ('sponsor_roche', 'Roche')
      ON CONFLICT (id) DO NOTHING
    `);
    
    // Insert demo programs
    await db.query(`
      INSERT INTO programs (id, sponsor_id, molecule, indication, phase) VALUES
        ('program_1', 'sponsor_biogen', 'lecanemab', 'Alzheimer''s', 'Phase III'),
        ('program_2', 'sponsor_eli_lilly', 'donanemab', 'Alzheimer''s', 'Phase III'),
        ('program_3', 'sponsor_roche', 'gantenerumab', 'Alzheimer''s', 'Phase III')
      ON CONFLICT (id) DO NOTHING
    `);
    
    console.log('[Seed] Demo data inserted successfully');
    process.exit(0);
  } catch (error) {
    console.error('[Seed] Failed:', error);
    process.exit(1);
  }
}

seed();
