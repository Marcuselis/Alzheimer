# Index + Delta Architecture

## Miksi?

**Ongelma**: Jos haet jokaisen trial-detailin joka refresh, se on:
- Kallista (API rate limits)
- Hidasta (15+ minuuttia per refresh)
- Turhaa (95% datasta ei muutu päivittäin)

**Ratkaisu**: Index+delta-malli
- **Index pull**: Kevyt haku kaikille trialeille (~2-3 min)
- **Detail pull**: Raskas haku vain muuttuneille (~5-10 min, taustalla)

## Arkkitehtuuri

### Vaihe 1: Index Pull (kevyt, nopea)

**Mitä haetaan:**
```
NCTId, BriefTitle, OverallStatus, Phase, StartDate, 
PrimaryCompletionDate, EnrollmentCount, LeadSponsorName, 
Conditions, InterventionName, LastUpdatePostDate
```

**Miksi nämä kentät:**
- Riittävät sponsor rollupeihin
- Riittävät program rollupeihin
- Riittävät pressure scoreihin
- Riittävät market map -visualisointiin

**Nopeus:**
- 100 trialia per sivu
- ~10-20 pyyntöä koko Alzheimer-markkinaan
- **2-3 minuuttia** kokonaan

**Tallennus:**
```sql
UPDATE trials 
SET 
  index_json = $index_data,
  updated_source_date = $last_update_post_date,
  fetched_at = NOW()
WHERE nct_id = $nct_id
```

### Vaihe 2: Detail Pull (raskas, vain tarvittaessa)

**Milloin haetaan:**
- Trial ei ole tietokannassa (`detail_json IS NULL`)
- Trial on päivittynyt (`updated_source_date < LastUpdatePostDate`)

**Mitä haetaan:**
```
outcomes (primary, secondary)
eligibility (criteria, age, gender)
locations (detailed, with status)
arms & interventions (detailed descriptions)
```

**Nopeus:**
- 5 concurrent request per batch
- 100ms delay per request (rate limiting)
- ~10-20 sekuntia per 100 trialia
- **5-10 minuuttia** 200-500 trialille (tyypillinen delta)

**Tallennus:**
```sql
UPDATE trials
SET
  detail_json = $detail_data,
  detail_fetched_at = NOW()
WHERE nct_id = $nct_id
```

## Database Schema

### trials table
```sql
CREATE TABLE trials (
  id TEXT PRIMARY KEY,
  sponsor_id TEXT REFERENCES sponsors(id),
  nct_id TEXT NOT NULL UNIQUE,
  
  -- SPLIT: Index vs Detail
  index_json JSONB,           -- kevyt data (kaikille)
  detail_json JSONB,          -- raskas data (vain tarvittaessa)
  
  -- TIMESTAMPS
  fetched_at TIMESTAMP,                -- milloin index haettu
  detail_fetched_at TIMESTAMP,         -- milloin detail haettu
  updated_source_date TIMESTAMP,       -- lähteen LastUpdatePostDate
  
  -- LEGACY (yhteensopivuus)
  payload_json JSONB,         -- deprecated, migratoitu -> index_json
  
  source TEXT DEFAULT 'clinicaltrials.gov',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trials_detail_fetched ON trials(detail_fetched_at);
CREATE INDEX idx_trials_index_json ON trials USING GIN (index_json);
```

