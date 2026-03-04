# Market Scan API Documentation

## Overview

The Market Scan API provides endpoints to fetch, normalize, cache, and serve whole-market Alzheimer's competitive data. All data is fetched server-side from ClinicalTrials.gov, normalized, and cached in Redis.

## Endpoints

### GET /api/market/alzheimers/sponsors

Returns all sponsors in the Alzheimer's market with pressure scores and metrics.

**Response:**
```json
{
  "sponsors": [
    {
      "sponsorId": "sponsor_123",
      "sponsorName": "Biogen",
      "pressureScore": 85,
      "phase3Active": 3,
      "phase2Active": 2,
      "totalActive": 5,
      "medianEnrollment": 500,
      "countriesCount": 15,
      "burdenScore": 4,
      "lastUpdate": "2024-01-15T00:00:00Z",
      "whyNow": "Active Phase III trials with 15 countries",
      "evidenceLinkCount": 5
    }
  ],
  "indication": "Alzheimer's",
  "phaseRange": "Phase II-III"
}
```

**Cache:** 10 minutes (Redis)

### GET /api/market/alzheimers/programs

Returns all programs (molecules) in the Alzheimer's market grouped by sponsor.

**Response:**
```json
{
  "programs": [
    {
      "programKey": "lecanemab_sponsor_123",
      "molecule": "lecanemab",
      "sponsorId": "sponsor_123",
      "sponsorName": "Biogen",
      "phase": "Phase III",
      "trialCount": 3,
      "activeCount": 2,
      "medianEnrollment": 500,
      "countriesCount": 15
    }
  ],
  "indication": "Alzheimer's",
  "phaseRange": "Phase II-III"
}
```

**Cache:** 10 minutes (Redis)

### GET /api/market/alzheimers/competitive_peers

Returns competitive peer set for a given program or sponsor.

**Query Parameters:**
- `programKey` (optional): Program key to find peers for
- `sponsorId` (optional): Sponsor ID to find peers for

**Response:**
```json
{
  "peers": [
    {
      "sponsorId": "sponsor_456",
      "sponsorName": "Eli Lilly",
      "molecule": "donanemab",
      "trialCount": 2,
      "activeCount": 1
    }
  ],
  "targetPhase": "PHASE3",
  "indication": "Alzheimer's"
}
```

**Cache:** 10 minutes (Redis)

### GET /api/market/alzheimers/pressure_scores

Returns pressure scores for all sponsors with contributor breakdown.

**Response:**
```json
{
  "scores": [
    {
      "sponsorId": "sponsor_123",
      "sponsorName": "Biogen",
      "pressureScore": 85,
      "contributors": {
        "phase3Active": 3,
        "totalActive": 5,
        "countries": 15,
        "enrollment": 500,
        "burden": 4
      }
    }
  ],
  "indication": "Alzheimer's",
  "phaseRange": "Phase II-III"
}
```

**Cache:** 10 minutes (Redis)

### GET /api/market/alzheimers/benchmarks

Returns market-wide benchmark medians and averages.

**Response:**
```json
{
  "benchmarks": {
    "medians": {
      "phase3Active": 2,
      "totalActive": 4,
      "enrollment": 300,
      "countries": 8,
      "burden": 2
    },
    "averages": {
      "phase3Active": 2.5,
      "totalActive": 4.2
    },
    "marketSize": {
      "sponsorCount": 25
    }
  },
  "indication": "Alzheimer's",
  "phaseRange": "Phase II-III"
}
```

**Cache:** 10 minutes (Redis)

### POST /api/market/alzheimers/refresh

Triggers a background job to refresh the Alzheimer's market data from ClinicalTrials.gov.

**Request Body (optional):**
```json
{
  "phaseRange": ["PHASE2", "PHASE23", "PHASE3"]
}
```

**Response:**
```json
{
  "status": "accepted",
  "message": "Alzheimer's market refresh job started",
  "indication": "Alzheimer Disease",
  "phaseRange": ["PHASE2", "PHASE23", "PHASE3"],
  "timestamp": "2024-01-15T00:00:00Z"
}
```

**Note:** This endpoint returns immediately. The refresh job runs asynchronously. Use the status endpoint to check progress.

## Database Schema

### Core Tables

- **sponsors**: Normalized sponsor entities
- **programs**: Programs (molecules) linked to sponsors
- **trials**: Trial records with raw JSON payload
- **trial_metadata**: Extracted key fields (dates, enrollment, endpoints)
- **trial_locations**: Trial location data
- **trial_flags**: Normalized flags (PET, MRI, infusion, etc.)

### Materialized Views

- **mv_market_sponsor_rollup**: Precomputed sponsor metrics and pressure scores
- **mv_market_program_rollup**: Precomputed program metrics

## Data Flow

1. **Refresh Job** (`refreshMarket`):
   - Fetches trials from ClinicalTrials.gov API
   - Normalizes sponsor names and molecule names
   - Stores raw + normalized data in database
   - Computes materialized views
   - Updates market state

2. **API Endpoints**:
   - Read from materialized views (fast)
   - Cache responses in Redis (10 min TTL)
   - Return normalized data

3. **Frontend**:
   - Calls backend endpoints (no direct CT.gov calls)
   - Displays data with evidence links to CT.gov pages

## Normalization

- **Sponsor Names**: Deduplicated and canonicalized
- **Molecule Names**: Extracted from intervention text
- **Phases**: Normalized to PHASE2, PHASE23, PHASE3, OTHER
- **Routes**: Extracted from intervention text (oral, IV, SC, infusion)
- **Burden Flags**: Computed from text analysis (PET, MRI, infusion, ARIA)

## Caching Strategy

- All GET endpoints cached in Redis for 10 minutes
- Cache keys include endpoint path and query parameters
- Cache invalidated on market refresh
- Fallback to database if Redis unavailable

## Error Handling

- If CT.gov API fails, partial data is returned with error status
- Source health indicators show which sources succeeded/failed
- Last successful refresh timestamp always shown
