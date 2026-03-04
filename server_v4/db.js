const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'v4.db');
const DB_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

let db = null;

function getDB() {
    if (!db) {
        db = new Database(DB_PATH);
        initSchema();
    }
    return db;
}

function initSchema() {
    // Cache entries for API responses
    db.exec(`
        CREATE TABLE IF NOT EXISTS cache_entries (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            fetched_at INTEGER NOT NULL,
            ttl_seconds INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cache_fetched ON cache_entries(fetched_at);
    `);

    // Sponsors
    db.exec(`
        CREATE TABLE IF NOT EXISTS sponsors (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
    `);

    // Programs (molecules/indications)
    db.exec(`
        CREATE TABLE IF NOT EXISTS programs (
            id TEXT PRIMARY KEY,
            sponsor_id TEXT NOT NULL,
            molecule TEXT,
            indication TEXT,
            phase TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (sponsor_id) REFERENCES sponsors(id)
        );
        CREATE INDEX IF NOT EXISTS idx_programs_sponsor ON programs(sponsor_id);
    `);

    // Snapshots (trial data snapshots per program)
    db.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
            id TEXT PRIMARY KEY,
            program_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            FOREIGN KEY (program_id) REFERENCES programs(id)
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_program ON snapshots(program_id);
    `);

    // Briefs
    db.exec(`
        CREATE TABLE IF NOT EXISTS briefs (
            id TEXT PRIMARY KEY,
            program_id TEXT,
            sponsor_name TEXT,
            program_name TEXT,
            created_at INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            html_cache TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_briefs_program ON briefs(program_id);
    `);
}

function closeDB() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = { getDB, closeDB };
