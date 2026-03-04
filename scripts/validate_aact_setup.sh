#!/usr/bin/env bash
set -euo pipefail

# AACT Setup Validation Script
# Checks if all components of AACT integration are working correctly

echo "========================================"
echo "AACT Setup Validation"
echo "========================================"
echo ""

ERRORS=0
WARNINGS=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

function check_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
}

function check_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    ((ERRORS++))
}

function check_warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
    ((WARNINGS++))
}

# ========================================
# Phase 1: Data Folder
# ========================================
echo "Phase 1: Data Folder Setup"
echo "---"

if [ -d "data/aact" ]; then
    check_pass "data/aact/ directory exists"
else
    check_fail "data/aact/ directory not found"
    echo "         Run: mkdir -p data/aact"
fi

if grep -q "data/aact/\*" .gitignore 2>/dev/null; then
    check_pass "data/aact/* in .gitignore"
else
    check_warn "data/aact/* not in .gitignore (files may be committed)"
fi

if [ -f "data/aact/aact_snapshot.zip" ]; then
    check_pass "AACT snapshot file exists"
    SIZE=$(du -h data/aact/aact_snapshot.zip | cut -f1)
    echo "         File size: $SIZE"
else
    check_warn "AACT snapshot not found at data/aact/aact_snapshot.zip"
    echo "         Download from: https://aact.ctti-clinicaltrials.org/downloads/snapshots"
fi

echo ""

# ========================================
# Phase 2: Scripts
# ========================================
echo "Phase 2: Restore Scripts"
echo "---"

if [ -f "scripts/aact_restore.sh" ]; then
    check_pass "scripts/aact_restore.sh exists"
    
    if [ -x "scripts/aact_restore.sh" ]; then
        check_pass "aact_restore.sh is executable"
    else
        check_fail "aact_restore.sh is not executable"
        echo "         Run: chmod +x scripts/aact_restore.sh"
    fi
else
    check_fail "scripts/aact_restore.sh not found"
fi

if [ -f "scripts/test_aact_import.sh" ]; then
    check_pass "scripts/test_aact_import.sh exists"
    
    if [ -x "scripts/test_aact_import.sh" ]; then
        check_pass "test_aact_import.sh is executable"
    else
        check_fail "test_aact_import.sh is not executable"
        echo "         Run: chmod +x scripts/test_aact_import.sh"
    fi
else
    check_warn "scripts/test_aact_import.sh not found"
fi

echo ""

# ========================================
# Phase 3: Database
# ========================================
echo "Phase 3: Database Setup"
echo "---"

# Check if postgres is running
if command -v psql &> /dev/null; then
    check_pass "psql command available"
    
    # Check if app database exists
    if psql -h localhost -U app -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "app"; then
        check_pass "App database exists"
    else
        check_fail "App database not found"
        echo "         Run: pnpm dev:docker"
    fi
    
    # Check if AACT database exists
    if psql -h localhost -U app -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "aact"; then
        check_pass "AACT database exists"
        
        # Check if AACT has data
        STUDY_COUNT=$(psql -h localhost -U app -d aact -tAc "SELECT COUNT(*) FROM studies" 2>/dev/null || echo "0")
        if [ "$STUDY_COUNT" -gt 0 ]; then
            check_pass "AACT database has data ($STUDY_COUNT studies)"
        else
            check_fail "AACT database is empty"
            echo "         Run: bash scripts/aact_restore.sh"
        fi
    else
        check_warn "AACT database not found"
        echo "         Run: bash scripts/aact_restore.sh"
    fi
else
    check_fail "psql command not found (install PostgreSQL client)"
fi

echo ""

# ========================================
# Phase 4: Environment
# ========================================
echo "Phase 4: Environment Configuration"
echo "---"

if [ -f ".env" ]; then
    check_pass ".env file exists"
    
    if grep -q "AACT_DATABASE_URL" .env 2>/dev/null; then
        check_pass "AACT_DATABASE_URL in .env"
    else
        check_warn "AACT_DATABASE_URL not in .env"
        echo "         Add: AACT_DATABASE_URL=postgresql://app:app@localhost:5432/aact"
    fi
    
    if grep -q "USE_AACT" .env 2>/dev/null; then
        USE_AACT_VALUE=$(grep "USE_AACT" .env | cut -d= -f2)
        check_pass "USE_AACT in .env (value: $USE_AACT_VALUE)"
    else
        check_warn "USE_AACT not in .env (defaults to false)"
    fi
else
    check_warn ".env file not found"
    echo "         Copy from .env.example"
fi

if [ -f ".env.example" ]; then
    check_pass ".env.example file exists"
else
    check_fail ".env.example file not found"
fi

echo ""

# ========================================
# Phase 5: Code Files
# ========================================
echo "Phase 5: Code Files"
echo "---"

if [ -f "apps/api/src/db/aactClient.ts" ]; then
    check_pass "AACT client exists (apps/api/src/db/aactClient.ts)"
else
    check_fail "AACT client not found"
fi

if [ -f "apps/workers/src/jobs/importAlzheimersFromAACT.ts" ]; then
    check_pass "AACT import job exists"
else
    check_fail "AACT import job not found"
fi

if [ -f "apps/workers/src/workers/aactImportWorker.ts" ]; then
    check_pass "AACT import worker exists"
