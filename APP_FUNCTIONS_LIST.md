# V4 App Functions List - Frontend & Backend

## Overview
This is an analyst workstation for Alzheimer's clinical trials intelligence. It aggregates data from ClinicalTrials.gov and PubMed, performs competitive analysis, generates pre-call briefs, and provides market scanning capabilities.

---

## FRONTEND FUNCTIONS (Next.js/React)

### Pages & Routes

#### 1. **Dashboard** (`/dashboard`)
- Displays market coverage summary
- Shows trial count, sponsor count, active Phase III count
- Displays last refresh timestamp
- Shows source health status (CT.gov, PubMed)
- Quick links to Market Scan and Briefs
- Recent accounts placeholder
- Recent briefs placeholder

#### 2. **Market Scan** (`/market-scan`)
- Displays market coverage metrics (trials, sponsors, active Phase III)
- Quick Refresh button (200 studies, ~2-3 min)
- Full Refresh button (1000 studies, ~15+ min)
- Real-time refresh status polling
- Filterable sponsor table with columns:
  - Sponsor name
  - Pressure Score
  - Phase III count
  - Phase II count
  - Median Enrollment
  - Countries count
  - Burden Score (PET/MRI/Infusion flags)
  - Why Now snippet
- Sort options: Pressure Score, Phase III Count, Median Enrollment
- Filter options: Status (Active/All), Phase (II-III/III/II/All)
- Clickable sponsor rows → navigate to sponsor detail page

#### 3. **Sponsor Detail** (`/sponsors/[id]`)
- Speed Lane Cards:
  - Pressure Score display
  - Coverage (Phase III, Phase II, Total Active, Countries)
  - Programs list (molecule, phase, trial count)
  - Peer Crowding metrics
  - Top Risks (top 3)
  - Why Call Them summary
- Tabbed interface with 10 tabs:
  - **Overview**: Market position, key metrics
  - **Programs**: List of programs/molecules with trial counts
  - **Risks**: Detailed risk analysis with severity indicators
  - **Evidence**: Evidence links and trial connections
  - **Geographic**: Country breakdown with trial counts
  - **TAM Model**: Total Addressable Market modeling (placeholder)
  - **Statistics**: Detailed statistics panel (placeholder)
  - **Literature**: ✅ Full PubMed literature analysis
    - Auto-search sponsor's molecules
    - Publication counts and insights
    - Research focus breakdown (efficacy, safety, biomarker, mechanism)
    - Top journals
    - Key publications (high-relevance, Phase 3 focus)
    - All papers list with expandable abstracts
    - Direct PubMed links
  - **Timeline**: Trial timeline visualization (placeholder)
  - **Pitch Builder**: Pitch building tool (placeholder)
- Refresh Data button
- Generate Pre-call Brief button
- Back to Market Scan navigation

#### 4. **Search** (`/search`)
- Three search modes:
  - **NCT Number**: Search by ClinicalTrials.gov ID
  - **Molecule**: Search by molecule/drug name
  - **Sponsor**: Search by sponsor/company name
- Search results display:
  - For NCT: Full trial details, status, phase, sponsor, enrollment, timeline, conditions, interventions, locations, flags (PET/MRI/Infusion/ARIA/Biomarker)
  - For Molecule: Programs grouped by sponsor, individual trials list
  - For Sponsor: Sponsor list with trial/program counts
- Clickable links to sponsor pages
- View on CT.gov links

#### 5. **Briefs** (`/briefs`)
- Lists all generated briefs
- Shows sponsor name, program name, creation date
- View/Print button for each brief
- Empty state message

#### 6. **Signals** (`/signals`)
- Placeholder page for market signals

#### 7. **Literature** (`/literature`) ✅ NEW
- Standalone literature search page
- Search PubMed by molecule, compound, or topic
- Synonym support for alternative names
- Time period selection (3 months to 3 years)
- Research focus area breakdown (efficacy, safety, biomarker, mechanism, phase)
- Top journals analysis
- Publication list with abstracts
- Market literature trends for top molecules
- Quick search from trend cards
- Direct links to PubMed

#### 8. **Settings** (`/settings`)
- Settings page (placeholder)

### Shared Components

#### **Navigation** (`Nav.tsx`)
- App-wide navigation component
- Links to all major pages

#### **API Client** (`lib/api.ts`)
- `apiGet()`: GET request helper
- `apiPost()`: POST request helper
- Configurable API URL (default: localhost:3001)

---

## BACKEND FUNCTIONS (Fastify API)

