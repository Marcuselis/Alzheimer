#!/usr/bin/env bash
set -euo pipefail

# Full API refresh script - loads 1000 trials (15-20 minutes)

echo "========================================"
echo "Full Market Refresh - Alzheimer"
echo "========================================"
echo ""
echo "This will load ~1000 trials from ClinicalTrials.gov API"
echo "Expected time: 15-20 minutes"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

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
    echo "   ✅ Workers are running"
else
    echo "   ⚠️  Workers may not be running"
    echo "   Start them with: pnpm dev:workers"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi
echo ""

# Trigger FULL refresh (1000 trials)
echo "3. Triggering FULL market refresh (1000 trials)..."
echo "   This will take 15-20 minutes"
echo "   You can monitor progress in the worker terminal"
echo ""

RESPONSE=$(curl -s -X POST "http://localhost:3001/api/markets/market_alzheimer_phase23/refresh")
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

# Extract job ID
JOB_ID=$(echo "$RESPONSE" | jq -r '.jobId' 2>/dev/null || echo "")

if [ -z "$JOB_ID" ] || [ "$JOB_ID" = "null" ]; then
    echo ""
    echo "   ⚠️  Could not start job. Check response above."
    exit 1
fi

echo ""
echo "4. Job started: $JOB_ID"
echo ""
echo "You can:"
echo "  - Monitor in worker terminal (pnpm dev:workers)"
echo "  - Check status: curl http://localhost:3001/api/jobs/$JOB_ID?queue=market-refresh | jq"
echo "  - Check market status: curl http://localhost:3001/api/markets/market_alzheimer_phase23/refresh/status | jq"
echo ""
echo "This script will now poll for 30 minutes..."
echo "Press Ctrl+C to stop monitoring (job will continue in background)"
echo ""

# Poll job status (30 min max = 900 iterations at 2 sec intervals)
for i in {1..900}; do
    sleep 2
    
    STATUS_RESPONSE=$(curl -s "http://localhost:3001/api/jobs/$JOB_ID?queue=market-refresh" 2>/dev/null || echo "")
    
    if [ -z "$STATUS_RESPONSE" ]; then
        echo "   [$i] ⚠️  Could not fetch status"
        continue
    fi
    
    JOB_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.state' 2>/dev/null || echo "unknown")
    PROGRESS=$(echo "$STATUS_RESPONSE" | jq -r '.progress // 0' 2>/dev/null || echo "0")
    
    # Only show every 30 seconds (every 15 iterations)
    if [ $((i % 15)) -eq 0 ]; then
        ELAPSED_MIN=$((i * 2 / 60))
        echo "   [${ELAPSED_MIN}min] Status: $JOB_STATUS | Progress: $PROGRESS%"
    fi
    
    if [ "$JOB_STATUS" = "completed" ]; then
        echo ""
        echo "========================================"
        echo "✅ Full Refresh Completed!"
        echo "========================================"
        echo ""
        
        # Show results
        TRIALS_PROCESSED=$(echo "$STATUS_RESPONSE" | jq -r '.returnvalue.trialsProcessed // 0' 2>/dev/null || echo "0")
        echo "Trials processed: $TRIALS_PROCESSED"
        
        # Check database
        TRIAL_COUNT=$(docker exec alzheimer-postgres psql -U app -d app -tAc "SELECT COUNT(*) FROM trials" 2>/dev/null || echo "0")
        SPONSOR_COUNT=$(docker exec alzheimer-postgres psql -U app -d app -tAc "SELECT COUNT(DISTINCT sponsor_id) FROM trials WHERE sponsor_id IS NOT NULL" 2>/dev/null || echo "0")
        PHASE3_COUNT=$(docker exec alzheimer-postgres psql -U app -d app -tAc "SELECT COUNT(*) FROM trials WHERE payload_json->>'phase' ILIKE '%Phase 3%' OR payload_json->>'phase' ILIKE '%Phase III%'" 2>/dev/null || echo "0")
        
        echo "Trials in database: $TRIAL_COUNT"
        echo "Unique sponsors: $SPONSOR_COUNT"
        echo "Phase III trials: $PHASE3_COUNT"
        echo ""
        echo "View data:"
        echo "  - Sponsors: curl http://localhost:3001/api/markets/market_alzheimer_phase23/sponsors | jq"
        echo "  - Summary: curl http://localhost:3001/api/markets/market_alzheimer_phase23/summary | jq"
        echo "  - Web UI: http://localhost:3000/market-scan"
        echo ""
        exit 0
    elif [ "$JOB_STATUS" = "failed" ]; then
        echo ""
        echo "   ❌ Import failed!"
        echo ""
        FAILED_REASON=$(echo "$STATUS_RESPONSE" | jq -r '.failedReason // "Unknown error"' 2>/dev/null || echo "Unknown")
        echo "   Error: $FAILED_REASON"
        echo ""
        echo "Check worker logs for details"
        exit 1
    fi
done

echo ""
echo "⏱️  Still running after 30 minutes..."
echo "   Check status: curl http://localhost:3001/api/jobs/$JOB_ID?queue=market-refresh | jq"
echo "   Or check worker terminal for progress"