### market_state table
```sql
CREATE TABLE market_state (
  market_id TEXT PRIMARY KEY,
  last_refresh_at TIMESTAMP,
  last_success_at TIMESTAMP,
  last_error TEXT,
  
  -- COVERAGE TRACKING
  index_coverage_json JSONB,    -- { trialsProcessed, nctIdsNeedingDetail, timestamp }
  detail_coverage_json JSONB,   -- { trialsProcessed, errors, timestamp }
  
  coverage_counts_json JSONB,   -- legacy
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Workers & Jobs

### marketRefreshWorker (index)
```typescript
// Queue: market-refresh
// Concurrency: 2
// Toiminto:
// 1. Hae index data (refreshMarketIndex)
// 2. Laske nctIdsNeedingDetail
// 3. Queue detail job (ei blokkaa)
// 4. Return heti
```

### marketDetailWorker (detail)
```typescript
// Queue: market-detail
// Concurrency: 1 (polite to CT.gov)
// Toiminto:
// 1. Ota lista nctIds
// 2. Hae details (refreshMarketDetail, concurrency 5)
// 3. Rate limit (100ms / request)
// 4. Return kun valmis
```

## API Endpoints

### POST /api/markets/:marketId/refresh
**Request:**
```json
{ "quick": true }
```

**Response:**
```json
{
  "status": "accepted",
  "jobId": "job_123",
  "quickMode": true,
  "message": "Index refresh job enqueued (200 studies)"
}
```

**Käyttäytyminen:**
- Laukaisee `marketRefreshWorker` (index pull)
- Index valmis 2-3 minuutissa
- Detail queue automaattisesti
- Detail valmis 5-10 min myöhemmin (taustalla)

### GET /api/markets/:marketId/coverage
**Response:**
```json
{
  "marketId": "market_alzheimers_phase23",
  "totalTrials": 450,
  "coverage": {
    "index": {
      "count": 450,
      "percent": 100,
      "lastFetch": "2026-01-25T12:34:00Z"
    },
    "detail": {
      "count": 320,
      "percent": 71,
      "lastFetch": "2026-01-25T12:40:00Z",
      "inProgress": true
    },
    "full": {
      "count": 320
    }
  },
  "message": "Index complete (100%), detail fetch in progress (71%)"
}
```

## UI Experience

**Käyttäjän kokemus:**

1. **User klikkaa "Refresh"**
   - POST /api/markets/alzheimers/refresh?quick=true
   - Response: 202 Accepted, jobId

2. **2-3 minuutin päästä:**
   - GET /api/markets/alzheimers/sponsors
   - → Näyttää heti kaikki sponsorit (index-datasta)
   - GET /api/markets/alzheimers/coverage
   - → "Index complete (100%), detail fetch in progress (32%)"

3. **5-10 minuutin päästä:**
   - GET /api/markets/alzheimers/coverage
   - → "Full coverage complete (100%)"
   - Syvempi analyysi (riskit, endpoints) nyt saatavilla

**UI Badge (ehdotus):**
```tsx
{coverage.detail.inProgress && (
  <Badge variant="warning">
    Detail fetch in progress ({coverage.detail.percent}%)
  </Badge>
)}
{coverage.detail.percent === 100 && (
  <Badge variant="success">
    Full coverage ✓
  </Badge>
)}
```

## Performance Comparison

### Vanha malli (monolittiinen)
```
Refresh → hae kaikki trialit detail datalla
Time: 15-30 min
API calls: 500-1000 (1 per trial)
User wait: 15-30 min
```

### Uusi malli (index+delta)
```
Refresh → hae index (kevyt)
Time: 2-3 min
API calls: 10-20 (paginated)
User wait: 2-3 min ✅

Background → hae detail (vain muuttuneille)
Time: 5-10 min
API calls: 50-200 (delta only)
User wait: 0 min (non-blocking) ✅
```

**Speed-up:**
- **Index**: 10× nopeampi
- **API calls**: 100× vähemmän turhia
- **User experience**: heti valmis

## Maintenance

### Täysi refresh (esim. kerran viikossa)
```bash
# Quick mode = false → hae kaikki 1000 trialia
curl -X POST http://localhost:3001/api/markets/alzheimers/refresh?quick=false
```

### Inkrementaalinen refresh (päivittäin)
```bash
# Quick mode = true → hae vain 200 uusinta
curl -X POST http://localhost:3001/api/markets/alzheimers/refresh?quick=true
```

### Coverage check
```bash
curl http://localhost:3001/api/markets/alzheimers/coverage | jq
```

## Logs

**Index pull:**
```
[Worker] Starting market INDEX refresh job 123 for market alzheimers (quickMode: true)
[Index Pull] Query: (Alzheimer OR Alzheimer's) AND (PHASE2 OR PHASE3) AND ...
[Index Pull] Fetching page 1-100
[Index Pull] Fetching page 101-200
[Index Pull] Completed: 187 trials, 42 need detail
[Worker] Job 123 completed: 187 trials indexed in 134567ms, 42 queued for detail
```

**Detail pull:**
```
[DetailWorker] Starting detail fetch job 456 for 42 trials in market alzheimers
[Detail Pull] Fetching details for 42 trials (concurrency: 5)
[Detail Pull] Processed 5/42 trials
[Detail Pull] Processed 10/42 trials
...
[DetailWorker] Job 456 completed: 42/42 details fetched in 245678ms
```

## Rollback

Jos tarvitsee palata vanhaan:

1. Päivitä `marketRefreshWorker.ts`:
```typescript
import { refreshMarket } from '../jobs/refreshMarket'; // vanha
const result = await refreshMarket(marketId, undefined, { quickMode });
```

2. Poista `marketDetailWorker` käytöstä
3. Restart workers

## Next Steps

1. **UI badges**: Näytä coverage UI:ssa
2. **Scheduling**: Cron job päivittäiseen quick refresh
3. **Monitoring**: Alert jos detail coverage < 80%
4. **Analytics**: Seuraa index vs detail aikoja

## Summary

**Ydinidea:**
- Koko markkina = index-pull (nopea)
- Syvä analyysi = detail-pull vain muutoksille (tarvittaessa)

**Hyödyt:**
- 10× nopeampi refresh
- 100× vähemmän turhia API-kutsuja
- Skaalautuu tuhansiin trialeihin
- Käyttäjä saa datan heti

**Trade-off:**
- Kahden tason data (index + detail)
- Hieman monimutkaisempi arkkitehtuuri
- Coverage-seuranta tarvitaan

→ **Kannattaa!** Sama periaate kuin hakukoneissa: ensin indeksi, sitten sisältö.