### Core Infrastructure

#### **Health & Metrics**
- `GET /health` - Health check endpoint
- `GET /metrics` - Prometheus metrics endpoint
- Request logging and metrics hooks
- Request ID tracking

### AACT Warehouse (NEW - Local Data Intelligence)

#### **Overview**
AACT (Aggregate Analysis of ClinicalTrials.gov) provides instant, local-first access to complete trial data.

**Benefits:**
- ⚡ **<10 second** market refresh (vs 15+ minutes with API)
- 🎯 **500,000+ trials** available locally
- 🚀 **Zero API rate limits**
- 💯 **100% offline capable**

#### **Warehouse Status Endpoint**
- `GET /api/warehouse/status` - Get AACT warehouse status
  - Returns connection status, database stats, import metrics
  - Shows total studies in AACT, imported trial count
  - Displays last import timestamp
  - Indicates if warehouse mode is enabled (USE_AACT env var)

#### **Architecture**
```
AACT Database (aact) → ETL Job → App Database (app)
   500K+ trials      Import Job    Normalized Schema
   (read-only)       (BullMQ)      (trials, sponsors, etc.)
```

#### **Setup & Configuration**
- Environment variable: `USE_AACT=true` to enable warehouse mode
- Database: Separate `aact` database in same Postgres instance
- Client: `apps/api/src/db/aactClient.ts` (read-only connection pool)
- ETL Job: `apps/workers/src/jobs/importAlzheimersFromAACT.ts`
- Worker: `apps/workers/src/workers/aactImportWorker.ts`

#### **ETL Process**
1. **Query AACT**: Extract Phase II-III Alzheimer trials from `studies`, `sponsors`, `conditions` tables
2. **Normalize**: Transform to app schema (normalize sponsors, compute burden scores, extract locations)
3. **Upsert**: Insert/update `trials`, `trial_metadata`, `trial_flags`, `trial_locations`, `market_trials`
4. **Rollup**: Compute market aggregates in `mv_market_sponsor_rollup`

#### **Import Performance**
- Query time: 2-5 seconds
- Import time: 10-30 seconds for ~1000 trials
- Speedup: **30x faster** than CT.gov API mode

#### **Scripts**
- `scripts/aact_restore.sh` - Restore AACT database from snapshot
- `scripts/test_aact_import.sh` - Test AACT import end-to-end
- `scripts/validate_aact_setup.sh` - Validate AACT setup

#### **Documentation**
- `docs/aact_setup.md` - Complete setup guide
- `docs/AACT_QUICK_REFERENCE.md` - Command cheatsheet
- `docs/AACT_IMPLEMENTATION_SUMMARY.md` - Implementation details

#### **Dual-Mode Operation**
Market refresh worker automatically detects `USE_AACT` flag:
- `USE_AACT=false`: Use ClinicalTrials.gov API (slower, always fresh)
- `USE_AACT=true`: Use AACT warehouse (faster, monthly snapshots)

No code changes needed to switch modes - just set environment variable.

### Market Endpoints

#### **Market Management**
- `GET /api/markets` - List all market definitions
- `GET /api/markets/:marketId/summary` - Get market summary with coverage stats
- `GET /api/markets/:marketId/sponsors` - Get market sponsors with filters/sorting
- `GET /api/markets/:marketId/sponsors/:sponsorId` - Get sponsor detail in market context
- `GET /api/markets/:marketId/sponsors/:sponsorId/geographic` - Get geographic data for sponsor
- `POST /api/markets/:marketId/refresh` - Trigger market refresh (async job)
- `GET /api/markets/:marketId/refresh/status` - Get refresh job status
- `GET /api/markets/:marketId/regions` - List regions for market
- `GET /api/markets/:marketId/regions/:regionId` - Get region detail with attractiveness scores
- `POST /api/markets/:marketId/regions/compute` - Trigger region attractiveness computation

#### **Alzheimer's Market Shortcuts**
- `GET /api/market/alzheimers/sponsors` - Quick access to Alzheimer's sponsors
- `GET /api/market/alzheimers/programs` - Get programs in Alzheimer's market
- `GET /api/market/alzheimers/competitive_peers` - Get competitive peer set
- `GET /api/market/alzheimers/pressure_scores` - Get all pressure scores
- `GET /api/market/alzheimers/benchmarks` - Get market benchmarks (medians, averages)
- `POST /api/market/alzheimers/refresh` - Refresh Alzheimer's market

### Search Endpoints

