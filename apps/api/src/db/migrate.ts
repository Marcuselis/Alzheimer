import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { db } from './client';

async function migrate() {
  try {
    // First, check if base schema exists - if not, run it
    const schemaCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'sponsors'
      )
    `);
    
    if (!schemaCheck.rows[0].exists) {
      console.log('[DB] Base schema not found. Running base schema first...');
      const schemaPath = join(__dirname, 'schema.sql');
      const schema = readFileSync(schemaPath, 'utf-8');
      await db.query(schema);
      console.log('[DB] Base schema applied');
    }
    
    const migrationsDir = join(__dirname, 'migrations');
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    console.log(`[DB] Found ${files.length} migration files`);
    
    // Create migrations tracking table
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    
    // Get applied migrations
    const appliedResult = await db.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map(r => r.version));
    
    for (const file of files) {
      const version = file.replace('.sql', '');
      
      if (applied.has(version)) {
        console.log(`[DB] Skipping already applied migration: ${version}`);
        continue;
      }
      
      console.log(`[DB] Applying migration: ${version}`);
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      
      await db.query(sql);
      
      await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      console.log(`[DB] Migration ${version} applied successfully`);
    }
    
    console.log('[DB] All migrations completed');
    return true;
  } catch (error) {
    console.error('[DB] Migration failed:', error);
    throw error;
  }
}

// Only run and exit if called directly as a script
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { migrate };
