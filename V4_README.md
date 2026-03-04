# V4 Analyst Workstation - Complete Guide

## Overview

V4 is a complete rewrite of the NCT Lookup Tool into a SaaS-style analyst workstation with automatic data aggregation, deep analysis panels, and a fast workflow for generating pre-call briefs.

## Architecture

### Frontend
- **File**: `nct_lookup_app_v4.html`
- Single HTML file with embedded CSS and JavaScript
- Hash-based routing (`#/dashboard`, `#/market`, `#/sponsor`, etc.)
- localStorage for persistence
- Calls backend API for all data operations

### Backend
- **Folder**: `server_v4/`
- Node.js/Express server
- SQLite database for caching and persistence
- Automatic data aggregation from:
  - ClinicalTrials.gov API
  - PubMed E-utilities
  - Web signals (best-effort)

## Setup

### Backend Setup

1. Navigate to server directory:
```bash
cd server_v4
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

The server will run on `http://localhost:3000` by default.

### Frontend Setup

1. Open `nct_lookup_app_v4.html` in a web browser
2. The app will attempt to connect to `http://localhost:3000` by default
3. To use a different backend URL, set it before loading:
```javascript
window.API_BASE = 'http://your-backend-url:3000';
```

## Workflow

### Fast Lane (90 seconds end-to-end)

1. **Dashboard** → Click "Market Scan"
2. **Market Scan** → Run scan, click on a sponsor row
3. **Sponsor View** → See speed lane cards:
   - Pressure Score
   - Peer Crowding
   - Top Risks
   - Why Call Them
   - Lead With
4. **Generate Brief** → Click "Generate Pre-call Brief"
5. **Briefs View** → View and print the generated brief

### Deep Lane Panels

In the Sponsor view, below the speed lane cards, you'll find tabs:

- **TAM Model**: Perfect TAM modeling with assumptions, ranges, sensitivity
- **Statistics**: Full statistical rigor with endpoint extraction, evidence strength
- **Literature**: Exhaustive literature review (automatic PubMed search)
- **Timeline**: Competitive timeline showing peer progression
- **Pitch Builder**: Editable pitch blocks with objections assistant

## Features

### Automatic Data Gathering

- **ClinicalTrials.gov**: Automatic trial search by molecule or sponsor
- **PubMed**: Automatic literature search (up to 200 papers)
- **Web Signals**: Best-effort web signal search (placeholder in MVP)

### Data Sources Status

The app shows source status indicators:
- ✅ **OK**: Source succeeded
- ❌ **ERROR**: Source failed (partial results shown)
- ⏭️ **SKIPPED**: Source not applicable
- ⏳ **PENDING**: Source in progress

### Persistence

All data is stored in:
- **localStorage** (frontend): Settings, accounts, briefs, notes, activity
- **SQLite** (backend): Cache entries, briefs, snapshots

Storage keys:
- `v4_settings`: User settings
- `v4_accounts`: Sponsor accounts
- `v4_briefs`: Generated briefs
- `v4_notes`: Call notes
- `v4_activity`: Activity log
- `v4_snapshots`: Change tracking

## API Endpoints

### Health Check
```
GET /health
```

### Search
```
GET /api/search/molecule?q=<molecule>
GET /api/search/sponsor?q=<sponsor>
```

### Sponsor Summary
```
GET /api/sponsor/:id/summary
```

### Refresh Data
```
POST /api/refresh
Body: { sponsorName, moleculeName, indication, phaseRange }
```

### Briefs
```
POST /api/brief
Body: { sponsorName, moleculeName, programName, tamAssumptions, pitch }

GET /api/brief/:id
GET /api/briefs
```

## Verification Checklist

Before using V4, verify:

1. ✅ Backend server starts without errors
2. ✅ `/health` endpoint returns `{"status":"ok"}`
3. ✅ Frontend loads without console errors
4. ✅ Navigation between views works
5. ✅ Market scan button produces results (or graceful message)
6. ✅ Sponsor view populates speed lane cards
7. ✅ "Generate Brief" creates a brief
8. ✅ Briefs view shows generated briefs
9. ✅ Print stylesheet works (test print preview)

## Troubleshooting

### Backend won't start
- Check Node.js version (requires >= 16.0.0)
- Run `npm install` again
- Check port 3000 is not in use

### Frontend can't connect to backend
- Verify backend is running: `curl http://localhost:3000/health`
- Check browser console for CORS errors
- Set `window.API_BASE` to correct URL

### No data in views
- Check backend logs for API errors
- Verify ClinicalTrials.gov API is accessible
- Check browser console for fetch errors

### Brief generation fails
- Ensure sponsor data is loaded first
- Check backend logs for errors
- Verify all required fields are present

## Development

### Adding New Views

1. Add view container in HTML:
```html
<section id="view-new-view" style="display: none;">
    <h2>New View</h2>
    <div id="new-view-content"></div>
</section>
```

2. Add route in `setRoute()` function
3. Add renderer in `renderV4View()`
4. Add navigation item in sidebar

### Adding New API Endpoints

1. Add endpoint in `server_v4/server.js`
2. Add handler function
3. Update frontend to call endpoint
4. Update README

## Notes

- V2 files remain untouched (as required)
- V4 is a complete rewrite with new architecture
- All buttons are wired with console logs for debugging
- No dead UI elements (all buttons have handlers)
- Single HTML file for easy deployment
- Backend can be deployed separately

## Future Enhancements

- Full market scan implementation (query all Phase II-III trials)
- Enhanced web signals (Google News API integration)
- Reference CSV integration for peer set selection
- Advanced TAM modeling with geographic segmentation
- Real-time data refresh notifications
- Export to PDF functionality
- Multi-user support with authentication
