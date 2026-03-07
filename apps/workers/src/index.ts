import http from 'http';

// Start workers
import './workers';

// Create a simple HTTP health check server to keep the process alive
// and allow Railway to check health
const healthPort = parseInt(process.env.HEALTH_PORT || '3002', 10);

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      service: 'workers',
      timestamp: new Date().toISOString() 
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

healthServer.listen(healthPort, '0.0.0.0', () => {
  console.log(`[Workers] Health check server listening on port ${healthPort}`);
});

// Handle uncaught errors to prevent silent crashes
process.on('uncaughtException', (error) => {
  console.error('[Workers] Uncaught exception:', error);
  // Don't exit - try to keep running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Workers] Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit - try to keep running
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Workers] SIGTERM received, shutting down gracefully');
  healthServer.close(() => {
    console.log('[Workers] Health server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Workers] SIGINT received, shutting down gracefully');
  healthServer.close(() => {
    console.log('[Workers] Health server closed');
    process.exit(0);
  });
});

// Keep-alive heartbeat log
setInterval(() => {
  console.log(`[Workers] Heartbeat - still running at ${new Date().toISOString()}`);
}, 60000); // Log every minute

// ── Auto-enrichment cron ──────────────────────────────────────────────────────
// Runs once on startup (after 30s to let workers settle), then every 24h.
// Enqueues up to 20 unenriched trials per run, prioritising Phase 2/3.
import { runAutoEnrichment } from './jobs/autoEnrichTrialContacts';

const AUTO_ENRICH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

setTimeout(async () => {
  try {
    const result = await runAutoEnrichment();
    console.log(`[AutoEnrich] Startup run complete: ${result.queued} queued, ${result.skipped} skipped`);
  } catch (err: any) {
    console.error('[AutoEnrich] Startup run failed:', err.message);
  }
}, 30_000); // Wait 30s for workers to be ready

setInterval(async () => {
  try {
    const result = await runAutoEnrichment();
    console.log(`[AutoEnrich] Daily run complete: ${result.queued} queued, ${result.skipped} skipped`);
  } catch (err: any) {
    console.error('[AutoEnrich] Daily run failed:', err.message);
  }
}, AUTO_ENRICH_INTERVAL_MS);

// ── News ingest cron ──────────────────────────────────────────────────────────
// Runs daily to ingest news from ClinicalTrials.gov, PubMed, sponsor pages
import { runDailyNewsIngest } from './jobs/newsIngestJob';

const NEWS_INGEST_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

setTimeout(async () => {
  try {
    await runDailyNewsIngest();
  } catch (err: any) {
    console.error('[NewsIngestJob] Startup run failed:', err.message);
  }
}, 60_000); // Wait 60s for workers to settle

setInterval(async () => {
  try {
    await runDailyNewsIngest();
  } catch (err: any) {
    console.error('[NewsIngestJob] Scheduled run failed:', err.message);
  }
}, NEWS_INGEST_INTERVAL_MS);
