# Data Sources and Information Gathered

## Primary Data Source

### ClinicalTrials.gov API
**URL**: `https://clinicaltrials.gov/api/query/study_fields`

This is the **only external data source** used by the market refresh. ClinicalTrials.gov is the official U.S. government database of clinical trials.

## What Data is Gathered

### 1. Trial Identification
- **NCT ID**: Unique ClinicalTrials.gov identifier (e.g., NCT07170150)
- **Brief Title**: Trial title/name
- **Last Update Date**: When the trial was last updated on CT.gov

### 2. Trial Status & Phase
- **Overall Status**: 
  - RECRUITING
  - ACTIVE_NOT_RECRUITING
  - ENROLLING_BY_INVITATION
  - NOT_YET_RECRUITING
  - COMPLETED
- **Phase**: Phase I, Phase II, Phase III, Phase II/III, etc.

### 3. Trial Timeline
- **Start Date**: When the trial started
- **Primary Completion Date**: Expected primary completion
- **Completion Date**: Expected full completion
- **Enrollment Count**: Number of participants

### 4. Sponsor Information
- **Lead Sponsor Name**: Primary company/organization running the trial
- **Collaborator Names**: Partner organizations

### 5. Medical Information
- **Conditions**: Medical conditions being studied (e.g., "Alzheimer Disease", "Mild Cognitive Impairment")
- **Interventions**: Drugs/treatments being tested
- **Intervention Types**: Drug, Device, Biological, etc.

### 6. Geographic Data
- **Location Countries**: Countries where trial sites are located
- Stored as individual country records per trial

### 7. Computed/Inferred Data

The system also computes additional insights from the raw data:

#### Trial Flags (computed from text analysis)
- **Has PET scan**: Detects mentions of PET/positron emission tomography
- **Has MRI**: Detects mentions of MRI/magnetic resonance imaging
- **Has Infusion**: Detects IV/infusion requirements
- **Mentions ARIA**: Detects amyloid-related imaging abnormalities
- **Has Biomarker**: Detects biomarker mentions (amyloid, tau, etc.)
- **Route of Administration**: oral, IV, subcutaneous, infusion, or mixed
- **Burden Score**: 0-6 scale based on monitoring requirements

#### Sponsor Normalization
- Normalizes sponsor names (e.g., "Biogen Inc" → "Biogen")
- Handles variations and abbreviations
- Creates sponsor records for analysis

## Market Definition (Alzheimer's)

The default market scan searches for:

### Search Query
```
("Alzheimer Disease" OR "Alzheimer's" OR "Mild Cognitive Impairment" OR MCI) 
AND NOT ("vascular dementia" OR "Parkinson")
```

### Filters Applied
- **Phases**: Phase 2, Phase 2/3, Phase 3 only
- **Statuses**: 
  - RECRUITING
  - ACTIVE_NOT_RECRUITING
  - ENROLLING_BY_INVITATION
  - NOT_YET_RECRUITING
  - COMPLETED
- **Update Window**: Trials updated within last 30 days (for incremental refreshes)

## What Gets Stored in Database

### Tables Populated

1. **`raw_source_payloads`**
   - Complete raw JSON from ClinicalTrials.gov API
   - For auditability and future reference

2. **`trials`**
   - Normalized trial data
   - JSON payload with all trial information
   - Links to sponsors

3. **`trial_metadata`**
   - Extracted structured fields (dates, enrollment)
   - Separated for fast queries

4. **`trial_locations`**
   - Country-level location data
   - One row per country per trial

5. **`trial_flags`**
   - Computed flags (PET, MRI, infusion, etc.)
   - Burden scores

6. **`sponsors`**
   - Normalized sponsor names
   - Unique sponsor records

7. **`market_trials`**
   - Links trials to market definitions
   - Market membership table

8. **`mv_market_sponsor_rollup`** (Materialized View)
   - Pre-computed sponsor statistics
   - Phase 2/3 active counts
   - Pressure scores
   - Geographic coverage
   - Why-now snippets

## Data Flow

```
ClinicalTrials.gov API
    ↓
Market Refresh Job
    ↓
1. Fetch studies (paginated, 100 per page)
    ↓
2. For each study:
   - Extract fields
   - Normalize sponsor
   - Compute flags
   - Store in database
    ↓
3. Compute materialized views
   - Sponsor rollups
   - Pressure scores
   - Geographic analysis
    ↓
4. Cache warming
   - Pre-populate common API endpoints
```

## What is NOT Gathered

The market refresh does **NOT** fetch:
- ❌ Detailed trial protocols
- ❌ Full eligibility criteria (only basic text)
- ❌ Primary/secondary endpoints (only basic text)
- ❌ Site-level Principal Investigator names
- ❌ Contact information (emails, phone numbers)
- ❌ Full study documents
- ❌ Results data (outcomes, publications)
- ❌ PubMed publications (separate feature)
- ❌ News articles (separate feature)

## Data Freshness

- **First Refresh**: Fetches all matching trials
- **Incremental Refresh**: Only fetches trials updated in last 30 days
- **Idempotency**: Skips trials that haven't changed since last fetch

## API Rate Limits

- **Rate Limit**: 10 requests/second (100ms between requests)
- **Timeout**: 30 seconds per request
- **Retries**: 3 attempts with exponential backoff
- **Respects**: ClinicalTrials.gov rate limiting guidelines

## Example Query

For Alzheimer's market, the actual API call looks like:

```
GET https://clinicaltrials.gov/api/query/study_fields?
  expr=("Alzheimer Disease" OR "Alzheimer's" OR "Mild Cognitive Impairment" OR MCI) 
        AND NOT ("vascular dementia" OR "Parkinson")
        AND (PHASE2 OR PHASE23 OR PHASE3)
        AND (OVERALL_STATUS:RECRUITING OR OVERALL_STATUS:ACTIVE_NOT_RECRUITING ...)
  &fields=NCTId,BriefTitle,OverallStatus,Phase,StartDate,PrimaryCompletionDate,
          CompletionDate,EnrollmentCount,LeadSponsorName,CollaboratorName,
          Condition,InterventionName,InterventionType,LocationCountry,LastUpdatePostDate
  &min_rnk=1
  &max_rnk=100
  &fmt=json
```

## Summary

**Source**: ClinicalTrials.gov (U.S. government database)  
**What**: Clinical trial metadata for Alzheimer's Phase II-III trials  
**How**: REST API queries with pagination  
**Frequency**: On-demand or incremental (last 30 days)  
**Volume**: 200-1000 trials per refresh  
**Size**: ~35 MB total storage for full scan
