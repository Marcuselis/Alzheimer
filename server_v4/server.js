const express = require('express');
const cors = require('cors');
const { getDB, closeDB } = require('./db');
const Cache = require('./cache');
const ctgov = require('./sources/clinicaltrials');
const pubmed = require('./sources/pubmed');
const websignals = require('./sources/websignals');
const {
    buildTargetProfile,
    selectPeerSet,
    computeBenchmarks,
    computePressureScore,
    computeTopRisks,
    generateWhyCallSummary,
    computeEvidenceStrength,
    computeTAM,
    compileBrief
} = require('./enrich/benchmarks');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '4.0.0', timestamp: new Date().toISOString() });
});

// Search molecule
app.get('/api/search/molecule', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" required' });
        }
        
        console.log(`[API] Search molecule: ${q}`);
        const trials = await ctgov.searchTrialsByMolecule(q);
        
        res.json({
            molecule: q,
            trials,
            count: trials.length,
            source: 'ClinicalTrials.gov',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[API] Error searching molecule:', error);
        res.status(500).json({ error: error.message, source: 'ClinicalTrials.gov' });
    }
});

// Search sponsor
app.get('/api/search/sponsor', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Query parameter "q" required' });
        }
        
        console.log(`[API] Search sponsor: ${q}`);
        const trials = await ctgov.searchTrialsBySponsor(q);
        
        res.json({
            sponsor: q,
            trials,
            count: trials.length,
            source: 'ClinicalTrials.gov',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[API] Error searching sponsor:', error);
        res.status(500).json({ error: error.message, source: 'ClinicalTrials.gov' });
    }
});

