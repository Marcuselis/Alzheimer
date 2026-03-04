"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.query = query;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
exports.db = pool;
async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log(`[DB] ${text.substring(0, 50)}... (${duration}ms)`);
    return res;
}
