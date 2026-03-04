#!/usr/bin/env node
/**
 * Re-fetch location data for all trials, with focus on Nordic countries
 * Nordic countries: Denmark, Finland, Iceland, Norway, Sweden
 */

const { Pool } = require('pg');
const https = require('https');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app';
const pool = new Pool({ connectionString: DATABASE_URL });

const NORDIC_COUNTRIES = ['Denmark', 'Finland', 'Iceland', 'Norway', 'Sweden'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function refetchLocations() {
  try {
    // Get all trials that need location data
    const trialsResult = await pool.query(`
      SELECT t.nct_id, s.name as sponsor_name
      FROM trials t
      JOIN market_trials mt ON t.nct_id = mt.nct_id
      LEFT JOIN sponsors s ON t.sponsor_id = s.id
      WHERE mt.market_id = 'market_alzheimers_phase23'
        AND (
          t.detail_json->'locations' IS NULL 
          OR jsonb_array_length(t.detail_json->'locations') = 0
        )
      ORDER BY t.sponsor_id, t.nct_id
    `);

    console.log(`\n🔍 Found ${trialsResult.rows.length} trials needing location data\n`);

    let totalProcessed = 0;
    let totalLocations = 0;
    let trialsWithNordic = 0;
    let nordicLocations = 0;

    for (const trial of trialsResult.rows) {
      const nctId = trial.nct_id;
      const sponsorName = trial.sponsor_name || 'Unknown';

      try {
        console.log(`📍 Fetching ${nctId} (${sponsorName})...`);
        
        const url = `https://clinicaltrials.gov/api/v2/studies/${nctId}`;
        const studyData = await httpsGet(url);
        
        const contactsLocationsModule = studyData.protocolSection?.contactsLocationsModule || {};
        const locations = (contactsLocationsModule.locations || []).map(loc => ({
          facility: loc.facility || '',
          city: loc.city || '',
          state: loc.state || '',
          zip: loc.zip || '',
          country: loc.country || '',
          status: loc.status || '',
          geoPoint: loc.geoPoint || null,
        }));

        // Count Nordic locations
        const nordicLocs = locations.filter(loc => 
          NORDIC_COUNTRIES.includes(loc.country)
        );

        console.log(`  ✓ Found ${locations.length} locations`);
        if (nordicLocs.length > 0) {
          console.log(`  🇩🇰🇫🇮🇮🇸🇳🇴🇸🇪 NORDIC: ${nordicLocs.length} sites in ${[...new Set(nordicLocs.map(l => l.country))].join(', ')}`);
          trialsWithNordic++;
          nordicLocations += nordicLocs.length;
        }

        // Update database
        await pool.query(`
          UPDATE trials
          SET detail_json = jsonb_set(
            COALESCE(detail_json, '{}'::jsonb),
            '{locations}',
            $1::jsonb
          ),
          detail_fetched_at = NOW()
          WHERE nct_id = $2
        `, [JSON.stringify(locations), nctId]);

        totalProcessed++;
        totalLocations += locations.length;

        // Rate limiting: be polite to CT.gov (10 requests/second max)
        await sleep(150);

      } catch (error) {
        console.error(`  ✗ Error fetching ${nctId}:`, error.message);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ LOCATION FETCH COMPLETE');
    console.log('='.repeat(60));
    console.log(`Trials processed: ${totalProcessed}`);
    console.log(`Total locations: ${totalLocations}`);
    console.log(`Trials with Nordic sites: ${trialsWithNordic}`);
    console.log(`Total Nordic locations: ${nordicLocations}`);
    console.log('='.repeat(60) + '\n');

    // Show Nordic country breakdown
    console.log('🇩🇰🇫🇮🇮🇸🇳🇴🇸🇪 NORDIC COUNTRY BREAKDOWN:\n');
    
    const nordicBreakdown = await pool.query(`
      SELECT 
        loc->>'country' as country,
        COUNT(DISTINCT t.nct_id) as trial_count,
        COUNT(*) as site_count
      FROM trials t
      JOIN market_trials mt ON t.nct_id = mt.nct_id
      CROSS JOIN jsonb_array_elements(t.detail_json->'locations') as loc
      WHERE mt.market_id = 'market_alzheimers_phase23'
        AND loc->>'country' IN ('Denmark', 'Finland', 'Iceland', 'Norway', 'Sweden')
      GROUP BY loc->>'country'
      ORDER BY trial_count DESC
    `);

    for (const row of nordicBreakdown.rows) {
      console.log(`  ${row.country}: ${row.trial_count} trials, ${row.site_count} sites`);
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

refetchLocations();
