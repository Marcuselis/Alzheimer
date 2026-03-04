# Full Broad View - Complete Dataset Guide

Get the comprehensive Alzheimer's market intelligence with ~1000 trials.

## 📊 Quick vs Full Comparison

| Aspect | Quick Mode | Full Mode (Broad View) |
|--------|------------|------------------------|
| **Trials** | ~200 | ~1000 |
| **Time** | 2-3 min | 15-20 min |
| **Sponsors** | 25-40 | 80-120 |
| **Phase III** | 40-60 | 200-300 |
| **Database** | 500 MB | 1 GB |
| **Use Case** | Test/verify | Comprehensive analysis |

## 🚀 Two-Step Approach (Recommended)

### Step 1: Quick Test First (2-3 minutes)

Verify everything works:

```bash
# Terminal 1
pnpm dev:api

# Terminal 2
pnpm dev:workers

# Terminal 3
bash scripts/quick_test_api.sh
```

✅ This gives you ~200 trials to start exploring immediately.

### Step 2: Full Refresh (15-20 minutes)

Once quick mode succeeds, get the full dataset:

```bash
bash scripts/full_refresh_api.sh
```

This will:
- Load ~1000 Alzheimer Phase II-III trials
- Include more sponsors (80-120)
- More comprehensive geographic coverage
- More Phase III trials for analysis

## 📈 What You Get with Full Mode

### Trial Coverage

```bash
# After full refresh
curl http://localhost:3001/api/markets/market_alzheimer_phase23/summary | jq

# Expected output:
{
  "coverage": {
    "trials": 950-1000,
    "sponsors": 80-120,
    "activePhase3": 250-350
  }
}
```

### Comprehensive Sponsor List

```bash
# Get all sponsors with their scores
curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors | jq '.sponsors[] | {name, phase3, score}'

# You'll see major players:
# - Biogen
# - Eli Lilly
# - Roche
# - Eisai
# - Novartis
# ... and 75+ more
```

### Geographic Coverage

Full mode includes:
- All trial sites worldwide
- Country-level analysis
- Regional patterns
- Site distribution

### Competitive Intelligence

With 1000 trials:
- Complete competitive landscape
- All Phase III programs
- Emerging Phase II candidates
- Portfolio analysis by sponsor

## ⏱️ Time Management

### Option 1: Run Overnight

Start the full refresh before you leave:

```bash
# Start in background
nohup bash scripts/full_refresh_api.sh > full_refresh.log 2>&1 &

# Check progress next day
tail -f full_refresh.log
```

### Option 2: Monitor Progress

Watch it in real-time:

```bash
# Terminal 1: API
pnpm dev:api

# Terminal 2: Workers (watch progress here)
pnpm dev:workers

# Terminal 3: Full refresh
bash scripts/full_refresh_api.sh
```

The worker terminal shows detailed progress:
```
[Market Refresh] Fetching page 1-100
[Market Refresh] Fetching page 101-200
...
[Market Refresh] Successfully imported 950 trials
```

### Option 3: Check Status Anytime

```bash
# Get current status
curl http://localhost:3001/api/markets/market_alzheimer_phase23/refresh/status | jq

# Response shows:
{
  "status": "in_progress",  # or "completed"
  "lastRefreshAt": "2026-01-25T14:30:00Z",
  "coverage": {
    "trialsProcessed": 450  # current count
  }
}
```

## 🎯 Incremental Updates

After initial full refresh, updates are faster:

```bash
# Full refresh stores last update time
# Next refresh only fetches NEW/UPDATED trials

# Manual refresh (only new data)
curl -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh"

# This completes in 5-10 minutes instead of 15-20
```

## 💾 Database Growth

| Dataset | Size | Notes |
|---------|------|-------|
| Quick (200) | 500 MB | Initial test |
| Full (1000) | 1 GB | Comprehensive |
| With updates | 1.2-1.5 GB | Over time |

**Storage needed: ~2 GB total** (app database + Docker volumes)

## 📊 Data Quality

