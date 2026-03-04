#!/usr/bin/env python3
"""
Simple CSV to Reference Files converter for ClinicalTrials.gov data.
Works without database - creates reference files the legacy HTML tool can use.

Usage: python3 scripts/csv_to_references.py
"""

import csv
import json
import os
from collections import defaultdict

# Configuration
CSV_PATH = 'data/ctg-studies.csv'
OUTPUT_DIR = 'data/generated'

def ensure_output_dir():
    """Create output directory if it doesn't exist."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"✅ Output directory ready: {OUTPUT_DIR}")

def parse_csv():
    """Parse the ClinicalTrials.gov CSV file."""
    if not os.path.exists(CSV_PATH):
        print(f"❌ CSV file not found: {CSV_PATH}")
        print("\nPlease ensure the file is downloaded from ClinicalTrials.gov")
        return None
    
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    print(f"📊 Found {len(rows)} clinical trials")
    return rows

def extract_sponsors(trials):
    """Extract unique sponsors."""
    sponsors = {}
    
    for trial in trials:
        sponsor_name = trial.get('Sponsor', '').strip()
        if sponsor_name:
            sponsor_id = sponsor_name.lower().replace(' ', '_').replace(',', '').replace('.', '')[:50]
            sponsors[sponsor_id] = {
                'id': sponsor_id,
                'name': sponsor_name,
                'trials': []
            }
    
    # Link trials to sponsors
    for trial in trials:
        sponsor_name = trial.get('Sponsor', '').strip()
        if sponsor_name:
            sponsor_id = sponsor_name.lower().replace(' ', '_').replace(',', '').replace('.', '')[:50]
            if sponsor_id in sponsors:
                sponsors[sponsor_id]['trials'].append({
                    'nct_id': trial.get('NCT Number', ''),
                    'title': trial.get('Study Title', ''),
                    'phase': trial.get('Phases', ''),
                    'status': trial.get('Study Status', '')
                })
    
    return list(sponsors.values())

def extract_molecules(trials):
    """Extract intervention/molecule information."""
    molecules = defaultdict(list)
    
    for trial in trials:
        interventions = trial.get('Interventions', '')
        if interventions:
            # Parse interventions (format: "TYPE: Name|TYPE: Name")
            for intervention in interventions.split('|'):
                if ':' in intervention:
                    parts = intervention.split(':', 1)
                    if len(parts) == 2:
                        intervention_type, intervention_name = parts
                        intervention_name = intervention_name.strip()
                        
                        if intervention_type.strip().upper() == 'DRUG':
                            mol_id = intervention_name.lower().replace(' ', '_')[:50]
                            molecules[mol_id].append({
                                'nct_id': trial.get('NCT  Number', ''),
                                'name': intervention_name,
                                'phase': trial.get('Phases', ''),
                                'sponsor': trial.get('Sponsor', '')
                            })
    
    return {k: v for k, v in molecules.items()}

def create_summary_json(trials, sponsors, molecules):
    """Create a summary JSON file with all extracted data."""
    summary = {
        'market': 'Alzheimer\'s Disease Phase II-III-IV',
        'last_updated': 'CSV Import',
        'statistics': {
            'total_trials': len(trials),
            'total_sponsors': len(sponsors),
            'total_drug_interventions': len(molecules)
        },
        'sponsors': sponsors,
        'trials': []
    }
    
    # Add trial summaries
    for trial in trials[:100]:  # Limit to first 100 for JSON size
        summary['trials'].append({
            'nct_id': trial.get('NCT Number', ''),
            'title': trial.get('Study Title', ''),
            'sponsor': trial.get('Sponsor', ''),
            'phase': trial.get('Phases', ''),
            'status': trial.get('Study Status', ''),
            'enrollment': trial.get('Enrollment', ''),
        })
    
    return summary

def main():
    print("=" * 60)
    print("ClinicalTrials.gov CSV to Reference Files")
    print("=" * 60)
    print()
    
    ensure_output_dir()
    
    # Parse CSV
    trials = parse_csv()
    if not trials:
        return
    
    print("\n📥 Extracting data...")
    
    # Extract sponsors
    sponsors = extract_sponsors(trials)
    print(f"   ✅ Found {len(sponsors)} unique sponsors")
    
    # Extract molecules/drugs
    molecules = extract_molecules(trials)
    print(f"   ✅ Found {len(molecules)} drug interventions")
    
    # Create summary JSON
    summary = create_summary_json(trials, sponsors, molecules)
    
    # Write output files
    print("\n💾 Writing output files...")
    
    # Summary JSON
    summary_path = os.path.join(OUTPUT_DIR, 'market_summary.json')
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"   ✅ {summary_path}")
    
    # Sponsors list
    sponsors_path = os.path.join(OUTPUT_DIR, 'sponsors.json')
    with open(sponsors_path, 'w', encoding='utf-8') as f:
        json.dump(sponsors, f, indent=2, ensure_ascii=False)
    print(f"   ✅ {sponsors_path}")
    
    # Trials list (full)
    trials_path = os.path.join(OUTPUT_DIR, 'trials.json')
    trials_export = []
    for trial in trials:
        trials_export.append({
            'nct_id': trial.get('NCT Number', ''),
            'title': trial.get('Study Title', ''),
            'sponsor': trial.get('Sponsor', ''),
            'phase': trial.get('Phases', ''),
            'status': trial.get('Study Status', ''),
            'enrollment': trial.get('Enrollment', ''),
            'locations': trial.get('Locations', ''),
            'interventions': trial.get('Interventions', ''),
        })
    
    with open(trials_path, 'w', encoding='utf-8') as f:
        json.dump(trials_export, f, indent=2, ensure_ascii=False)
    print(f"   ✅ {trials_path}")
    
    print("\n" + "=" * 60)
    print("✨ Complete!")
    print("=" * 60)
    print()
    print(f"📁 Output files in: {OUTPUT_DIR}/")
    print(f"📊 Total trials: {len(trials)}")
    print(f"🏢 Total sponsors: {len(sponsors)}")
    print(f"💊 Drug interventions: {len(molecules)}")
    print()
    print("You can now use these JSON files with the web UI!")
    print()

if __name__ == '__main__':
    main()
