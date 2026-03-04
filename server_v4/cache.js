const { getDB } = require('./db');

/**
 * TTL cache wrapper for API responses
 */
class Cache {
    static get(key) {
        const db = getDB();
        const row = db.prepare('SELECT value_json, fetched_at, ttl_seconds FROM cache_entries WHERE key = ?').get(key);
        
        if (!row) return null;
        
        const age = Math.floor(Date.now() / 1000) - row.fetched_at;
        if (age > row.ttl_seconds) {
            // Expired, delete and return null
            db.prepare('DELETE FROM cache_entries WHERE key = ?').run(key);
            return null;
        }
        
        return JSON.parse(row.value_json);
    }
    
    static set(key, value, ttlSeconds = 3600) {
        const db = getDB();
        const now = Math.floor(Date.now() / 1000);
        const valueJson = JSON.stringify(value);
        
        db.prepare(`
            INSERT OR REPLACE INTO cache_entries (key, value_json, fetched_at, ttl_seconds)
            VALUES (?, ?, ?, ?)
        `).run(key, valueJson, now, ttlSeconds);
    }
    
    static clear(key) {
        const db = getDB();
        db.prepare('DELETE FROM cache_entries WHERE key = ?').run(key);
    }
    
    static clearExpired() {
        const db = getDB();
        const now = Math.floor(Date.now() / 1000);
        db.prepare(`
            DELETE FROM cache_entries 
            WHERE (fetched_at + ttl_seconds) < ?
        `).run(now);
    }
}

module.exports = Cache;
