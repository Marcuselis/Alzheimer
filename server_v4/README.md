# V4 Analyst Workstation - Backend Server

Backend server for automatic data aggregation from ClinicalTrials.gov, PubMed, and web signals.

## Setup

1. Install dependencies:
```bash
cd server_v4
npm install
```

2. Start the server:
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000` by default.

## API Endpoints

### Health Check
- `GET /health` - Returns server status

### Search
- `GET /api/search/molecule?q=<molecule>` - Search trials by molecule name
- `GET /api/search/sponsor?q=<sponsor>` - Search trials by sponsor name

### Sponsor Summary
- `GET /api/sponsor/:id/summary` - Get enriched sponsor summary with pressure score, risks, benchmarks

### Refresh Data
- `POST /api/refresh` - Refresh all data sources for a sponsor/program
  ```json
  {
    "sponsorName": "Biogen",
    "moleculeName": "lecanemab",
    "indication": "Alzheimer",
    "phaseRange": "Phase II-III"
  }
  ```

### Briefs
- `POST /api/brief` - Generate a pre-call brief
  ```json
  {
    "sponsorName": "Biogen",
    "moleculeName": "lecanemab",
    "programName": "Lecanemab Program",
    "tamAssumptions": { ... },
    "pitch": { ... }
  }
  ```
- `GET /api/brief/:id` - Get brief by ID
- `GET /api/briefs` - List all briefs

## Data Sources

### ClinicalTrials.gov
- Automatic trial search by molecule or sponsor
- Cached for 24 hours
- Returns normalized trial data with endpoints, enrollment, status

### PubMed
- Automatic literature search using NCBI E-utilities
- Searches for molecule + Alzheimer keywords
- Returns up to 200 papers with abstracts, tags, relevance scores
- Cached for 24 hours

### Web Signals
- Best-effort web signal search (placeholder in MVP)
- Would search for press releases, regulatory mentions, trial updates
- Cached for 12 hours

## Database

SQLite database stored in `server_v4/data/v4.db`:
- `cache_entries` - API response cache
- `sponsors` - Sponsor records
- `programs` - Program/molecule records
- `snapshots` - Trial data snapshots
- `briefs` - Generated briefs

## Frontend Integration

The frontend (`nct_lookup_app_v4.html`) should be configured to call:
```javascript
const API_BASE = 'http://localhost:3000';
```

Or set via environment variable:
```bash
export API_BASE=http://localhost:3000
```

## Error Handling

All endpoints return JSON with error messages if something fails. Source status is included in responses:
- `OK` - Source succeeded
- `ERROR` - Source failed
- `SKIPPED` - Source not applicable
- `PENDING` - Source in progress

## Notes

- The server uses SQLite for persistence (no separate database server needed)
- Cache entries expire automatically
- All API calls have timeouts to prevent hanging
- The server handles CORS for local development
