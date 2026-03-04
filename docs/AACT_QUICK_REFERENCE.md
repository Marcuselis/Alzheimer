# AACT Quick Reference

Quick command reference for working with the AACT warehouse.

## Setup Commands

```bash
# Download AACT snapshot
# Visit: https://aact.ctti-clinicaltrials.org/downloads/snapshots
# Place in: data/aact/aact_snapshot.zip

# Restore AACT database
bash scripts/aact_restore.sh

# Test connection
psql -h localhost -U app -d aact -c "SELECT COUNT(*) FROM studies"

# Import Alzheimer trials
bash scripts/test_aact_import.sh
```

## Environment Variables

```bash
# .env file
DATABASE_URL=postgresql://app:app@localhost:5432/app           # App DB
AACT_DATABASE_URL=postgresql://app:app@localhost:5432/aact     # AACT DB
USE_AACT=true                                                   # Enable warehouse mode
```

## Common Operations

### Check AACT Status
```bash
curl http://localhost:3001/api/warehouse/status | jq
```

### Trigger Market Refresh
```bash
# Using AACT warehouse (if USE_AACT=true)
curl -X POST http://localhost:3001/api/markets/market_alzheimer_phase23/refresh

# Quick mode (200 trials)
curl -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh?quick=true"
```

### View Imported Data
```bash
# Get sponsor list
curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors | jq

# Get market summary
curl http://localhost:3001/api/markets/market_alzheimer_phase23/summary | jq
```

## Database Queries

### AACT Database Queries

```sql
-- Connect to AACT
psql -h localhost -U app -d aact

-- Total studies
SELECT COUNT(*) FROM studies;

-- Alzheimer Phase II-III trials
SELECT COUNT(DISTINCT s.nct_id)
FROM studies s
WHERE (s.phase ILIKE '%Phase 2%' OR s.phase ILIKE '%Phase 3%')
  AND (s.brief_title ILIKE '%Alzheimer%'
       OR EXISTS (SELECT 1 FROM conditions c 
                  WHERE c.nct_id = s.nct_id 
                  AND c.name ILIKE '%Alzheimer%'));

-- Top sponsors in Alzheimer space
SELECT sp.name, COUNT(*) as trial_count
FROM studies s
JOIN sponsors sp ON sp.nct_id = s.nct_id AND sp.lead_or_collaborator = 'lead'
WHERE (s.phase ILIKE '%Phase 2%' OR s.phase ILIKE '%Phase 3%')
  AND (s.brief_title ILIKE '%Alzheimer%'
       OR EXISTS (SELECT 1 FROM conditions c 
                  WHERE c.nct_id = s.nct_id 
                  AND c.name ILIKE '%Alzheimer%'))
GROUP BY sp.name
ORDER BY trial_count DESC
LIMIT 20;

-- Study locations by country
SELECT country, COUNT(*) as site_count
FROM facilities
WHERE nct_id IN (
  SELECT nct_id FROM studies 
  WHERE phase ILIKE '%Phase 3%'
    AND brief_title ILIKE '%Alzheimer%'
)
GROUP BY country
ORDER BY site_count DESC;
```

### App Database Queries

```sql
-- Connect to app DB
psql -h localhost -U app -d app

-- Count trials imported from AACT
SELECT COUNT(*) FROM trials WHERE source = 'aact';

-- View market sponsor rollup
SELECT 
  s.name as sponsor,
  msr.phase3_active_count,
  msr.total_active_count,
  msr.pressure_score
FROM mv_market_sponsor_rollup msr
JOIN sponsors s ON msr.sponsor_id = s.id
WHERE msr.market_id = 'market_alzheimer_phase23'
ORDER BY msr.pressure_score DESC
LIMIT 10;

-- Check market state
SELECT * FROM market_state 
WHERE market_id = 'market_alzheimer_phase23';
```

## Maintenance

### Update AACT Snapshot

```bash
# 1. Download new snapshot from AACT website
# 2. Replace file
mv ~/Downloads/new_snapshot.zip data/aact/aact_snapshot.zip

# 3. Drop and recreate database
dropdb -h localhost -U app aact
rm -rf data/aact/extracted/

# 4. Restore new snapshot
bash scripts/aact_restore.sh

# 5. Re-import data
bash scripts/test_aact_import.sh
```

### Switch Between API and Warehouse Mode

```bash
# Use AACT warehouse (fast, local)
export USE_AACT=true
pnpm dev:workers

# Use CT.gov API (slow, always fresh)
export USE_AACT=false
pnpm dev:workers
```

### Reset Import

```bash
# Clear imported AACT data from app DB
psql -h localhost -U app -d app -c "DELETE FROM trials WHERE source = 'aact'"
psql -h localhost -U app -d app -c "DELETE FROM mv_market_sponsor_rollup WHERE market_id = 'market_alzheimer_phase23'"

# Re-import
bash scripts/test_aact_import.sh
```

## Troubleshooting

### AACT database not found
```bash
# Check if database exists
psql -h localhost -U app -l | grep aact

# Create and restore
bash scripts/aact_restore.sh
```

### Connection refused
```bash
# Check Postgres is running
docker ps | grep postgres

# Start services
pnpm dev:docker
```

### Import returns 0 trials
```bash
# Verify AACT has data
psql -h localhost -U app -d aact -c "SELECT COUNT(*) FROM studies WHERE brief_title ILIKE '%Alzheimer%'"

# Check AACT connection in app
psql -h localhost -U app -d aact -c "\dt"
```

### API not using AACT
```bash
# Check environment variable
echo $USE_AACT

# Should be 'true' for warehouse mode
export USE_AACT=true

# Restart workers
pnpm dev:workers
```

## Performance Benchmarks

| Operation | API Mode | AACT Mode |
|-----------|----------|-----------|
| Market refresh (1000 trials) | 15+ min | <10 sec |
| Single trial lookup | 500ms | 20ms |
| Sponsor query | 2-5 sec | 50ms |
| Market rollup | 10+ min | 30 sec |

## Key Files

- `apps/api/src/db/aactClient.ts` - AACT database client
- `apps/workers/src/jobs/importAlzheimersFromAACT.ts` - ETL job
- `apps/workers/src/workers/aactImportWorker.ts` - Import worker
- `apps/workers/src/workers/marketRefreshWorker.ts` - Refresh dispatcher
- `scripts/aact_restore.sh` - Database restore script
- `scripts/test_aact_import.sh` - Test import script
- `docs/aact_setup.md` - Full setup guide

## Resources

- **AACT Website**: https://aact.ctti-clinicaltrials.org/
- **AACT Schema**: https://aact.ctti-clinicaltrials.org/schema
- **AACT Downloads**: https://aact.ctti-clinicaltrials.org/downloads/snapshots
- **Full Setup Guide**: [docs/aact_setup.md](./aact_setup.md)
