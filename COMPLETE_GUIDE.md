# Complete Guide - All Your Options

This guide shows you all available options for running the Alzheimer Clinical Trials system.

## 🎯 Choose Your Path

### Path 1: Quick Test → Full View (Recommended)

**Best for:** Getting started and building comprehensive analysis

**Steps:**
1. Quick test (2-3 min) - Verify everything works
2. Full refresh (15-20 min) - Get complete dataset

**Resources needed:**
- Disk space: 2 GB
- Time: 18-23 minutes total

---

### Path 2: AACT Warehouse (Advanced)

**Best for:** Instant refresh, unlimited queries, offline use

**Steps:**
1. Download AACT snapshot (one-time, 2.2 GB)
2. Restore database (10 min)
3. Import Alzheimer subset (30 seconds)

**Resources needed:**
- Disk space: 20-25 GB
- Time: 11 minutes total

---

## 📊 Comparison Table

| Feature | Quick Test | Full API | AACT Warehouse |
|---------|-----------|----------|----------------|
| **Trials** | 200 | 1000 | 800-1000 |
| **Time to load** | 2-3 min | 15-20 min | 30 sec (after setup) |
| **Refresh speed** | 2-3 min | 15-20 min | <10 sec |
| **Disk space** | 500 MB | 1 GB | 15-20 GB |
| **Setup time** | Instant | Instant | 10 min |
| **API rate limits** | Yes | Yes | No |
| **Offline capable** | No | No | Yes |
| **Recommended for** | Testing | Analysis | Production |

## 🚀 Step-by-Step: Quick Test → Full View

### 1. Initial Setup (One Time)

```bash
cd ~/Desktop/Medino/Alzheimer

# Install dependencies
pnpm install

# Start Docker services
pnpm dev:docker
# Wait 10 seconds for healthy status
```

### 2. Start Applications (Every Time)

**Open 3 terminals:**

**Terminal 1 - API Server:**
```bash
cd ~/Desktop/Medino/Alzheimer
pnpm dev:api
# Wait for: "[API] Server listening on http://0.0.0.0:3001"
```

**Terminal 2 - Workers:**
```bash
cd ~/Desktop/Medino/Alzheimer
pnpm dev:workers
# Wait for: "[Workers] All workers started"
```

**Terminal 3 - Commands:**
```bash
cd ~/Desktop/Medino/Alzheimer
# Use this for running commands below
```

### 3. Quick Test (2-3 minutes)

In Terminal 3:

```bash
bash scripts/quick_test_api.sh
```

**What this does:**
- ✅ Verifies API and workers are running
- ✅ Loads 200 Alzheimer trials
- ✅ Shows real-time progress
- ✅ Displays results

**Expected output:**
```
✅ Test Successful!
Trials processed: 200
Trials in database: 200
Unique sponsors: 25-40
```

### 4. Full Refresh (15-20 minutes)

Once quick test succeeds:

```bash
bash scripts/full_refresh_api.sh
```

**What this does:**
- ✅ Loads ~1000 Alzheimer Phase II-III trials
- ✅ Includes 80-120 pharmaceutical sponsors
- ✅ Complete geographic coverage
- ✅ All Phase III programs

**Expected output:**
```
✅ Full Refresh Completed!
Trials processed: 950-1000
Trials in database: 950-1000
Unique sponsors: 80-120
Phase III trials: 250-350
```

### 5. Explore Your Data

**Via API:**
```bash
# Get all sponsors with scores
curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors | jq

# Get market summary
curl http://localhost:3001/api/markets/market_alzheimer_phase23/summary | jq

# Search for specific trials
curl http://localhost:3001/api/search/molecule?q=lecanemab | jq

# Get competitive benchmarks
curl http://localhost:3001/api/markets/market_alzheimer_phase23/benchmarks | jq
```

**Via Web UI:**
```bash
# Terminal 4 (optional)
pnpm dev:web

# Open browser: http://localhost:3000/market-scan
```

**Via Database:**
```bash
# Direct SQL access
docker exec -it alzheimer-postgres psql -U app -d app

# Example query:
SELECT 
  s.name as sponsor,
  COUNT(*) as trials,
  COUNT(*) FILTER (WHERE t.payload_json->>'phase' ILIKE '%Phase 3%') as phase3
FROM trials t
JOIN sponsors s ON t.sponsor_id = s.id
GROUP BY s.name
ORDER BY trials DESC
LIMIT 20;
```

## 🎯 What You Get

### After Quick Test (200 trials)

Perfect for:
- ✅ Verifying setup works
- ✅ Initial exploration
- ✅ Testing API endpoints
- ✅ Learning the system

Data includes:
- Top 25-40 sponsors
- Mix of Phase II and III trials
- Major pharmaceutical companies
- Recent trials

### After Full Refresh (1000 trials)

Perfect for:
- ✅ Comprehensive analysis
- ✅ Competitive intelligence
- ✅ Market research
- ✅ Portfolio analysis

Data includes:
- 80-120 sponsors
- All major Phase III programs
- Emerging Phase II candidates
- Complete geographic coverage
- Historical data (completed trials)

## 🔄 Regular Updates

### Weekly Quick Update