#### **Trial & Entity Search**
- `GET /api/search/nct/:nctId` - Search by NCT ID, returns full trial details
- `GET /api/search/molecule?q=<query>` - Search by molecule name
- `GET /api/search/sponsor?q=<query>` - Search by sponsor name
- `GET /api/sponsors/search?q=<query>` - Legacy sponsor search endpoint

### Analysis & Visualization

#### **Market Analysis**
- `GET /api/markets/:marketId/viz/market-map` - Get market map visualization
- `GET /api/markets/:marketId/viz/timeline-race` - Get timeline race visualization
- `GET /api/markets/:marketId/viz/pressure` - Get pressure visualization
- `GET /api/markets/:marketId/viz/risks` - Get risks visualization
- `POST /api/markets/:marketId/analyze` - Trigger analysis job (market-map, timeline-race, pressure, risks)

### Signals

#### **Market Signals**
- `GET /api/signals` - Get market signals (placeholder)

### Briefs

#### **Brief Management**
- `GET /api/briefs` - List all briefs (optionally filtered by sponsorId)
- `POST /api/briefs` - Create new brief

### Legacy Endpoints

#### **Sponsor Summary (Legacy)**
- `GET /api/sponsors/:sponsorId/summary` - Get program summary for sponsor
- `POST /api/refresh` - Refresh program/sponsor data (legacy)

### Job Management

#### **Async Job Status**
- `GET /api/jobs/:jobId` - Get job status by ID

---

## BACKEND DATA PROCESSING (Workers)

### Data Sources

#### **ClinicalTrials.gov Integration**
- `searchTrialsByMolecule(moleculeName)` - Search trials by intervention/molecule
- `searchTrialsBySponsor(sponsorName)` - Search trials by sponsor
- `getTrialDetails(nctId)` - Get detailed trial information
- `normalizeTrial(study)` - Normalize trial data from API response
- Trial data caching (24 hours)
- Extracts: NCT ID, title, status, phase, sponsor, conditions, interventions, outcomes, locations, dates, enrollment, eligibility

#### **PubMed Integration** ✅ FULLY IMPLEMENTED
- `searchLiterature(moleculeName, synonyms, options)` - Search PubMed for papers
- `parsePubMedXML(xmlText)` - Parse PubMed XML response
- `tagPaper(paper, moleculeName)` - Tag papers with keywords (efficacy, safety, biomarker, mechanism, phase2, phase3)
- `dedupeByPMID(papers)` - Remove duplicate papers
- Literature caching (1 hour for sponsor-specific, 2 hours for trends)
- Returns up to 200 papers with abstracts, tags, relevance scores

**NEW API Endpoints:**
- `GET /api/markets/:marketId/sponsors/:sponsorId/literature` - Get literature for sponsor's molecules
- `GET /api/literature/search?q=<query>` - Direct literature search by any term
- `GET /api/markets/:marketId/literature/trends` - Get publication trends for top molecules

**NEW Features:**
- Full Literature tab UI in Sponsor Detail page
- Standalone Literature Search page (`/literature`)
- Research focus area breakdown (efficacy, safety, biomarker, mechanism)
- Top journals analysis
- Key publications highlighting (Phase 3, efficacy focus)
- Publication trends with increase/decrease indicators
- Quick search from market trends

#### **Web Signals** (Placeholder)
- `searchWebSignals(sponsorName, moleculeName)` - Search web signals (placeholder)

### Enrichment Functions

#### **Profile Building**
- `buildTargetProfile(trials, referenceRow)` - Build sponsor/program profile from trials
  - Extracts: active trials, phase 3 trials, median enrollment, endpoints, operational complexity (PET/MRI/Infusion), population keywords, recent activity

#### **Peer Analysis**
- `selectPeerSet(targetProfile, candidateProfiles)` - Select competitive peer set
- `computeBenchmarks(targetProfile, peers)` - Compute median benchmarks vs peers
- `computePressureScore(targetProfile, benchmarks)` - Calculate pressure score (0-100)
  - Factors: Phase III presence, active trials count, enrollment vs peers, peer crowding, operational complexity, recent activity

#### **Risk Analysis**
- `computeTopRisks(targetProfile, peers, benchmarks)` - Identify top 3 risks
  - Risk types: Enrollment gap, endpoint mismatch, operational complexity, late timeline
  - Severity levels: red, yellow, green

#### **Summary Generation**
- `generateWhyCallSummary(targetProfile, peers, risks)` - Generate "Why call them" narrative
- `computeEvidenceStrength(targetProfile)` - Calculate evidence strength score

