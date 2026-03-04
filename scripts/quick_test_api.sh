#!/usr/bin/env bash
set -euo pipefail

# Quick API test script with better error handling

echo "========================================"
echo "Quick API Test - Alzheimer Market"
echo "========================================"
echo ""

# Check if API is running
echo "1. Checking if API is running..."
if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo "   ❌ API is not running!"
    echo "   Start it with: pnpm dev:api"
    exit 1
fi
echo "   ✅ API is healthy"
echo ""

# Check if workers are running
echo "2. Checking workers..."
if ps aux | grep -v grep | grep "dev:workers" > /dev/null; then
    echo "   ✅ Workers appear to be running"
else
    echo "   ⚠️  Workers may not be running"
    echo "   Start them with: pnpm dev:workers"
fi
echo ""

# Check market definition
echo "3. Checking market definition..."
MARKET_COUNT=$(docker exec alzheimer-postgres psql -U app -d app -tAc "SELECT COUNT(*) FROM market_definitions WHERE id = 'market_alzheimer_phase23'")
if [ "$MARKET_COUNT" -eq "1" ]; then
    echo "   ✅ Market definition exists"
else
    echo "   ❌ Market definition missing!"
    exit 1
fi
echo ""

# Trigger QUICK refresh (200 trials, ~2-3 minutes)
echo "4. Triggering QUICK market refresh (200 trials)..."
echo "   This should take 2-3 minutes"
echo ""

RESPONSE=$(curl -s -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh?quick=true")
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

# Extract job ID
JOB_ID=$(echo "$RESPONSE" | jq -r '.jobId' 2>/dev/null || echo "")

if [ -z "$JOB_ID" ] || [ "$JOB_ID" = "null" ]; then
    echo ""
    echo "   ⚠️  Could not start job. Check API and workers are running."
    exit 1
fi

echo ""
echo "5. Monitoring job $JOB_ID..."
echo "   Press Ctrl+C to stop monitoring (job will continue)"
echo ""

# Poll job status
for i in {1..90}; do
    sleep 2
    
    STATUS_RESPONSE=$(curl -s "http://localhost:3001/api/jobs/$JOB_ID?queue=market-refresh" || echo "")
    
    if [ -z "$STATUS_RESPONSE" ]; then
        echo "   [$i] ⚠️  Could not fetch status"
        continue
    fi
    
    JOB_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.state' 2>/dev/null || echo "unknown")
    PROGRESS=$(echo "$STATUS_RESPONSE" | jq -r '.progress // 0' 2>/dev/null || echo "0")
    
    echo "   [$i/90] Status: $JOB_STATUS | Progress: $PROGRESS%"
    
    if [ "$JOB_STATUS" = "completed" ]; then
        echo ""
        echo "   ✅ Import completed successfully!"
        echo ""
        
        # Show results
        TRIALS_PROCESSED=$(echo "$STATUS_RESPONSE" | jq -r '.returnvalue.trialsProcessed // 0' 2>/dev/null || echo "0")
        echo "   Trials processed: $TRIALS_PROCESSED"
        
        # Check database
        TRIAL_COUNT=$(docker exec alzheimer-postgres psql -U app -d app -tAc "SELECT COUNT(*) FROM trials" 2>/dev/null || echo "0")
        SPONSOR_COUNT=$(docker exec alzheimer-postgres psql -U app -d app -tAc "SELECT COUNT(DISTINCT sponsor_id) FROM trials WHERE sponsor_id IS NOT NULL" 2>/dev/null || echo "0")
        
        echo "   Trials in database: $TRIAL_COUNT"
        echo "   Unique sponsors: $SPONSOR_COUNT"
        echo ""
        echo "========================================"
        echo "✅ Test Successful!"
        echo "========================================"
        echo ""
        echo "View data:"
        echo "  - API: curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors | jq"
        echo "  - Web: http://localhost:3000/market-scan"
        echo ""
        exit 0
    elif [ "$JOB_STATUS" = "failed" ]; then
        echo ""
        echo "   ❌ Import failed!"
        echo ""
        FAILED_REASON=$(echo "$STATUS_RESPONSE" | jq -r '.failedReason // "Unknown error"' 2>/dev/null || echo "Unknown")
        echo "   Error: $FAILED_REASON"
        echo ""
        echo "Check worker logs for details: pnpm dev:workers"
        exit 1
    fi
done

echo ""
echo "⏱️  Timeout after 3 minutes. Job may still be running."
echo "   Check status: curl http://localhost:3001/api/jobs/$JOB_ID?queue=market-refresh | jq"
