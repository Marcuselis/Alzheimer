# AACT Warehouse Setup Guide

This guide explains how to set up and use the AACT (Aggregate Analysis of ClinicalTrials.gov) warehouse for instant, local-first market intelligence.

## Overview

**AACT** is a comprehensive database snapshot of all ClinicalTrials.gov data. By loading it locally, we can:

- ✅ Query 500,000+ trials instantly (no API rate limits)
- ✅ Refresh Alzheimer market in <10 seconds (vs 15+ minutes with API)
- ✅ Zero external API dependencies for core data
- ✅ Keep CT.gov API as fallback when needed

## Architecture

```
┌─────────────────────┐
│   AACT Database     │  ← Read-only, complete CT.gov snapshot
│   (aact)            │
└──────────┬──────────┘
           │ Query Phase II-III Alzheimer trials
           ↓
┌─────────────────────┐
│  ETL Job (BullMQ)   │  ← importAlzheimersFromAACT
└──────────┬──────────┘
           │ Normalize & Upsert
           ↓
┌─────────────────────┐
│   App Database      │  ← Our normalized schema
│   (app)             │     trials, sponsors, market_trials, etc.
└─────────────────────┘
```

## Prerequisites

- Docker & Docker Compose installed
- At least 20GB free disk space (AACT snapshot is ~5GB compressed, ~15GB uncompressed)
- Postgres 16+ (included in docker-compose)

## Step-by-Step Setup

### 1. Download AACT Snapshot

Visit: https://aact.ctti-clinicaltrials.org/downloads/snapshots

**Recommended**: Download the latest PostgreSQL dump (.zip file)

Example filename: `20260125_clinical_trials.zip`

### 2. Place Snapshot in Project

```bash
# From project root
mkdir -p data/aact
mv ~/Downloads/20260125_clinical_trials.zip data/aact/aact_snapshot.zip
```

**Note**: The file is automatically git-ignored (see `.gitignore`)

### 3. Start Docker Services

```bash
# Start Postgres and Redis
pnpm dev:docker

# Wait for services to be healthy (~10 seconds)
docker ps
```

### 4. Restore AACT Database

```bash
# Run the restore script
bash scripts/aact_restore.sh
```

**What this does:**
1. Unzips the snapshot to `data/aact/extracted/`
2. Creates a new Postgres database called `aact`
3. Restores the dump into `aact` database
4. Verifies key tables exist (studies, sponsors, conditions, etc.)

**Expected output:**
```
========================================
AACT Database Restore Complete!
========================================

Connection string:
  postgresql://app:****@localhost:5432/aact

Next steps:
  1. Set AACT_DATABASE_URL env var in .env file
  2. Run AACT import job: pnpm workers run importAlzheimersFromAACT
```

**Time**: 5-10 minutes depending on disk speed

### 5. Configure Environment

Create or update `.env` file in project root:

```bash
# App database (existing)
DATABASE_URL=postgresql://app:app@localhost:5432/app

# AACT warehouse database (new)
AACT_DATABASE_URL=postgresql://app:app@localhost:5432/aact

# Enable AACT mode (optional - set to 'true' to use warehouse instead of API)
USE_AACT=false
```

**Important**: Set `USE_AACT=false` initially to test without disrupting existing flow

### 6. Import Alzheimer Phase II-III Trials

Now we extract the Alzheimer subset from AACT into our app database:

```bash
# Start workers (in one terminal)
pnpm dev:workers

# In another terminal, trigger the import via API
curl -X POST http://localhost:3001/api/markets/market_alzheimer_phase23/refresh?quick=true
```

**Or run directly via worker:**

```typescript
// Create a script: scripts/runAactImport.ts
import { importAlzheimersFromAACT } from '../apps/workers/src/jobs/importAlzheimersFromAACT';

async function main() {
  const result = await importAlzheimersFromAACT({
    marketId: 'market_alzheimer_phase23',
    limit: 5000,
  });
  
  console.log('Import result:', result);
  process.exit(result.status === 'completed' ? 0 : 1);
}

main();
```