else
    check_fail "AACT import worker not found"
fi

# Check if worker is exported
if grep -q "aactImportWorker" apps/workers/src/workers/index.ts 2>/dev/null; then
    check_pass "AACT worker exported in index"
else
    check_fail "AACT worker not exported"
fi

# Check if market refresh worker uses USE_AACT
if grep -q "USE_AACT" apps/workers/src/workers/marketRefreshWorker.ts 2>/dev/null; then
    check_pass "Market refresh worker checks USE_AACT flag"
else
    check_fail "Market refresh worker missing USE_AACT logic"
fi

echo ""

# ========================================
# Phase 6: API Endpoint
# ========================================
echo "Phase 6: API Endpoint"
echo "---"

# Check if API endpoint exists in code
if grep -q "/api/warehouse/status" apps/api/src/index.ts 2>/dev/null; then
    check_pass "Warehouse status endpoint exists in code"
else
    check_fail "Warehouse status endpoint not found in code"
fi

# Check if API is running
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    check_pass "API is running on port 3001"
    
    # Test warehouse status endpoint
    STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/warehouse/status 2>/dev/null || echo "000")
    if [ "$STATUS_CODE" = "200" ]; then
        check_pass "Warehouse status endpoint responds (200 OK)"
        
        # Check if AACT is connected
        CONNECTED=$(curl -s http://localhost:3001/api/warehouse/status 2>/dev/null | grep -o '"connected":[^,}]*' | grep -o 'true\|false' || echo "unknown")
        if [ "$CONNECTED" = "true" ]; then
            check_pass "AACT warehouse is connected"
        else
            check_warn "AACT warehouse not connected"
        fi
    else
        check_warn "Warehouse status endpoint not responding (HTTP $STATUS_CODE)"
    fi
else
    check_warn "API not running on port 3001"
    echo "         Start API: pnpm dev:api"
fi

echo ""

# ========================================
# Phase 7: Documentation
# ========================================
echo "Phase 7: Documentation"
echo "---"

if [ -f "docs/aact_setup.md" ]; then
    check_pass "Setup guide exists (docs/aact_setup.md)"
else
    check_fail "Setup guide not found"
fi

if [ -f "docs/AACT_QUICK_REFERENCE.md" ]; then
    check_pass "Quick reference exists"
else
    check_warn "Quick reference not found"
fi

if [ -f "docs/AACT_IMPLEMENTATION_SUMMARY.md" ]; then
    check_pass "Implementation summary exists"
else
    check_warn "Implementation summary not found"
fi

if grep -q "AACT" README.md 2>/dev/null; then
    check_pass "README mentions AACT"
else
    check_warn "README doesn't mention AACT"
fi

echo ""

# ========================================
# Phase 8: Data Import
# ========================================
echo "Phase 8: Data Import Status"
echo "---"

if command -v psql &> /dev/null && psql -h localhost -U app -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "app"; then
    IMPORTED_COUNT=$(psql -h localhost -U app -d app -tAc "SELECT COUNT(*) FROM trials WHERE source = 'aact'" 2>/dev/null || echo "0")
    
    if [ "$IMPORTED_COUNT" -gt 0 ]; then
        check_pass "Trials imported from AACT ($IMPORTED_COUNT trials)"
    else
        check_warn "No trials imported from AACT yet"
        echo "         Run: bash scripts/test_aact_import.sh"
    fi
    
    ROLLUP_COUNT=$(psql -h localhost -U app -d app -tAc "SELECT COUNT(*) FROM mv_market_sponsor_rollup WHERE market_id = 'market_alzheimer_phase23'" 2>/dev/null || echo "0")
    
    if [ "$ROLLUP_COUNT" -gt 0 ]; then
        check_pass "Market rollups computed ($ROLLUP_COUNT sponsors)"
    else
        check_warn "Market rollups not computed yet"
    fi
else
    check_warn "Cannot check import status (database not accessible)"
fi

echo ""

# ========================================
# Summary
# ========================================
echo "========================================"
echo "Validation Summary"
echo "========================================"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ ALL CHECKS PASSED!${NC}"
    echo ""
    echo "AACT integration is fully set up and working."
    echo ""
    echo "Next steps:"
    echo "  - Import Alzheimer trials: bash scripts/test_aact_import.sh"
    echo "  - Enable warehouse mode: Add USE_AACT=true to .env"
    echo "  - Check status: curl http://localhost:3001/api/warehouse/status | jq"
    echo ""
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠️  SETUP INCOMPLETE${NC}"
    echo ""
    echo "Errors: $ERRORS"
    echo "Warnings: $WARNINGS"
    echo ""
    echo "AACT integration is partially set up."
    echo "Review warnings above and complete missing steps."
    echo ""
    echo "See: docs/aact_setup.md for full setup guide"
    echo ""
    exit 0
else
    echo -e "${RED}❌ SETUP FAILED${NC}"
    echo ""
    echo "Errors: $ERRORS"
    echo "Warnings: $WARNINGS"
    echo ""
    echo "AACT integration has errors that need to be fixed."
    echo "Review failures above and follow the remediation steps."
    echo ""
    echo "See: docs/aact_setup.md for troubleshooting"
    echo ""
    exit 1
fi
