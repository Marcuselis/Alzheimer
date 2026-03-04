#!/usr/bin/env bash
set -euo pipefail

# Quick test script to manually import Alzheimer trials from AACT
# Usage: bash scripts/test_aact_import.sh [limit]

LIMIT=${1:-1000}

echo "========================================"
echo "AACT Import Test"
echo "========================================"
echo "Limit: $LIMIT trials"
echo ""

# Check if AACT database exists
echo "1. Checking AACT database..."
if psql -h localhost -U app -lqt | cut -d \| -f 1 | grep -qw "aact"; then
    echo "   ✅ AACT database exists"
else
    echo "   ❌ AACT database not found!"
    echo "   Run: bash scripts/aact_restore.sh"
    exit 1
fi

# Check if AACT has data
echo ""
echo "2. Checking AACT data..."
STUDY_COUNT=$(psql -h localhost -U app -d aact -tAc "SELECT COUNT(*) FROM studies" 2>/dev/null || echo "0")
if [ "$STUDY_COUNT" -gt 0 ]; then
    echo "   ✅ AACT has $STUDY_COUNT studies"
else
    echo "   ❌ AACT database is empty!"
    echo "   Run: bash scripts/aact_restore.sh"
    exit 1
fi

# Check Alzheimer trial count in AACT
echo ""
echo "3. Querying Alzheimer Phase II-III trials in AACT..."
ALZ_COUNT=$(psql -h localhost -U app -d aact -tAc "
SELECT COUNT(DISTINCT s.nct_id)
FROM studies s
WHERE
  (
    s.phase ILIKE '%Phase 2%' 
    OR s.phase ILIKE '%Phase 3%'
    OR s.phase ILIKE '%Phase II%'
    OR s.phase ILIKE '%Phase III%'
  )
  AND (
    s.brief_title ILIKE '%Alzheimer%'
    OR EXISTS (
      SELECT 1 FROM conditions c
      WHERE c.nct_id = s.nct_id
      AND (
        c.name ILIKE '%Alzheimer%'
        OR c.downcase_name ILIKE '%alzheimer%'
      )
    )
  )
" 2>/dev/null || echo "0")

echo "   Found: $ALZ_COUNT Alzheimer Phase II-III trials in AACT"

if [ "$ALZ_COUNT" -eq 0 ]; then
    echo "   ⚠️  No Alzheimer trials found. Check AACT restore."
    exit 1
fi

# Check app database
echo ""
echo "4. Checking app database..."
APP_TRIAL_COUNT=$(psql -h localhost -U app -d app -tAc "SELECT COUNT(*) FROM trials WHERE source = 'aact'" 2>/dev/null || echo "0")
echo "   Currently imported: $APP_TRIAL_COUNT trials from AACT"

# Run import via API
echo ""
echo "5. Triggering import via API..."
echo "   POST http://localhost:3001/api/markets/market_alzheimer_phase23/refresh"
echo ""

# Check if API is running
if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo "   ❌ API is not running!"
    echo "   Start API: pnpm dev:api"
    exit 1
fi

# Trigger import (with USE_AACT=true temporarily)
export USE_AACT=true

RESPONSE=$(curl -s -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh?quick=false" || echo "")

if [ -z "$RESPONSE" ]; then
    echo "   ❌ API request failed"
    exit 1
fi

echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

# Extract job ID
JOB_ID=$(echo "$RESPONSE" | jq -r '.jobId' 2>/dev/null || echo "")

if [ -z "$JOB_ID" ] || [ "$JOB_ID" = "null" ]; then
    echo ""
    echo "   ⚠️  Could not extract job ID. Check API response above."
    exit 0
fi

echo ""
echo "6. Monitoring job $JOB_ID..."
echo ""

# Poll job status
for i in {1..30}; do
    sleep 2
    
    STATUS_RESPONSE=$(curl -s "http://localhost:3001/api/jobs/$JOB_ID?queue=market-refresh" || echo "")
    
    if [ -z "$STATUS_RESPONSE" ]; then
        echo "   ⚠️  Could not fetch job status"
        break
    fi
    
    JOB_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.state' 2>/dev/null || echo "unknown")
    PROGRESS=$(echo "$STATUS_RESPONSE" | jq -r '.progress' 2>/dev/null || echo "0")
    
    echo "   [$i/30] Status: $JOB_STATUS | Progress: $PROGRESS%"
    
    if [ "$JOB_STATUS" = "completed" ]; then
        echo ""
        echo "   ✅ Import completed successfully!"
        echo ""
        echo "$STATUS_RESPONSE" | jq '.returnvalue' 2>/dev/null || echo ""
        break
    elif [ "$JOB_STATUS" = "failed" ]; then
        echo ""
        echo "   ❌ Import failed!"
        echo ""
        echo "$STATUS_RESPONSE" | jq '.failedReason' 2>/dev/null || echo ""
        exit 1
    fi
done

# Final verification
echo ""
echo "7. Verifying import..."
FINAL_COUNT=$(psql -h localhost -U app -d app -tAc "SELECT COUNT(*) FROM trials WHERE source = 'aact'" 2>/dev/null || echo "0")
ROLLUP_COUNT=$(psql -h localhost -U app -d app -tAc "SELECT COUNT(*) FROM mv_market_sponsor_rollup WHERE market_id = 'market_alzheimer_phase23'" 2>/dev/null || echo "0")

echo "   Trials imported: $FINAL_COUNT (was: $APP_TRIAL_COUNT)"
echo "   Sponsors in rollup: $ROLLUP_COUNT"

if [ "$FINAL_COUNT" -gt "$APP_TRIAL_COUNT" ]; then
    echo ""
    echo "========================================"
    echo "✅ AACT Import Successful!"
    echo "========================================"
    echo ""
    echo "Imported: $(($FINAL_COUNT - $APP_TRIAL_COUNT)) new trials"
    echo "Total: $FINAL_COUNT trials from AACT"
    echo ""
    echo "Next steps:"
    echo "  - Check warehouse status: curl http://localhost:3001/api/warehouse/status | jq"
    echo "  - View sponsors: curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors | jq"
    echo "  - Open UI: http://localhost:3000/market-scan"
else
    echo ""
    echo "⚠️  No new trials imported. May be up to date or import failed."
fi

echo ""
