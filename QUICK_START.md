# Quick Start Guide

## ✅ Current Status

Your services are **running**! Here's what's active:

- ✅ **Docker**: Postgres + Redis containers running
- ✅ **Database**: Migrations completed successfully
- ✅ **Web App**: Next.js on http://localhost:3000
- ✅ **API Server**: Fastify on http://localhost:3001
- ✅ **Workers**: Background job processors running

## 🚀 What You Can Do Now

### 1. Check API Health

```bash
curl http://localhost:3001/health
```

Should return: `{"status":"ok","timestamp":"..."}`

### 2. View Metrics

```bash
curl http://localhost:3001/metrics
```

Shows Prometheus metrics (request counts, cache hits, job durations, etc.)

### 3. Access Web App

Open in browser: **http://localhost:3000**

### 4. List Markets

```bash
curl http://localhost:3001/api/markets
```

### 5. Trigger Market Refresh

```bash
curl -X POST http://localhost:3001/api/markets/market_alzheimers_phase23/refresh
```

Returns a `jobId` - you can check status with:
```bash
curl http://localhost:3001/api/jobs/{jobId}?queue=market-refresh
```

### 6. Get Market Sponsors

```bash
curl http://localhost:3001/api/market/alzheimers/sponsors
```

## 📊 Monitoring

### View Logs

All services log to console. You should see:
- `[API] Server listening on http://0.0.0.0:3001`
- `[Workers] All workers started`
- Request logs with `request_id`

### Check Docker Containers

```bash
docker ps
```

Should show:
- `alzheimer-postgres` (healthy)
- `alzheimer-redis` (healthy)

### Check Database

```bash
docker compose exec postgres psql -U app -d app -c "SELECT COUNT(*) FROM trials;"
```

## 🎯 Next Steps

1. **Initialize Market Data**: Run a market refresh to ingest data from ClinicalTrials.gov
2. **Explore UI**: Navigate to Market Scan page in the web app
3. **View Metrics**: Check `/metrics` endpoint for system health
4. **Run Analysis**: Trigger analysis jobs for market insights

## 🐛 Troubleshooting

### API Not Responding

Check if it's still starting:
```bash
ps aux | grep "tsx.*api"
```

Check logs in the terminal where you ran `pnpm dev`

### Module Not Found Errors

If you see `@app/shared` errors:
```bash
cd packages/shared && pnpm build
cd ../.. && pnpm install
```

### Database Connection Issues

Ensure Docker is running:
```bash
docker ps
```

If containers aren't running:
```bash
docker compose up -d
```

## 📝 Useful Commands

```bash
# Stop all services
# Press Ctrl+C in the terminal running pnpm dev

# Restart services
pnpm dev

# Rebuild shared package
cd packages/shared && pnpm build

# Run migrations again
cd apps/api && pnpm db:migrate

# Seed database
cd apps/api && pnpm db:seed
```

## 🎉 You're All Set!

Your production-ready backend is running with:
- ✅ Fast serving (precomputed views + Redis cache)
- ✅ Professional ingestion (job queue + idempotency)
- ✅ Observability (structured logging + Prometheus metrics)
- ✅ Analysis artifacts system
- ✅ Tests infrastructure

Enjoy exploring the Alzheimer's market intelligence platform!
