// Self-contained metrics for workers (no dependency on @app/api)
import { Registry, Counter, Histogram } from 'prom-client';

export const register = new Registry();

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
