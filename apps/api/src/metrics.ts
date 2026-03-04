import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const register = new Registry();

// HTTP metrics
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['route', 'method', 'status'],
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
  registers: [register],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['route', 'method', 'status'],
  registers: [register],
});

// Cache metrics
export const cacheHits = new Counter({
  name: 'cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['key_prefix'],
  registers: [register],
});

export const cacheMisses = new Counter({
  name: 'cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['key_prefix'],
  registers: [register],
});

// Job metrics
export const jobDuration = new Histogram({
  name: 'job_duration_ms',
  help: 'Job duration in milliseconds',
  labelNames: ['job_type', 'status'],
  buckets: [100, 500, 1000, 5000, 10000, 30000, 60000],
  registers: [register],
});

export const ingestionItems = new Counter({
  name: 'ingestion_items_total',
  help: 'Total items ingested',
  labelNames: ['source', 'type'],
  registers: [register],
});

export const sourceFailures = new Counter({
  name: 'source_failures_total',
  help: 'Total source failures',
  labelNames: ['source'],
  registers: [register],
});

// Database metrics
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_ms',
  help: 'Database query duration in milliseconds',
  labelNames: ['table', 'operation'],
  registers: [register],
});
