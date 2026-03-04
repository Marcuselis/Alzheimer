import { Pool } from 'pg';
import { searchTrialsByMolecule } from '../sources/clinicaltrials';
import { searchLiterature } from '../sources/pubmed';
import { buildTargetProfile, selectPeerSet, computeBenchmarks } from '../enrich/benchmark';
import { computePressureScore } from '../enrich/pressureScore';
import { computeTopRisks, generateWhyCallSummary } from '../enrich/risks';
import { computeTAM } from '../enrich/tam';
import { ProgramSummary, SourceStatus } from '@app/shared';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

export async function refreshProgram(params: {
  sponsorId?: string;
  programId?: string;
  sponsorName?: string;
  moleculeName?: string;
}): Promise<{ status: string; sourcesStatus: SourceStatus }> {
  const { sponsorId, programId, sponsorName, moleculeName } = params;
  
  const sourcesStatus: SourceStatus = {
    ctgov: 'pending',
    pubmed: 'pending',
    websignals: 'skipped',
  };
  
  try {
    // Get program info
    let program: any;
    if (programId) {
      const result = await db.query('SELECT * FROM programs WHERE id = $1', [programId]);
      program = result.rows[0];
    } else if (sponsorName && moleculeName) {
      // Find or create sponsor and program
      let sponsorResult = await db.query('SELECT id FROM sponsors WHERE name = $1', [sponsorName]);
      let sponsorIdActual = sponsorResult.rows[0]?.id;
      
      if (!sponsorIdActual) {
        sponsorIdActual = `sponsor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.query('INSERT INTO sponsors (id, name) VALUES ($1, $2)', [sponsorIdActual, sponsorName]);
      }
      
      let programResult = await db.query(
        'SELECT * FROM programs WHERE sponsor_id = $1 AND molecule = $2',
        [sponsorIdActual, moleculeName]
      );
      program = programResult.rows[0];
      
      if (!program) {
        const programIdActual = `program_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.query(
          'INSERT INTO programs (id, sponsor_id, molecule, indication, phase) VALUES ($1, $2, $3, $4, $5)',
          [programIdActual, sponsorIdActual, moleculeName, "Alzheimer's", 'Phase II-III']
        );
        programResult = await db.query('SELECT * FROM programs WHERE id = $1', [programIdActual]);
        program = programResult.rows[0];
      }
    } else {
      throw new Error('Must provide programId or (sponsorName + moleculeName)');
    }
    
    // 1. Fetch CT.gov trials
    let trials = [];
    try {
      trials = await searchTrialsByMolecule(program.molecule);
      sourcesStatus.ctgov = 'ok';
      
      // Store trials
      for (const trial of trials) {
        await db.query(`
          INSERT INTO trials (id, program_id, nct_id, payload_json)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (nct_id) DO UPDATE SET payload_json = $4, updated_at = NOW()
        `, [
          `trial_${trial.nctId}`,
          program.id,
          trial.nctId,
          JSON.stringify(trial)
        ]);
      }
    } catch (error) {
      console.error('[Refresh] CT.gov error:', error);
      sourcesStatus.ctgov = 'error';
    }
    
    // 2. Fetch PubMed papers
    let papers = [];
    try {
      papers = await searchLiterature(program.molecule, [], { maxResults: 200 });
      sourcesStatus.pubmed = 'ok';
      
      // Store papers
      for (const paper of papers) {
        await db.query(`
          INSERT INTO papers (id, program_id, pmid, payload_json)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (pmid) DO UPDATE SET payload_json = $4, updated_at = NOW()
        `, [
          `paper_${paper.pmid}`,
          program.id,
          paper.pmid,
          JSON.stringify(paper)
        ]);
      }
    } catch (error) {
      console.error('[Refresh] PubMed error:', error);
      sourcesStatus.pubmed = 'error';
    }
    
    // 3. Compute enrichments
    if (trials.length > 0) {
      const profile = buildTargetProfile(trials);
      const candidateProfiles = [profile]; // In full version, load from other programs
      const peers = selectPeerSet(profile, candidateProfiles);
      const benchmarks = computeBenchmarks(profile, peers);
      const pressureScore = computePressureScore(profile, benchmarks);
      const risks = computeTopRisks(profile, peers, benchmarks);
      const whyCall = generateWhyCallSummary(profile, peers, risks);
      
      // Get sponsor name
      const sponsorResult = await db.query('SELECT name FROM sponsors WHERE id = $1', [program.sponsor_id]);
      const sponsorName = sponsorResult.rows[0]?.name || 'Unknown';
      
      // Create summary
      const summary: ProgramSummary = {
        sponsorName,
        programName: program.molecule,
        indication: program.indication,
        phase: program.phase || profile.phase,
        pressureScore,
        peerCrowding: {
          phase3Peers: peers.filter(p => p.phase3Trials.length > 0).length,
          activePeers: peers.filter(p => p.activeTrials.length > 0).length,
        },
        topRisks: risks,
        whyCallSummary: whyCall,
        lastUpdatedISO: new Date().toISOString(),
        sourcesStatus,
      };
      
      // Store snapshot
      const snapshotId = `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.query(`
        INSERT INTO program_snapshots (id, program_id, payload_json)
        VALUES ($1, $2, $3)
      `, [snapshotId, program.id, JSON.stringify(summary)]);
      
      console.log(`[Refresh] Completed for program ${program.id}`);
    }
    
    return { status: 'completed', sourcesStatus };
  } catch (error) {
    console.error('[Refresh] Error:', error);
    return { status: 'error', sourcesStatus };
  }
}
