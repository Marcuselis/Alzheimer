#!/usr/bin/env bash
set -euo pipefail

# AACT Database Restore Script
# This script unzips the AACT snapshot and restores it into a Postgres database

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AACT_DIR="$PROJECT_ROOT/data/aact"
EXTRACT_DIR="$AACT_DIR/extracted"
ZIP_FILE="$AACT_DIR/aact_snapshot.zip"

# Database connection settings (customize via env vars)
DB_HOST="${AACT_DB_HOST:-localhost}"
DB_PORT="${AACT_DB_PORT:-5432}"
DB_USER="${AACT_DB_USER:-app}"
DB_NAME="${AACT_DB_NAME:-aact}"
DB_PASSWORD="${AACT_DB_PASSWORD:-app}"

echo "========================================"
echo "AACT Database Restore"
echo "========================================"
echo "Project Root: $PROJECT_ROOT"
echo "AACT Data Dir: $AACT_DIR"
echo "Extract Dir: $EXTRACT_DIR"
echo "DB Host: $DB_HOST:$DB_PORT"
echo "DB Name: $DB_NAME"
echo "DB User: $DB_USER"
echo ""

# Step 1: Check if ZIP file exists
if [ ! -f "$ZIP_FILE" ]; then
    echo "❌ ERROR: AACT snapshot ZIP not found at: $ZIP_FILE"
    echo ""
    echo "Please download the AACT snapshot from:"
    echo "  https://aact.ctti-clinicaltrials.org/downloads/snapshots"
    echo ""
    echo "And place it at: $ZIP_FILE"
    exit 1
fi

echo "✅ Found AACT snapshot ZIP: $ZIP_FILE"
echo ""

# Step 2: Unzip if not already extracted
if [ -d "$EXTRACT_DIR" ] && [ "$(ls -A "$EXTRACT_DIR" 2>/dev/null)" ]; then
    echo "✅ Extract directory already exists and is not empty: $EXTRACT_DIR"
    echo "   Skipping extraction (delete $EXTRACT_DIR to force re-extract)"
else
    echo "📦 Extracting AACT snapshot..."
    rm -rf "$EXTRACT_DIR"
    mkdir -p "$EXTRACT_DIR"
    
    # Unzip to extract directory
    unzip -q "$ZIP_FILE" -d "$EXTRACT_DIR"
    
    echo "✅ Extraction complete"
fi

echo ""

# Step 3: Find the dump file
DUMP_FILE=$(find "$EXTRACT_DIR" -type f \( -name "*.dmp" -o -name "*.dump" -o -name "*.sql" -o -name "*.backup" \) | head -n 1)

if [ -z "$DUMP_FILE" ]; then
    echo "❌ ERROR: Could not find .dmp, .dump, .sql, or .backup file in $EXTRACT_DIR"
    echo ""
    echo "Contents of extract directory:"
    ls -lh "$EXTRACT_DIR"
    exit 1
fi

echo "✅ Found dump file: $DUMP_FILE"
echo ""

# Step 4: Check if database already exists
export PGPASSWORD="$DB_PASSWORD"

if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo "⚠️  Database '$DB_NAME' already exists"
    
    # Check if database has data (idempotency check)
    TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
    
    if [ "$TABLE_COUNT" -gt 0 ]; then
        echo "   Database has $TABLE_COUNT tables - assuming restore already completed"
        echo "   To force re-restore, drop the database first:"
        echo "     dropdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME"
        echo ""
        echo "✅ AACT database ready (existing)"
        exit 0
    else
        echo "   Database is empty - proceeding with restore"
    fi
else
    echo "📊 Creating database '$DB_NAME'..."
    createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
    echo "✅ Database created"
fi

echo ""

# Step 5: Restore the dump
echo "⏳ Restoring AACT dump to database '$DB_NAME'..."
echo "   This may take several minutes..."
echo ""

# Detect dump file type and use appropriate restore command
DUMP_EXTENSION="${DUMP_FILE##*.}"

if [ "$DUMP_EXTENSION" = "sql" ]; then
    # SQL dump - use psql
    echo "   Using psql for .sql dump"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$DUMP_FILE" > /dev/null 2>&1
else
    # Binary dump - use pg_restore
    echo "   Using pg_restore for binary dump"
    pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        --no-owner --no-privileges --verbose \
        "$DUMP_FILE" 2>&1 | grep -E "^(processing|finished|creating)" || true
fi

echo ""
echo "✅ Restore complete!"
echo ""

# Step 6: Verify restore
echo "📊 Verifying restore..."
TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
echo "   Tables found: $TABLE_COUNT"

# Check for key AACT tables
for TABLE in studies sponsors conditions interventions; do
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT to_regclass('public.$TABLE')" | grep -q "$TABLE"; then
        ROW_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM $TABLE" || echo "0")
        echo "   ✅ Table '$TABLE' exists with $ROW_COUNT rows"
    else
        echo "   ⚠️  Table '$TABLE' not found (may use different schema)"
    fi
done

echo ""
echo "========================================"
echo "✅ AACT Database Restore Complete!"
echo "========================================"
echo ""
echo "Connection string:"
echo "  postgresql://$DB_USER:****@$DB_HOST:$DB_PORT/$DB_NAME"
echo ""
echo "Next steps:"
echo "  1. Set AACT_DATABASE_URL env var in .env file"
echo "  2. Run AACT import job: pnpm workers run importAlzheimersFromAACT"
echo ""