```bash
# Get latest new trials (5-10 min)
curl -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh?quick=true"
```

### Monthly Full Update

```bash
# Comprehensive refresh (15-20 min)
curl -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh"
```

### Real-time Monitoring

```bash
# Check current status
curl http://localhost:3001/api/markets/market_alzheimer_phase23/refresh/status | jq

# View last refresh time
curl http://localhost:3001/api/markets/market_alzheimer_phase23/summary | jq '.lastRefreshed'
```

## 🛠️ Available Scripts

All helper scripts created for you:

```bash
# Quick test (2-3 min, 200 trials)
bash scripts/quick_test_api.sh

# Full refresh (15-20 min, 1000 trials)
bash scripts/full_refresh_api.sh

# Initialize database (if needed)
bash scripts/init_database.sh

# AACT restore (if using warehouse)
bash scripts/aact_restore.sh

# Validate setup
bash scripts/validate_aact_setup.sh
```

## 📚 Documentation Files

| File | Description |
|------|-------------|
| `README.md` | Main project overview |
| `COMPLETE_GUIDE.md` | This file - all options |
| `API_MODE_FIXED.md` | What was fixed, quick start |
| `QUICK_START_API_MODE.md` | Detailed API mode guide |
| `FULL_REFRESH_GUIDE.md` | Full dataset guide |
| `AACT_INTEGRATION_COMPLETE.md` | AACT warehouse guide |
| `APP_FUNCTIONS_LIST.md` | All API endpoints |

## 🐛 Troubleshooting

### Services won't start

```bash
# Check Docker
docker ps

# Restart if needed
docker-compose down
docker-compose up -d

# Check ports
lsof -ti:3001  # API
lsof -ti:6379  # Redis
lsof -ti:5432  # Postgres
```

### Refresh is stuck

```bash
# Check worker terminal for errors
# Look for network issues or API rate limiting

# Restart workers
# Press Ctrl+C in worker terminal, then:
pnpm dev:workers
```

### Database issues

```bash
# Reinitialize database
bash scripts/init_database.sh

# Check tables exist
docker exec alzheimer-postgres psql -U app -d app -c "\dt"

# Check data
docker exec alzheimer-postgres psql -U app -d app -c "SELECT COUNT(*) FROM trials;"
```

### Need to start fresh

```bash
# Stop everything
docker-compose down -v

# Remove database (keeps code)
docker volume rm alzheimer_postgres_data

# Start fresh
pnpm dev:docker
bash scripts/init_database.sh
bash scripts/quick_test_api.sh
```

## 💡 Tips & Best Practices

1. **Always start with quick test** - Verify setup works
2. **Run full refresh overnight** - Let it complete while you sleep
3. **Monitor worker terminal** - See detailed progress
4. **Use Web UI for visualization** - Easier than curl commands
5. **Query database directly** - For custom analysis
6. **Update weekly** - Keep data fresh
7. **Full refresh monthly** - Comprehensive updates

## 🎯 Common Use Cases

### Market Research

```bash
# Get all sponsors
curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors | jq

# Filter by Phase III
curl "http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors?phase=3" | jq

# Sort by pressure score
curl "http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors?sort=pressure" | jq
```

### Competitive Intelligence

```bash
# Get competitive peers
curl http://localhost:3001/api/markets/market_alzheimer_phase23/competitive_peers?sponsorId=SPONSOR_ID | jq

# Get benchmarks
curl http://localhost:3001/api/markets/market_alzheimer_phase23/benchmarks | jq

# Get pressure scores
curl http://localhost:3001/api/markets/market_alzheimer_phase23/pressure_scores | jq
```

### Trial Search

```bash
# Search by NCT ID
curl http://localhost:3001/api/search/nct/NCT05563688 | jq

# Search by molecule
curl "http://localhost:3001/api/search/molecule?q=lecanemab" | jq

# Search by sponsor
curl "http://localhost:3001/api/search/sponsor?q=Biogen" | jq
```

### Geographic Analysis

```bash
# Get regions
curl http://localhost:3001/api/markets/market_alzheimer_phase23/regions | jq

# Get sponsor geography
curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors/SPONSOR_ID/geographic | jq
```

## ✅ Success Checklist

- [ ] Docker services running
- [ ] API responding on port 3001
- [ ] Workers processing jobs
- [ ] Quick test completed (200 trials)
- [ ] Full refresh completed (1000 trials)
- [ ] Can query via API
- [ ] Web UI loads (optional)
- [ ] Database has data

## 🚀 Next Steps

1. **Complete quick test** - Verify everything works
2. **Run full refresh** - Get comprehensive data
3. **Explore API endpoints** - See `APP_FUNCTIONS_LIST.md`
4. **Use Web UI** - Visual interface
5. **Build custom queries** - Direct database access
6. **Set up regular updates** - Weekly/monthly refreshes

---

## 📞 Support

If you run into issues:

1. Check troubleshooting section above
2. Review worker terminal logs
3. Verify services are running: `docker ps`
4. Check database: `docker exec alzheimer-postgres psql -U app -d app -c "\dt"`
5. Read relevant guides in docs

---

**You now have everything you need!** 🎉

Choose your path and start exploring Alzheimer's market intelligence.