Full mode includes:

### More Trials
- All Phase III Alzheimer trials
- More Phase II trials
- Phase II/III trials
- Completed trials for historical analysis

### More Sponsors
- Top 20 pharma companies
- Mid-size biotechs
- Academic institutions
- Research consortiums

### Better Coverage
- International trials
- All geographies
- All trial statuses
- Historical data (completed trials)

## 🔄 Recommended Workflow

### First Time Setup

1. **Quick test** (2-3 min) - Verify everything works
2. **Full refresh** (15-20 min) - Get comprehensive data
3. **Explore data** - Use API/Web UI

### Regular Updates

1. **Weekly quick refresh** - Get latest new trials
2. **Monthly full refresh** - Comprehensive update
3. **As needed** - When major news breaks

## 🎨 Use Cases for Full Dataset

### 1. Competitive Intelligence

With 1000 trials:
```bash
# Get all Phase III programs
curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors?phase=3 | jq

# Compare sponsor portfolios
curl http://localhost:3001/api/markets/market_alzheimer_phase23/competitive_peers | jq
```

### 2. Market Analysis

```bash
# Get benchmarks
curl http://localhost:3001/api/markets/market_alzheimer_phase23/benchmarks | jq

# Pressure scores across market
curl http://localhost:3001/api/markets/market_alzheimer_phase23/pressure_scores | jq
```

### 3. Geographic Patterns

```bash
# Regional analysis
curl http://localhost:3001/api/markets/market_alzheimer_phase23/regions | jq

# Sponsor by geography
curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors/SPONSOR_ID/geographic | jq
```

### 4. Portfolio Analysis

```bash
# All programs in market
curl http://localhost:3001/api/markets/market_alzheimer_phase23/programs | jq

# Molecules by sponsor
curl http://localhost:3001/api/search/molecule?q=lecanemab | jq
```

## 🚀 Commands Summary

```bash
# Quick test (2-3 min, 200 trials)
bash scripts/quick_test_api.sh

# Full refresh (15-20 min, 1000 trials)
bash scripts/full_refresh_api.sh

# Check status
curl http://localhost:3001/api/markets/market_alzheimer_phase23/refresh/status | jq

# View sponsors
curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors | jq

# View summary
curl http://localhost:3001/api/markets/market_alzheimer_phase23/summary | jq

# Web UI
pnpm dev:web
# Open: http://localhost:3000/market-scan
```

## 💡 Pro Tips

1. **Start with quick mode** - Verify setup in 2-3 minutes
2. **Run full refresh overnight** - Let it complete while you sleep
3. **Monitor worker terminal** - See detailed progress
4. **Use Web UI** - Visual interface is easier than curl
5. **Query database directly** - For custom analysis

## 🔍 Direct Database Queries

For custom analysis on full dataset:

```bash
# Connect to database
docker exec -it alzheimer-postgres psql -U app -d app

# Custom queries:
SELECT 
  s.name as sponsor,
  COUNT(*) as trial_count,
  COUNT(*) FILTER (WHERE t.payload_json->>'phase' ILIKE '%Phase 3%') as phase3_count
FROM trials t
JOIN sponsors s ON t.sponsor_id = s.id
GROUP BY s.name
ORDER BY trial_count DESC
LIMIT 20;
```

## ✅ Success Checklist

After full refresh:

- [ ] ~1000 trials in database
- [ ] 80-120 unique sponsors
- [ ] 200-300+ Phase III trials
- [ ] Geographic data for all trials
- [ ] Pressure scores computed
- [ ] Web UI shows comprehensive data
- [ ] API endpoints return full results

## 📚 Next Steps

With full dataset:

1. **Explore Web UI** - Visual market scan
2. **Build custom queries** - SQL analysis
3. **Export data** - For presentations
4. **Set up monitoring** - Track changes over time
5. **Generate insights** - Competitive analysis

---

**You now have access to the full broad view!** 🎉

~1000 trials covering the entire Alzheimer's Phase II-III landscape.
