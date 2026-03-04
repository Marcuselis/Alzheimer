# Alzheimer Clinical Trials Research Tool (v2)

**This is a copy of the Alzheimer project (v_2)** — use this folder for a separate line of development. Original: `../Alzheimer`.

This repository contains tools and reference files for analyzing Alzheimer's disease clinical trials, with a comprehensive web application for searching and analyzing trial data.

## 🚀 Modern Stack (Production-Ready)

The modern implementation provides instant market intelligence using a local AACT warehouse:

### Architecture
- **API**: Fastify (TypeScript) - `/apps/api`
- **Workers**: BullMQ job processing - `/apps/workers`
- **Web UI**: Next.js - `/apps/web`
- **Data Warehouse**: AACT (complete ClinicalTrials.gov snapshot)
- **Database**: PostgreSQL + Redis

### Quick Start (API Mode - No Large Database)

**✨ Two options based on your needs:**

#### Option A: Quick Test (2-3 minutes, 200 trials)

```bash
# 1. Install dependencies
pnpm install

# 2. Start services
pnpm dev:docker    # Postgres + Redis (wait 10 seconds)

# 3. Start apps (open 3 terminals)
pnpm dev:api       # Terminal 1: API server (port 3001)
pnpm dev:workers   # Terminal 2: Background job workers
pnpm dev:web       # Terminal 3: Web UI (port 3000) [optional]

# 4. Quick test - verify everything works
bash scripts/quick_test_api.sh
```

#### Option B: Full Broad View (15-20 minutes, 1000 trials)

After quick test succeeds:

```bash
# Load comprehensive dataset
bash scripts/full_refresh_api.sh
```

**Guides:**
- **Quick start:** [`QUICK_START_API_MODE.md`](./QUICK_START_API_MODE.md)
- **Full dataset:** [`FULL_REFRESH_GUIDE.md`](./FULL_REFRESH_GUIDE.md)
- **What was fixed:** [`API_MODE_FIXED.md`](./API_MODE_FIXED.md)

**No 15GB database needed!** Just 1GB for comprehensive data.

### 🔥 AACT Warehouse (Instant Market Intelligence)

**AACT** (Aggregate Analysis of ClinicalTrials.gov) provides complete, local-first access to all trial data.

**Benefits:**
- ⚡ **<10 second** market refresh (vs 15+ minutes with API)
- 🎯 **500,000+ trials** available locally
- 🚀 **Zero API rate limits**
- 💯 **100% offline capable**

**Setup:**

See detailed guide: [`docs/aact_setup.md`](./docs/aact_setup.md)

**Quick setup:**
```bash
# 1. Download AACT snapshot
# https://aact.ctti-clinicaltrials.org/downloads/snapshots
# Place in: data/aact/aact_snapshot.zip

# 2. Restore AACT database
bash scripts/aact_restore.sh

# 3. Import Alzheimer Phase II-III trials
bash scripts/test_aact_import.sh

# 4. Enable warehouse mode (optional)
# Add to .env: USE_AACT=true
```

**Status check:**
```bash
curl http://localhost:3001/api/warehouse/status | jq
```

---

## Legacy Tools

The repository also contains legacy HTML-based tools for quick prototyping:

## Web Application: NCT Lookup Tool

**File**: `nct_lookup_app.html`

A comprehensive web-based tool for searching and analyzing Alzheimer's clinical trials with multiple search modes and competitive intelligence features.

### Features

#### 1. **NCT Number Search**
- Search by ClinicalTrials.gov NCT number (e.g., NCT07170150)
- Displays detailed trial information including:
  - Trial status, phase, and study type
  - Sponsor information
  - Conditions and interventions
  - Location details
  - Contact information (Principal Investigator, Central Contact)
  - Links to full ClinicalTrials.gov page

#### 2. **Molecule/Drug Search**
- Search by molecule or drug name (e.g., lecanemab, semaglutide)
- Comprehensive results including:
  - **Overview Section**: Development phase, sponsor information, trial count
  - **Clinical Trials List**: All Alzheimer's/dementia trials for the molecule
  - **Wikipedia Integration**: Automatic fetching of molecule information
  - **News Feed**: Latest pharma/biotech news about the molecule
  - **Contact Information**: Business development and clinical operations contacts
  - **Competition Analysis**: Comparison with other Alzheimer's treatments
  - **Quick Links**: Direct access to Google, Wikipedia, ClinicalTrials.gov, and news

