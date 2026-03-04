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