#### **TAM Modeling**
- `computeTAM(assumptions)` - Compute Total Addressable Market
  - Inputs: eligible patients, annual price, diagnosis rate, peak penetration, geography multiplier
  - Outputs: TAM, SAM, SOM, ranges, confidence, sensitivity analysis

#### **Brief Compilation**
- `compileBrief(...)` - Compile all data into pre-call brief
  - Includes: executive summary, pressure score, peer crowding, top risks, lead with, objections, TAM, stats, literature, pitch

### Background Jobs

#### **Market Refresh Worker**
- `refreshMarket(marketId, quickMode)` - Refresh market data from CT.gov
  - Quick mode: 200 studies (~2-3 min)
  - Full mode: 1000 studies (~15+ min)
  - Updates: trials, sponsors, market state

#### **Program Refresh Worker**
- `refreshProgram(programId)` - Refresh individual program data

#### **Sponsor Refresh Worker**
- `refreshSponsor(sponsorId)` - Refresh sponsor data

#### **Region Attractiveness Worker**
- `computeRegionAttractiveness(marketId)` - Compute region attractiveness scores
  - Factors: clinical activity, growth, burden, competition, sales readiness, signals

#### **Analysis Worker**
- `runMarketAnalytics(marketId, type)` - Run market analysis
  - Types: market-map, timeline-race, pressure, risks

### Database Functions

#### **Caching**
- `getOrSetJson(cacheKey, fetcher, options)` - Get from cache or fetch and cache
- `buildCacheKey(parts)` - Build cache key from parts
- Cache TTL management

#### **Data Normalization**
- Normalize trial data from CT.gov API
- Extract and structure: endpoints, flags (PET/MRI/Infusion/ARIA/Biomarker), burden scores
- Sponsor name normalization
- Molecule name normalization

---

## DATA STRUCTURES

### Market State
- Market ID, indication, phase range
- Coverage counts (trials, sponsors, active Phase III)
- Last refresh timestamps
- Source health status

### Sponsor Profile
- Sponsor ID, name
- Pressure score
- Trial counts (Phase II, Phase III, total active)
- Median enrollment
- Countries count
- Burden score
- Why now snippet
- Evidence link count

### Program Summary
- Program name, molecule, indication, phase
- Sponsor information
- Trial details
- Peer crowding metrics
- Top risks
- Why call summary
- Evidence strength

### Brief
- Brief ID, program ID
- Executive summary
- Pressure score
- Peer crowding
- Top risks
- Lead with
- Objections and responses
- TAM model
- Statistics
- Literature references
- Pitch content

---

## KEY FEATURES

1. **Automatic Data Aggregation**: Fetches from ClinicalTrials.gov and PubMed automatically
2. **Competitive Intelligence**: Peer benchmarking, pressure scoring, risk analysis
3. **Market Scanning**: Full market view with filtering and sorting
4. **Geographic Analysis**: Country-level breakdown and region attractiveness
5. **Pre-call Brief Generation**: Automated brief compilation for sales calls
6. **Real-time Refresh**: Async job system for data updates
7. **Caching**: Multi-layer caching for performance
8. **Metrics**: Prometheus metrics for monitoring
9. **Materialized Views**: Fast aggregations via database views
10. **Job Queue**: Background processing for long-running tasks

---

## TECHNOLOGY STACK

### Frontend
- Next.js 14+ (App Router)
- React (Client Components)
- SWR for data fetching
- TypeScript

### Backend
- Fastify (HTTP server)
- PostgreSQL (database)
- Redis (cache & job queue)
- BullMQ (job queue)
- Prometheus (metrics)

### Data Sources
- ClinicalTrials.gov API
- PubMed E-utilities API
- Web signals (placeholder)

---

## WORKFLOW

1. **Market Scan**: User views market → sees sponsors sorted by pressure → clicks sponsor
2. **Sponsor Analysis**: View speed lane cards → explore tabs → generate brief
3. **Brief Generation**: System compiles all data → creates brief → saves to database
4. **Data Refresh**: User triggers refresh → job enqueued → worker processes → data updated

---

## PLACEHOLDER FEATURES (Not Yet Implemented)

- TAM Model UI (backend function exists)
- Statistics Panel UI (backend function exists)
- ~~Literature Panel UI~~ ✅ IMPLEMENTED
- Timeline Visualization UI (backend function exists)
- Pitch Builder UI (backend function exists)
- Web Signals (backend placeholder)
- Signals Page (frontend placeholder)
- Settings Page (frontend placeholder)
