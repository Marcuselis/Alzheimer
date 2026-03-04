#!/usr/bin/env python3
"""
Import ClinicalTrials.gov CSV directly into Postgres database.
No API/Workers needed - just Docker running Postgres.

Usage:
    python3 scripts/import_csv_to_db.py [csv_file_path]

Example:
    python3 scripts/import_csv_to_db.py data/ctg-studies.csv
"""

import csv
import sys
import os
from pathlib import Path

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("❌ psycopg2 not installed. Install with:")
    print("   pip install psycopg2-binary")
    sys.exit(1)

# Configuration
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://app:app@localhost:5432/app')
DEFAULT_CSV_PATH = 'data/ctg-studies.csv'
MARKET_ID = 'market_alzheimers_phase23'

def connect_db():
    """Connect to Postgres database."""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        print("\nMake sure Docker/Postgres is running:")
        print("   pnpm dev:docker")
        print("\nThen wait 10 seconds for Postgres to be ready.")
        sys.exit(1)

def create_tables(conn):
    """Create necessary tables if they don't exist."""
    cursor = conn.cursor()
    
    # Create sponsors table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sponsors (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            normalized_name TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );
    """)
    
    # Create trials table  
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS trials (
            nct_id TEXT PRIMARY KEY,
            title TEXT,
            status TEXT,
            phase TEXT,
            sponsor_id TEXT REFERENCES sponsors(id),
            enrollment INTEGER,
            start_date DATE,
            completion_date DATE,
            conditions TEXT[],
            interventions TEXT,
            locations JSONB,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    """)
    
    # Create market trials mapping
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS market_trials (
            market_id TEXT,
            trial_id TEXT REFERENCES trials(nct_id),
            added_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (market_id, trial_id)
        );
    """)
    
    # Create market state table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS market_state (
            market_id TEXT PRIMARY KEY,
            last_refreshed TIMESTAMP,
            trial_count INTEGER DEFAULT 0,
            sponsor_count INTEGER DEFAULT 0
        );
    """)
    
    conn.commit()
    print("✅ Tables created/verified")

def normalize_sponsor_name(name):
    """Normalize sponsor name for ID generation."""
    if not name:
        return "unknown"
    # Remove special characters and spaces
    normalized = ''.join(c if c.isalnum() else '_' for c in str(name).lower())
    # Remove consecutive underscores
    while '__' in normalized:
        normalized = normalized.replace('__', '_')
    return normalized[:50]

def parse_enrollment(value):
    """Parse enrollment value to integer."""
    if not value:
        return None
    try:
        # Remove commas and convert to int
        return int(str(value).replace(',', '').strip())
    except (ValueError, AttributeError):
        return None

def import_csv(csv_path, market_id):
    """Import trials from CSV into database."""
    if not os.path.exists(csv_path):
        print(f"❌ CSV file not found: {csv_path}")
        print("\n📥 Please download CSV from ClinicalTrials.gov:")
        print("   1. Go to: https://clinicaltrials.gov/search?cond=Alzheimer%20Disease...")
        print("   2. Click 'More' button")
        print("   3. Select 'Download' -> CSV format")
        print(f"   4. Save as: {csv_path}")
        sys.exit(1)
    
    conn = connect_db()
    create_tables(conn)
    cursor = conn.cursor()
    
    print(f"\n📁 Reading CSV: {csv_path}")
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    if not rows:
        print("❌ CSV file is empty!")
        sys.exit(1)
    
    print(f"📊 Found {len(rows)} trials in CSV")
    print(f"   Columns: {', '.join(reader.fieldnames[:5])}...")
    
    sponsors_added = 0
    trials_added = 0
    trials_updated = 0
    unique_sponsors = set()
    
    for i, row in enumerate(rows, 1):
        if i % 50 == 0:
            print(f"   Processing {i}/{len(rows)}...")
        
        # Try different possible column names from CT.gov CSV
        nct_id = (row.get('NCT Number') or row.get('nct_id') or 
                 row.get('NCT_Number') or row.get('Study') or '').strip()
        
        title = (row.get('Title') or row.get('title') or 
                row.get('Official Title') or '').strip()
        
        status = (row.get('Status') or row.get('status') or 
                 row.get('Overall Status') or '').strip()
        
        phase = (row.get('Phase') or row.get('phase') or 
                row.get('Phases') or row.get('Study Phase') or '').strip()
        
        sponsor_name = (row.get('Sponsor') or row.get('Lead Sponsor') or 
                       row.get('sponsor') or row.get('Sponsor/Collaborators') or 
                       'Unknown Sponsor').strip()
        
        enrollment = parse_enrollment(row.get('Enrollment') or row.get('enrollment'))
        
        if not nct_id or not nct_id.startswith('NCT'):
            continue  # Skip rows without valid NCT ID
        
        # Handle sponsor
        sponsor_id = f"sponsor_{normalize_sponsor_name(sponsor_name)}"
        unique_sponsors.add(sponsor_id)
        
        cursor.execute("""
            INSERT INTO sponsors (id, name, normalized_name)
            VALUES (%s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        """, (sponsor_id, sponsor_name, normalize_sponsor_name(sponsor_name)))
        
        if cursor.rowcount > 0:
            sponsors_added += 1
        
        # Insert/update trial
        cursor.execute("""
            INSERT INTO trials (
                nct_id, title, status, phase, sponsor_id, enrollment,
                updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (nct_id) DO UPDATE SET
                title = EXCLUDED.title,
                status = EXCLUDED.status,
                phase = EXCLUDED.phase,
                sponsor_id = EXCLUDED.sponsor_id,
                enrollment = EXCLUDED.enrollment,
                updated_at = NOW()
            RETURNING (xmax = 0) AS inserted
        """, (nct_id, title, status, phase, sponsor_id, enrollment))
        
        was_inserted = cursor.fetchone()[0]
        if was_inserted:
            trials_added += 1
        else:
            trials_updated += 1
        
        # Link to market
        cursor.execute("""
            INSERT INTO market_trials (market_id, trial_id)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING
        """, (market_id, nct_id))
    
    # Update market state
    cursor.execute("""
        INSERT INTO market_state (market_id, last_refreshed, trial_count, sponsor_count)
        VALUES (%s, NOW(), %s, %s)
        ON CONFLICT (market_id) DO UPDATE SET
            last_refreshed = NOW(),
            trial_count = EXCLUDED.trial_count,
            sponsor_count = EXCLUDED.sponsor_count
    """, (market_id, trials_added + trials_updated, len(unique_sponsors)))
    
    conn.commit()
    conn.close()
    
    print("\n✅ Import Complete!")
    print(f"   Unique sponsors: {len(unique_sponsors)}")
    print(f"   Trials added: {trials_added}")
    print(f"   Trials updated: {trials_updated}")
    print(f"   Total trials in market '{market_id}': {trials_added + trials_updated}")
    print(f"\n🚀 Ready to use! Start web UI:")
    print(f"   pnpm dev:web")
    print(f"   Then open: http://localhost:3000/market-scan")

if __name__ == '__main__':
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV_PATH
    
    print("=" * 60)
    print("ClinicalTrials.gov CSV Import Tool")
    print("=" * 60)
    
    import_csv(csv_path, MARKET_ID)