**Expected output:**
```
[AACT Import] Starting import for market market_alzheimer_phase23
[AACT Import] Query limit: 5000 studies
[AACT Import] Found 847 Alzheimer Phase II-III trials
[AACT Import] Processed 42 unique sponsors
[AACT Import] Successfully imported 847 trials
[AACT Import] Computing market rollups...
[AACT Import] Import completed successfully
```

**Time**: 10-30 seconds for full import

### 7. Verify Import

Check warehouse status:

```bash
curl http://localhost:3001/api/warehouse/status | jq
```

Expected response:
```json
{
  "enabled": false,
  "connected": true,
  "status": "online",
  "message": "AACT warehouse is ready but not enabled. Set USE_AACT=true to activate.",
  "aactDatabase": {
    "totalStudies": 502847,
    "totalSponsors": 15234,
    "totalCountries": 195,
    "latestSubmission": "2026-01-20T00:00:00.000Z"
  },
  "appDatabase": {
    "alzheimerPhase23Imported": 847,
    "lastImportTimestamp": "2026-01-25T10:30:45.123Z",
    "trialsProcessed": 847
  }
}
```

### 8. Test Market Scan (Still Using API)

```bash
# This still uses CT.gov API (USE_AACT=false)
curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors | jq '.sponsors | length'
```

Should return the imported sponsors.

### 9. Enable AACT Mode (Optional)

Once you've verified the import works, enable AACT mode:

**.env**
```bash
USE_AACT=true
```

Restart workers:
```bash
pnpm dev:workers
```

Now when you trigger a market refresh, it will use the AACT warehouse instead of CT.gov API:

```bash
curl -X POST http://localhost:3001/api/markets/market_alzheimer_phase23/refresh
```

**Speed comparison:**
- **API mode** (USE_AACT=false): 15+ minutes for full refresh
- **AACT mode** (USE_AACT=true): <10 seconds for full refresh ⚡

### 10. Open Web UI

```bash
pnpm dev:web
```

Visit: http://localhost:3000/market-scan

Market data should load instantly from local warehouse.

## Maintenance & Updates

### Refreshing AACT Snapshot

AACT releases monthly snapshots. To update:

1. Download latest snapshot
2. Replace `data/aact/aact_snapshot.zip`
3. Delete `data/aact/extracted/` folder
4. Drop and recreate AACT database:
   ```bash
   dropdb -h localhost -U app aact
   bash scripts/aact_restore.sh
   ```
5. Re-import Alzheimer subset:
   ```bash
   curl -X POST http://localhost:3001/api/markets/market_alzheimer_phase23/refresh
   ```

### Switching Between API and Warehouse Mode

You can switch anytime by changing `USE_AACT` env var:

- `USE_AACT=false`: Use CT.gov API (slower, always fresh)
- `USE_AACT=true`: Use AACT warehouse (faster, monthly snapshots)

No code changes needed - the worker automatically detects the flag.

## Troubleshooting

### "AACT database not accessible"

**Problem**: Can't connect to AACT database

**Solution**:
```bash
# Check if database exists
psql -h localhost -U app -l | grep aact

# If missing, restore:
bash scripts/aact_restore.sh

# Check connection string in .env
echo $AACT_DATABASE_URL
```

### "No studies found"

**Problem**: AACT query returns 0 results

**Solutions**:
1. Verify AACT tables exist:
   ```bash
   psql -h localhost -U app -d aact -c "\dt"
   ```
   Should show: studies, sponsors, conditions, interventions, facilities

2. Check if snapshot was fully restored:
   ```bash
   psql -h localhost -U app -d aact -c "SELECT COUNT(*) FROM studies"
   ```
   Should return 400,000+ rows

3. Re-run restore script:
   ```bash
   bash scripts/aact_restore.sh
   ```

### "Import completed but Market Scan is empty"

**Problem**: Import succeeded but UI shows no data

**Solutions**:
1. Check market state:
   ```bash
   curl http://localhost:3001/api/markets/market_alzheimer_phase23/summary | jq
   ```