#### 3. **Company/Sponsor Search**
- Search by company or sponsor name (e.g., Biogen, Eli Lilly)
- Company-focused results including:
  - **Company Overview**: Total trials, active trials, molecules in development
  - **Pipeline Analysis**: All molecules and phases the company is developing
  - **Geographic Presence**: Countries where trials are conducted
  - **Clinical Trials List**: All Alzheimer's trials sponsored by the company
  - **News Feed**: Company-specific news and developments
  - **Contact Information**: Business development contacts for partnerships
  - **Competition Analysis**: Market position and competitive landscape

#### 4. **Competitive Landscape Analysis**

**For Molecules:**
- Comparison with top 30 competing molecules
- Market position analysis (total trials, active trials, phases)
- Phase comparison with competitors
- Activity level benchmarking
- Top competitors highlighted with rankings

**For Companies:**
- Market share analysis with visual representation
- Top 10 competitors ranking
- Pipeline depth comparison (molecules in development)
- Phase distribution analysis
- Geographic presence comparison
- Partnership opportunities identification
- Strategic competitive insights

**Multi-Source Data Aggregation:**
- **ClinicalTrials.gov**: Primary trial data source
- **PubMed**: Research publications and clinical trial articles
- **News Aggregator**: Extracts competitive mentions from pharma news
- **Current Search Data**: Leverages already-fetched trial information
- All sources normalized into standardized format
- Source attribution displayed to users

#### 5. **News & Information Integration**
- **Pharma & Biotech News**: Automated fetching of relevant news articles
- **Wikipedia Content**: Automatic retrieval of molecule/company information
- **External Links**: Quick access to Google Search, Wikipedia, ClinicalTrials.gov
- **News Sources**: Aggregated from multiple pharma news feeds

#### 6. **Contact Information & Business Development**
- **Principal Investigator Contacts**: LinkedIn and Google search links
- **Central Contact Information**: Phone, email when available
- **Business Development Contacts**: 
  - LinkedIn searches for BD, partnership managers, clinical operations
  - Google searches for email addresses and contact information
  - Company website and contact form links
  - Targeted role-based searches (Medical Affairs, Clinical Operations, etc.)

#### 7. **Error Handling & Fallbacks**
- Multiple CORS proxy fallbacks for API access
- Graceful degradation when APIs fail
- Helpful error messages with alternative search options
- Direct links to ClinicalTrials.gov when automated search fails
- Comprehensive information pages even when trial data unavailable

### Technical Features

- **CORS Handling**: Multiple proxy services for cross-origin requests
- **Timeout Management**: Request timeouts with abort controllers
- **Data Normalization**: Standardized format across all data sources
- **Responsive Design**: Works on desktop and mobile devices
- **Real-time Updates**: Dynamic content loading and updates
- **Clickable Trial Cards**: Easy navigation between related trials

### Usage

1. Open `nct_lookup_app.html` in a web browser
2. Choose search mode:
   - **NCT Search**: Enter NCT number for specific trial details
   - **Molecule Search**: Enter drug/molecule name for comprehensive analysis
   - **Company Search**: Enter company/sponsor name for company pipeline analysis
3. Review results including trials, news, contacts, and competition analysis
4. Click on trial cards to view full details
5. Use quick links to explore external resources

### Data Sources

- **ClinicalTrials.gov API**: Primary source for trial data
- **PubMed API**: Research publications
- **Wikipedia API**: General information
- **News RSS Feeds**: Pharma/biotech news aggregators
- **Reference CSVs**: Local reference data (see below)

---

## Reference Files

This folder contains derived reference files built from:
- `data/ctg-studies.csv` (ClinicalTrials.gov export)
- `data/trc270098-sup-0002-tables1.docx` (Cummings 2025 Table S1 – Phase 3 agents)
- `data/trc270098-sup-0003-tables2.docx` (Cummings 2025 Table S2 – Phase 2 agents)
- `data/trc270098-sup-0004-tables3.docx` (Cummings 2025 Table S3 – Phase 1 agents)

All outputs are UTF-8 CSV and are generated by `build_references.py`.

### country_reference.csv

**What it is**
- **One row per canonical country** observed in CT.gov `Locations` for the Alzheimer trials in `ctg-studies.csv`.

**Columns**
- **canonical_country**: Normalized English country name (e.g., `United States`, `Czechia`, `South Korea`).
- **region_priority**: `Nordic`, `EU`, or `Other`.
- **is_nordic**: `TRUE` if in the Nordic set (Finland, Sweden, Denmark, Norway, Iceland); otherwise `FALSE`.
- **is_eu**: `TRUE` if in the EU 27 list (current as of 2025); otherwise `FALSE`.
- **needs_review**: `TRUE` if the source token was ambiguous or could not be confidently mapped; otherwise `FALSE`.
- **note**: Short text explaining ambiguity or mapping issues (e.g., ambiguous `Korea`, or tokens not clearly recognized as countries).

