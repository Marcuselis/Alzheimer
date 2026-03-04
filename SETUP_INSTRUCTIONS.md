# Setup Instructions

## ✅ Completed Steps

1. **Dependencies Installed**
   - Installed pnpm globally
   - Ran `pnpm install` - all 425 packages installed successfully
   - All workspace dependencies resolved

## ⚠️ Next Steps (Manual)

### 1. Start Docker Services

Docker Desktop must be running. Then start Postgres and Redis:

```bash
# Option A: Using docker compose (newer syntax)
docker compose up -d

# Option B: Using docker-compose (older syntax)
docker-compose up -d

# Option C: Using pnpm script (if docker-compose is available)
pnpm dev:docker
```

This will start:
- **Postgres** on port 5432
- **Redis** on port 6379

### 2. Run Database Migrations

Once Docker is running:

```bash
cd apps/api
pnpm db:migrate
```

This will:
- Create the `schema_migrations` table
- Run all 3 migration files:
  - `001_add_indexes.sql` - Performance indexes
  - `002_raw_payloads.sql` - Raw payload storage
  - `003_analysis_artifacts.sql` - Analysis tables

### 3. (Optional) Seed Database

```bash
cd apps/api
pnpm db:seed
```

This creates sample sponsors and a market definition for testing.

### 4. Start All Services

```bash
# From root directory
pnpm dev
```

This starts:
- **Web** (Next.js) on http://localhost:3000
- **API** (Fastify) on http://localhost:3001
- **Workers** (BullMQ consumers) in background

### 5. Verify Services

```bash
# Health check
curl http://localhost:3001/health

# Metrics
curl http://localhost:3001/metrics

# Markets list
curl http://localhost:3001/api/markets
```

## Troubleshooting

### Docker Not Running
- **macOS**: Open Docker Desktop application
- **Linux**: Start Docker service: `sudo systemctl start docker`
- Verify: `docker ps` should show running containers

### Port Conflicts
If ports 5432 or 6379 are already in use:
- Edit `docker-compose.yml` to change ports
- Update `DATABASE_URL` and `REDIS_URL` in environment variables

### Database Connection Errors
- Ensure Docker containers are running: `docker ps`
- Check logs: `docker compose logs postgres`
- Verify connection string in `.env` or environment

### Migration Errors
- Ensure Postgres is fully started (wait 5-10 seconds after `docker compose up`)
- Check if migrations table exists: `docker compose exec postgres psql -U app -d app -c "SELECT * FROM schema_migrations;"`

## Quick Start (Once Docker is Running)

```bash
# 1. Start Docker services
docker compose up -d

# 2. Wait 5 seconds for Postgres to initialize
sleep 5

# 3. Run migrations
cd apps/api && pnpm db:migrate && cd ../..

# 4. (Optional) Seed database
cd apps/api && pnpm db:seed && cd ../..

# 5. Start all services
pnpm dev
```

## What's Running

After setup, you'll have:

- ✅ **Postgres** - Database with all tables and indexes
- ✅ **Redis** - Cache and job queue
- ✅ **API Server** - Fastify on port 3001
- ✅ **Web App** - Next.js on port 3000
- ✅ **Workers** - Background job processors

All services are production-ready with:
- Structured logging
- Prometheus metrics
- Job queue system
- Caching layer
- Database migrations