2. Verify trials were imported:
   ```bash
   psql -h localhost -U app -d app -c "SELECT COUNT(*) FROM trials WHERE source = 'aact'"
   ```

3. Check market rollups:
   ```bash
   psql -h localhost -U app -d app -c "SELECT COUNT(*) FROM mv_market_sponsor_rollup WHERE market_id = 'market_alzheimer_phase23'"
   ```

4. Manually trigger rollup computation:
   ```sql
   -- Connect to app database
   psql -h localhost -U app -d app
   
   -- Clear and recompute rollups (handled by import job normally)
   ```

### "pg_restore fails with permission errors"

**Problem**: Script shows permission denied errors

**Solution**:
The restore script uses `--no-owner --no-privileges` flags to avoid permission issues. If you still see errors:

```bash
# Ensure Postgres user has superuser rights
psql -h localhost -U app -d postgres -c "ALTER USER app WITH SUPERUSER"

# Or restore as postgres user
AACT_DB_USER=postgres bash scripts/aact_restore.sh
```

## Performance Notes

### AACT Database Size

- **Compressed snapshot**: ~5GB
- **Uncompressed dump**: ~8GB
- **Restored database**: ~15GB (with indexes)

Total disk usage: ~23GB

### Import Performance

| Metric | Value |
|--------|-------|
| AACT studies indexed | 500,000+ |
| Alzheimer Phase II-III trials | ~800-1000 |
| Import time (full) | 10-30 seconds |
| Import time (incremental) | 2-5 seconds |
| Market refresh API mode | 15+ minutes |
| Market refresh AACT mode | <10 seconds |

### Query Performance

AACT queries are significantly faster:

- **API call**: 100-500ms per request (rate limited)
- **AACT query**: 5-20ms per query (no limits)

For 1000 trials:
- **API mode**: ~15 minutes (1000 calls × 1 second avg)
- **AACT mode**: ~10 seconds (1 bulk query + normalization)

## AACT Schema Reference

Key tables in AACT database:

### studies
Core study information (NCT ID, title, status, phase, enrollment, dates)

### sponsors
Lead sponsors and collaborators

### conditions
Study conditions/diseases (searchable)

### interventions
Study interventions (drugs, procedures, devices)

### facilities
Study locations (sites, countries, investigators)

### design_outcomes
Study endpoints (primary/secondary outcomes)

### eligibilities
Inclusion/exclusion criteria

### calculated_values
Precomputed metrics (enrollment rates, etc.)

Full schema documentation: https://aact.ctti-clinicaltrials.org/schema

## API Endpoints

### Get Warehouse Status

```bash
GET /api/warehouse/status
```

Response:
```json
{
  "enabled": true,
  "connected": true,
  "status": "online",
  "aactDatabase": {
    "totalStudies": 502847,
    "totalSponsors": 15234,
    "totalCountries": 195
  },
  "appDatabase": {
    "alzheimerPhase23Imported": 847,
    "lastImportTimestamp": "2026-01-25T10:30:45.123Z"
  }
}
```

### Trigger AACT Import

```bash
POST /api/markets/:marketId/refresh
```

If `USE_AACT=true`, this will use warehouse instead of API.

## Next Steps

- ✅ AACT warehouse is set up
- ✅ Alzheimer trials imported
- ⚡ Market refresh is now <10 seconds

**Explore:**
- Try different market definitions (other indications)
- Extend ETL to import Phase I trials
- Add incremental updates (import only new/updated trials)
- Build custom analytics on AACT data

## Resources

- AACT Website: https://aact.ctti-clinicaltrials.org/
- AACT Schema: https://aact.ctti-clinicaltrials.org/schema
- AACT Downloads: https://aact.ctti-clinicaltrials.org/downloads/snapshots
- ClinicalTrials.gov: https://clinicaltrials.gov/

## Support

If you encounter issues:

1. Check this guide's troubleshooting section
2. Review worker logs: `pnpm dev:workers`
3. Check database connections:
   ```bash
   psql -h localhost -U app -l
   ```
4. Verify .env configuration