**How it was generated**
- Parsed the `Locations` column from `ctg-studies.csv`.
- For each site, took the **last comma-separated token** as the country-like string.
- Normalized common variants (e.g., `USA`, `U.S.`, `U.S.A.` → `United States`; `Czech Republic` → `Czechia`; `Turkey (Türkiye)` → `Turkey`; `Korea, Republic of` → `South Korea`).
- Tagged EU/Nordic membership via hard-coded country sets.
- Sorted as: all Nordics (alphabetical) → all EU (alphabetical) → all Others (alphabetical).

**Key assumptions / limitations**
- Only true countries are intended; tokens not clearly recognized as countries (e.g., unusual region labels) are passed through **with `needs_review = TRUE`** so you can filter or fix manually.
- Ambiguous tokens such as plain `Korea` are **not force-resolved**; instead they are included with `needs_review = TRUE` and an explanatory `note`.
- No attempt is made to back-solve city/hospital fields; country inference is purely string-based from the trailing token in each `Locations` entry.

### molecule_reference.csv

**What it is**
- **Authoritative list of Alzheimer drug development agents (Phase 1–3)** based on Cummings 2025 Tables S1–S3.
- Enriched (best-effort) with sponsor and geographic coverage from `ctg-studies.csv`.

**Columns**
- **canonical_molecule**: Agent name as in Cummings tables (whitespace-normalized).
- **phase_from_cummings**: `Phase 1`, `Phase 2`, or `Phase 3` (based on the source table S1–S3, not CT.gov).
- **cadro_category**: CADRO category from Cummings, if present in the table (blank if absent).
- **mechanism_of_action**: Mechanism text from Cummings, if present (blank if absent).
- **nct_ids**: Pipe-separated list of NCT IDs extracted from the tables, if present (blank if none).
- **lead_sponsor_from_cummings**: Sponsor text from the tables, if present (blank if absent).
- **matched_ctgov_trials_count**: Number of CT.gov trials in `ctg-studies.csv` that are linked to this molecule.
- **matched_sponsors_ctgov**: Pipe-separated set of sponsor/collaborator names from the matched CT.gov records.
- **matched_countries_ctgov**: Pipe-separated set of **canonical_country** values derived via the same logic as `country_reference.csv`.
- **nordic_presence**: `TRUE` if any matched country is Nordic; otherwise `FALSE`.
- **eu_presence**: `TRUE` if any matched country is in the EU; otherwise `FALSE`.

**How it was generated**
- Parsed each DOCX (`tables1–3`) as the **first table in the Word document** using XML and extracted:
  - Agent name, CADRO category, mechanism, NCT column, and sponsor column via header keyword matching.
  - Phase was assigned as `Phase 3` for S1, `Phase 2` for S2, and `Phase 1` for S3.
- Extracted NCT IDs using a strict `NCT########` regex.
- Linked to CT.gov trials using:
  - **Primary**: Exact NCT Number matches between table NCT IDs and `ctg-studies.csv`.
  - **Secondary (best-effort)**: For molecules **without any NCT IDs**, fuzzy-matched normalized intervention names from CT.gov to the canonical molecule name. Only **high-similarity matches (≥ 0.95 token overlap)** were allowed to contribute to `matched_ctgov_trials_count` and geographic/sponsor enrichment.
- Country and region flags for each molecule were built from the union of matched trials’ locations, using the same country normalization as `country_reference.csv`.

**Key assumptions / limitations**
- Cummings S1–S3 are treated as the **single source of truth** for molecule names and phases; CT.gov is only used for enrichment.
- If a molecule in the tables has **no associated NCT IDs** and no high-confidence fuzzy match in CT.gov, its CT.gov enrichment fields are left blank/zero.
- Some DOCX header layouts may differ from expectations; if a column could not be reliably identified, that field is left blank rather than guessed.
- CT.gov phase labels are **not** used to override Cummings phases.

### molecule_alias.csv

**What it is**
- A mapping of **CT.gov intervention names** to **canonical Cummings molecules** plus a confidence label.
- Supports auditing and manual curation of naming variants and combinations when integrating CT.gov with the Cummings landscape.