// Get sponsor summary (with enrichment)
app.get('/api/sponsor/:id/summary', async (req, res) => {
    try {
        const sponsorName = decodeURIComponent(req.params.id);
        console.log(`[API] Get sponsor summary: ${sponsorName}`);
        
        // Fetch trials
        const trials = await ctgov.searchTrialsBySponsor(sponsorName);
        
        if (trials.length === 0) {
            return res.json({
                sponsor: sponsorName,
                trials: [],
                profile: null,
                benchmarks: null,
                pressureScore: 0,
                risks: [],
                whyCall: `No trials found for ${sponsorName}`,
                sourceStatus: {
                    ctgov: 'OK',
                    pubmed: 'SKIPPED',
                    websignals: 'SKIPPED'
                }
            });
        }
        
        // Build profile
        const profile = buildTargetProfile(trials);
        
        // For MVP, we'll use a simplified peer set (could be enhanced with reference data)
        const candidateProfiles = [profile]; // In full version, load from reference CSV
        const peers = selectPeerSet(profile, candidateProfiles);
        const benchmarks = computeBenchmarks(profile, peers);
        const pressureScore = computePressureScore(profile, benchmarks);
        const risks = computeTopRisks(profile, peers, benchmarks);
        const whyCall = generateWhyCallSummary(profile, peers, risks);
        const evidenceStrength = computeEvidenceStrength(profile);
        
        res.json({
            sponsor: sponsorName,
            trials,
            profile,
            peers,
            benchmarks,
            pressureScore,
            risks,
            whyCall,
            evidenceStrength,
            sourceStatus: {
                ctgov: 'OK',
                pubmed: 'SKIPPED',
                websignals: 'SKIPPED'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[API] Error getting sponsor summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// Refresh data for sponsor/program
app.post('/api/refresh', async (req, res) => {
    try {
        const { sponsorName, moleculeName, indication = 'Alzheimer', phaseRange } = req.body;
        
        if (!sponsorName && !moleculeName) {
            return res.status(400).json({ error: 'sponsorName or moleculeName required' });
        }
        
        console.log(`[API] Refresh data: sponsor=${sponsorName}, molecule=${moleculeName}`);
        
        const sourceStatus = {
            ctgov: 'PENDING',
            pubmed: 'PENDING',
            websignals: 'PENDING'
        };
        
        let trials = [];
        let profile = null;
        let literature = [];
        let webSignals = [];
        
        // 1. ClinicalTrials.gov
        try {
            if (moleculeName) {
                trials = await ctgov.searchTrialsByMolecule(moleculeName);
            } else if (sponsorName) {
                trials = await ctgov.searchTrialsBySponsor(sponsorName);
            }
            sourceStatus.ctgov = 'OK';
        } catch (error) {
            console.error('[API] CT.gov error:', error);
            sourceStatus.ctgov = 'ERROR';
        }
        
        // 2. PubMed
        try {
            if (moleculeName) {
                literature = await pubmed.searchLiterature(moleculeName, [], {
                    recencyDays: 365,
                    maxResults: 200
                });
                sourceStatus.pubmed = 'OK';
            } else {
                sourceStatus.pubmed = 'SKIPPED';
            }
        } catch (error) {
            console.error('[API] PubMed error:', error);
            sourceStatus.pubmed = 'ERROR';
        }
        
        // 3. Web signals
        try {
            if (sponsorName && moleculeName) {
                webSignals = await websignals.searchWebSignals(sponsorName, moleculeName);
                sourceStatus.websignals = 'OK';
            } else {
                sourceStatus.websignals = 'SKIPPED';
            }
        } catch (error) {
            console.error('[API] Web signals error:', error);
            sourceStatus.websignals = 'ERROR';
        }
        
        // Build profile and enrichments
        if (trials.length > 0) {
            profile = buildTargetProfile(trials);
            const candidateProfiles = [profile];
            const peers = selectPeerSet(profile, candidateProfiles);
            const benchmarks = computeBenchmarks(profile, peers);
            const pressureScore = computePressureScore(profile, benchmarks);
            const risks = computeTopRisks(profile, peers, benchmarks);
            const whyCall = generateWhyCallSummary(profile, peers, risks);
            const evidenceStrength = computeEvidenceStrength(profile);
            
            res.json({
                sponsorName,
                moleculeName,
                trials,
                profile,
                peers,
                benchmarks,
                pressureScore,
                risks,
                whyCall,
                evidenceStrength,
                literature,
                webSignals,
                sourceStatus,
                timestamp: new Date().toISOString()
            });
        } else {
            res.json({
                sponsorName,
                moleculeName,
                trials: [],
                profile: null,
                literature,
                webSignals,
                sourceStatus,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('[API] Error refreshing data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Generate brief
app.post('/api/brief', async (req, res) => {
    try {
        const { sponsorName, moleculeName, programName, tamAssumptions, pitch } = req.body;
        
        if (!sponsorName || !moleculeName) {
            return res.status(400).json({ error: 'sponsorName and moleculeName required' });
        }
        
        console.log(`[API] Generate brief: ${sponsorName} / ${moleculeName}`);
        
        // Fetch all data
        const trials = await ctgov.searchTrialsByMolecule(moleculeName);
        const literature = await pubmed.searchLiterature(moleculeName, [], { maxResults: 200 });
        
        if (trials.length === 0) {
            return res.status(404).json({ error: 'No trials found for molecule' });
        }
        
        // Build profile and enrichments
        const profile = buildTargetProfile(trials);
        const candidateProfiles = [profile];
        const peers = selectPeerSet(profile, candidateProfiles);
        const benchmarks = computeBenchmarks(profile, peers);
        const pressureScore = computePressureScore(profile, benchmarks);
        const risks = computeTopRisks(profile, peers, benchmarks);
        const whyCall = generateWhyCallSummary(profile, peers, risks);
        const evidenceStrength = computeEvidenceStrength(profile);
        
        // TAM
        const tam = tamAssumptions ? computeTAM(tamAssumptions) : null;
        
        // Compile brief
        const brief = compileBrief(
            profile,
            peers,
            benchmarks,
            pressureScore,
            risks,
            whyCall,
            tam,
            evidenceStrength,
            literature,
            pitch
        );
        
        // Save to database
        const db = getDB();
        const briefId = `brief_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        db.prepare(`
            INSERT INTO briefs (id, sponsor_name, program_name, created_at, payload_json)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            briefId,
            sponsorName,
            programName || moleculeName,
            Math.floor(Date.now() / 1000),
            JSON.stringify(brief)
        );
        
        res.json({
            id: briefId,
            sponsorName,
            programName: programName || moleculeName,
            brief,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[API] Error generating brief:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get brief by ID
app.get('/api/brief/:id', (req, res) => {
    try {
        const db = getDB();
        const row = db.prepare('SELECT * FROM briefs WHERE id = ?').get(req.params.id);
        
        if (!row) {
            return res.status(404).json({ error: 'Brief not found' });
        }
        
        res.json({
            id: row.id,
            sponsorName: row.sponsor_name,
            programName: row.program_name,
            createdAt: new Date(row.created_at * 1000).toISOString(),
            brief: JSON.parse(row.payload_json)
        });
    } catch (error) {
        console.error('[API] Error getting brief:', error);
        res.status(500).json({ error: error.message });
    }
});

// List briefs
app.get('/api/briefs', (req, res) => {
    try {
        const db = getDB();
        const rows = db.prepare('SELECT id, sponsor_name, program_name, created_at FROM briefs ORDER BY created_at DESC LIMIT 100').all();
        
        res.json({
            briefs: rows.map(row => ({
                id: row.id,
                sponsorName: row.sponsor_name,
                programName: row.program_name,
                createdAt: new Date(row.created_at * 1000).toISOString()
            }))
        });
    } catch (error) {
        console.error('[API] Error listing briefs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`[Server] V4 Analyst Workstation backend running on port ${PORT}`);
    console.log(`[Server] Health check: http://localhost:${PORT}/health`);
    
    // Clear expired cache entries on startup
    Cache.clearExpired();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    closeDB();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[Server] Shutting down...');
    closeDB();
    process.exit(0);
});
