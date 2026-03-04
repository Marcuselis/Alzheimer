# Quick Start - API Mode (No AACT)

This guide gets you running with CT.gov API mode (no large database needed).

## ✅ What I Just Fixed

1. ✅ Created `.env` file with API mode configuration
2. ✅ Created Alzheimer market definition in database
3. ✅ Created test script for easy API testing

## 🚀 How to Run (3 Steps)

### Step 1: Start Services

Open **3 separate terminals** in the project directory:

**Terminal 1 - API:**
```bash
cd ~/Desktop/Medino/Alzheimer
pnpm dev:api
```

Wait for: `[API] Server listening on http://0.0.0.0:3001`

**Terminal 2 - Workers:**
```bash
cd ~/Desktop/Medino/Alzheimer
pnpm dev:workers
```

Wait for: `[Workers] All workers started`

**Terminal 3 - Commands:**
Keep this for running test commands.

### Step 2: Test the API

In Terminal 3, run the test script:

```bash
bash scripts/quick_test_api.sh
```

This will:
- ✅ Verify API is running
- ✅ Trigger a QUICK refresh (200 trials, ~2-3 min)
- ✅ Monitor progress in real-time
- ✅ Show results when complete

**Expected output:**
```
✅ Test Successful!
Trials processed: 200
Trials in database: 200
Unique sponsors: 25-40
```

### Step 3: View the Data

**Via API:**
```bash
# Get sponsors
curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors | jq '.sponsors[] | {name:.sponsorName, phase3:.phase3Active, score:.pressureScore}'

# Get market summary
curl http://localhost:3001/api/markets/market_alzheimer_phase23/summary | jq
```

**Via Web UI (optional):**
```bash
# Terminal 4
pnpm dev:web

# Open browser: http://localhost:3000/market-scan
```

## 📊 Quick Mode vs Full Mode

| Mode | Trials | Time | Command |
|------|--------|------|---------|
| **Quick** ✅ | 200 | 2-3 min | `refresh?quick=true` |
| **Full** | 1000 | 15-20 min | `refresh` (no param) |

**Recommendation:** Start with **Quick mode** to verify everything works!

## 🔧 Manual Refresh Commands

### Quick Refresh (200 trials)
```bash
curl -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh?quick=true"
```

### Full Refresh (1000 trials)
```bash
curl -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh"
```

### Check Status
```bash
curl http://localhost:3001/api/markets/market_alzheimer_phase23/refresh/status | jq
```

## 🐛 Troubleshooting

### API not starting?

```bash
# Check if port 3001 is in use
lsof -ti:3001

# Kill any existing process
kill $(lsof -ti:3001)

# Try again
pnpm dev:api
```

### Workers not processing jobs?

```bash
# Check Redis is running
docker ps | grep redis

# If not, start Docker
pnpm dev:docker

# Restart workers
pnpm dev:workers
```

### Refresh taking too long?

The first time can be slow because:
- CT.gov API rate limiting
- Large number of trials
- Network latency

**Solutions:**
1. Use **quick mode** (200 trials instead of 1000)
2. Check worker terminal for errors
3. Verify network connection to CT.gov

### Check what's happening:

```bash
# View database contents
docker exec alzheimer-postgres psql -U app -d app -c "SELECT COUNT(*) FROM trials;"
docker exec alzheimer-postgres psql -U app -d app -c "SELECT COUNT(*) FROM sponsors;"

# View market state
docker exec alzheimer-postgres psql -U app -d app -c "SELECT * FROM market_state WHERE market_id = 'market_alzheimer_phase23';"
```

## 📈 Performance Tips

### Speed Up Refreshes

1. **Use Quick Mode First**
   - 200 trials is enough to see the system working
   - Loads in 2-3 minutes

2. **Monitor Progress**
   - Use the test script to see real-time progress
   - Check worker terminal for detailed logs

3. **Cache Works for You**
   - After first load, subsequent queries are cached
   - API responses are fast (<100ms)

## 🎯 What You Get

After running quick mode, you'll have:
- ✅ ~200 Alzheimer Phase II-III trials
- ✅ ~25-40 pharmaceutical sponsors
- ✅ Market pressure scores
- ✅ Geographic data
- ✅ Trial metadata (enrollment, phases, status)

**Database size:** ~500 MB (not 15 GB!)

## 🔄 Regular Updates

To refresh data periodically:

```bash
# Run quick refresh weekly
curl -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh?quick=true"

# Or full refresh monthly
curl -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh"
```

## ✅ Success Checklist

- [ ] Docker services running (`pnpm dev:docker`)
- [ ] API running on port 3001 (`pnpm dev:api`)
- [ ] Workers processing jobs (`pnpm dev:workers`)
- [ ] Test script passes (`bash scripts/quick_test_api.sh`)
- [ ] Can query data via API
- [ ] (Optional) Web UI loads (`pnpm dev:web`)

## 📚 Next Steps

Once you have data loaded:

1. **Explore the API**: See `APP_FUNCTIONS_LIST.md` for all endpoints
2. **Use the Web UI**: Visual interface at http://localhost:3000
3. **Query the database**: Direct SQL access via Docker
4. **Build custom queries**: Full Postgres access to analyze data

## 💡 Tips

- **Quick mode is usually enough** for development and testing
- **Full mode** only needed for comprehensive analysis
- **Web UI** provides visual interface (optional)
- **API endpoints** are documented in `APP_FUNCTIONS_LIST.md`

---

**You're now running in API mode!** 🎉

No 15GB database needed - just the trials you care about!
