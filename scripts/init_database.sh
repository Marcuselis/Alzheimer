#!/usr/bin/env bash
set -euo pipefail

# Database initialization script
# Ensures schema and market definitions are set up

echo "========================================"
echo "Database Initialization"
echo "========================================"
echo ""

# Check if Postgres is running
echo "1. Checking Postgres..."
if ! docker ps | grep -q alzheimer-postgres; then
    echo "   ❌ Postgres not running!"
    echo "   Start it with: pnpm dev:docker"
    exit 1
fi
echo "   ✅ Postgres is running"
echo ""

# Run migrations
echo "2. Running migrations..."
cd /Users/marcus/Desktop/Medino/Alzheimer/apps/api

# Check if migrations exist
if [ -f "src/db/schema.sql" ]; then
    echo "   Applying schema..."
    docker exec -i alzheimer-postgres psql -U app -d app < src/db/schema.sql 2>&1 | grep -v "already exists" || true
    echo "   ✅ Schema applied"
fi

# Run migration files
if [ -d "src/db/migrations" ]; then
    for migration in src/db/migrations/*.sql; do
        if [ -f "$migration" ]; then
            echo "   Applying $(basename $migration)..."
            docker exec -i alzheimer-postgres psql -U app -d app < "$migration" 2>&1 | grep -v "already exists" || true
        fi
    done
    echo "   ✅ Migrations applied"
fi

echo ""

# Create market definitions
echo "3. Creating market definitions..."
cat > /tmp/market_defs.sql << 'EOF'
-- Alzheimer's Disease Market
INSERT INTO market_definitions (
  id, 
  key, 
  indication_key, 
  ctgov_condition_query, 
  phase_range, 
  statuses, 
  updated_within_days, 
  geography, 
  definition_json,
  created_at,
  updated_at
) VALUES (
  'market_alzheimer_phase23',
  'alzheimer_phase23',
  'alzheimer',
  '("Alzheimer Disease" OR "Alzheimer''s Disease" OR "Alzheimer" OR "AD")',
  ARRAY['PHASE2', 'PHASE23', 'PHASE3'],
  ARRAY['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION', 'NOT_YET_RECRUITING', 'COMPLETED'],
  365,
  NULL,
  '{"id":"market_alzheimer_phase23","key":"alzheimer_phase23","indicationKey":"alzheimer","ctgovConditionQuery":"(\"Alzheimer Disease\" OR \"Alzheimer''s Disease\" OR \"Alzheimer\" OR \"AD\")","phaseRange":["PHASE2","PHASE23","PHASE3"],"statuses":["RECRUITING","ACTIVE_NOT_RECRUITING","ENROLLING_BY_INVITATION","NOT_YET_RECRUITING","COMPLETED"],"updatedWithinDays":365,"geography":null}'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  definition_json = EXCLUDED.definition_json,
  updated_at = NOW();

-- Alternative ID for compatibility
INSERT INTO market_definitions (
  id, 
  key, 
  indication_key, 
  ctgov_condition_query, 
  phase_range, 
  statuses, 
  updated_within_days, 
  geography, 
  definition_json,
  created_at,
  updated_at
) VALUES (
  'market_alzheimers_phase23',
  'alzheimers_phase23',
  'alzheimer',
  '("Alzheimer Disease" OR "Alzheimer''s Disease" OR "Alzheimer" OR "AD")',
  ARRAY['PHASE2', 'PHASE23', 'PHASE3'],
  ARRAY['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION', 'NOT_YET_RECRUITING', 'COMPLETED'],
  365,
  NULL,
  '{"id":"market_alzheimers_phase23","key":"alzheimers_phase23","indicationKey":"alzheimer","ctgovConditionQuery":"(\"Alzheimer Disease\" OR \"Alzheimer''s Disease\" OR \"Alzheimer\" OR \"AD\")","phaseRange":["PHASE2","PHASE23","PHASE3"],"statuses":["RECRUITING","ACTIVE_NOT_RECRUITING","ENROLLING_BY_INVITATION","NOT_YET_RECRUITING","COMPLETED"],"updatedWithinDays":365,"geography":null}'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  definition_json = EXCLUDED.definition_json,
  updated_at = NOW();
EOF

docker exec -i alzheimer-postgres psql -U app -d app < /tmp/market_defs.sql
echo "   ✅ Market definitions created"
echo ""

# Verify
echo "4. Verifying setup..."
MARKET_COUNT=$(docker exec alzheimer-postgres psql -U app -d app -tAc "SELECT COUNT(*) FROM market_definitions")
TABLE_COUNT=$(docker exec alzheimer-postgres psql -U app -d app -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")

echo "   Tables: $TABLE_COUNT"
echo "   Markets: $MARKET_COUNT"
echo ""

if [ "$MARKET_COUNT" -ge "1" ] && [ "$TABLE_COUNT" -ge "10" ]; then
    echo "========================================"
    echo "✅ Database Initialized Successfully!"
    echo "========================================"
    echo ""
    echo "Next steps:"
    echo "  1. Start API: pnpm dev:api"
    echo "  2. Start workers: pnpm dev:workers"
    echo "  3. Load data: bash scripts/quick_test_api.sh"
    echo ""
else
    echo "========================================"
    echo "⚠️  Database setup incomplete"
    echo "========================================"
    echo ""
    echo "Please check for errors above."
    echo ""
fi