**Columns**
- **source_intervention_name**: Exact intervention string from CT.gov `Interventions`.
- **canonical_molecule**: Canonical molecule name from Cummings tables, or `COMBINATION` for regimen/combo entries.
- **match_confidence**: `High`, `Medium`, or `Low`.
- **rule_or_reason**: Short, human-readable rule describing why the alias was created.

**How it was generated**
- For each CT.gov intervention entry (split on `|`):
  - If the string contains `"+"` or `"and"` (case-insensitive), it is treated as a **combination regimen** and mapped to:
    - `canonical_molecule = COMBINATION`
    - `match_confidence = Low`
    - `rule_or_reason = "CT.gov combination intervention (contains '+' or 'and')"`
  - Otherwise, the name is **normalized** (lower-cased, prefixes like `DRUG:` removed, dosage and simple formulation parentheses removed).
- Aliases to specific canonical molecules are created via:
  - **NCT-based exact normalized matches**: When a Cummings molecule’s NCT ID appears in CT.gov, and a CT.gov intervention’s normalized name exactly equals the normalized canonical name, an alias is created with:
    - `match_confidence = High`
    - `rule_or_reason = "Exact normalized name match via NCT linkage"`.
  - **Fuzzy name-based matches** (only for molecules **without NCT IDs in the tables**):
    - Token-overlap similarity ≥ 0.95 → `High`
    - 0.85–0.95 → `Medium`
    - 0.70–0.85 → `Low`
    - A textual `rule_or_reason` records the similarity (e.g., `Fuzzy normalized name match (similarity=0.92)`).
- All alias rows are deduplicated so the same mapping is not repeated multiple times.

**Key assumptions / limitations**
- **No molecules are invented**: `canonical_molecule` values always come directly from S1–S3 or `COMBINATION` for regimen entries.
- For trials with multiple active agents (e.g., DIAN-TU-style master protocols), aliases are only created when the **normalized intervention string clearly matches** the canonical molecule; interventions that don’t match any canonical name are left unmapped.
- Fuzzy matches with `Medium` or `Low` confidence **do not contribute** to counts or geography in `molecule_reference.csv`; they are provided purely for human review.
- Combination regimens are intentionally grouped under `COMBINATION` with `Low` confidence so you can quickly filter and review them.

### Regeneration

- All three reference CSVs are produced by running:

```bash
cd /Users/marcus/Desktop/Medino/Alzheimer
python build_references.py
```

- The script is deterministic with respect to the current inputs; re-running it will overwrite the existing `country_reference.csv`, `molecule_reference.csv`, and `molecule_alias.csv`.

---

## Python Scripts

### `build_references.py`
Generates the reference CSV files (`country_reference.csv`, `molecule_reference.csv`, `molecule_alias.csv`) from ClinicalTrials.gov data and Cummings tables.

**Usage:**
```bash
python build_references.py
```

### `build_workbook.py`
Builds an Excel workbook from the reference CSV files with multiple sheets for analysis.

**Usage:**
```bash
python build_workbook.py
```

### `extract_nordic_pis.py` / `extract_nordic_pis_final.py` / `extract_nordic_pis_browser.py`
Scripts for extracting Principal Investigator information for Nordic trial sites from ClinicalTrials.gov.

**Usage:**
```bash
python extract_nordic_pis_final.py
```

---

## File Structure

```
Alzheimer/
├── nct_lookup_app.html          # Main web application
├── build_references.py           # Generate reference CSVs
├── build_workbook.py            # Generate Excel workbook
├── extract_nordic_pis*.py       # PI extraction scripts
├── country_reference.csv        # Country normalization reference
├── molecule_reference.csv       # Molecule reference with enrichment
├── molecule_alias.csv           # Intervention name aliases
├── nordic_site_pi.csv          # Nordic site PI data
├── data/
│   ├── ctg-studies.csv         # ClinicalTrials.gov export
│   └── trc270098-sup-*.docx    # Cummings 2025 tables
└── README.md                    # This file
```

---

## Requirements

### Web Application
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection for API access
- No installation required - open HTML file directly

### Python Scripts
- Python 3.7+
- Required packages (install via `pip install -r requirements.txt` if available):
  - `openpyxl` (for Excel workbook generation)
  - `python-docx` (for DOCX parsing)
  - `requests` (for web scraping)
  - `beautifulsoup4` (for HTML parsing)

---## Notes- The web application uses CORS proxies to access ClinicalTrials.gov API due to browser security restrictions
- Some features may be limited if APIs are unavailable or blocked
- All data is fetched in real-time from external sources
- Reference CSV files provide local backup data for offline analysis