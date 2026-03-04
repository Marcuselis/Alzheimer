import { Trial } from '@app/shared';

export interface TargetProfile {
  canonicalName: string;
  phase: string;
  trials: Trial[];
  activeTrials: Trial[];
  phase3Trials: Trial[];
  medianEnrollment: number;
  endpointMentions: Array<{ keyword: string; count: number }>;
  operationalComplexity: {
    hasPET: boolean;
    hasMRI: boolean;
    hasInfusion: boolean;
    score: number;
  };
  populationKeywords: Record<string, boolean>;
  recentActivity: number;
  sponsor: string;
  cadroCategory?: string;
  mechanismOfAction?: string;
}

export function buildTargetProfile(trials: Trial[], referenceRow?: any): TargetProfile {
  const activeTrials = trials.filter(t => 
    t.status && (t.status.includes('Recruiting') || t.status.includes('Active'))
  );
  
  const phase3Trials = trials.filter(t => 
    t.phase && (t.phase.includes('Phase 3') || t.phase.includes('Phase III'))
  );
  
  const enrollments = trials
    .map(t => t.enrollment || 0)
    .filter(e => e > 0)
    .sort((a, b) => a - b);
  const medianEnrollment = enrollments.length > 0
    ? enrollments[Math.floor(enrollments.length / 2)]
    : 0;
  
  const allOutcomes = [
    ...trials.flatMap(t => t.outcomesPrimaryText || []),
    ...trials.flatMap(t => t.outcomesSecondaryText || [])
  ];
  const endpointKeywords = ['CDR-SB', 'ADAS-Cog', 'ADCS-ADL', 'MMSE'];
  const endpointMentions = endpointKeywords.map(keyword => ({
    keyword,
    count: allOutcomes.filter(o => o && o.includes(keyword)).length
  }));
  
  const allText = [
    ...trials.map(t => t.interventionsText || ''),
    ...trials.map(t => t.eligibilityCriteria || '')
  ].join(' ').toLowerCase();
  
  const hasPET = allText.includes('pet') || allText.includes('positron');
  const hasMRI = allText.includes('mri') || allText.includes('magnetic resonance');
  const hasInfusion = allText.includes('infusion') || allText.includes('iv');
  
  const eighteenMonthsAgo = new Date();
  eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
  const recentTrials = trials.filter(t => {
    if (!t.startDate) return false;
    const start = new Date(t.startDate);
    return start >= eighteenMonthsAgo;
  });
  
  return {
    canonicalName: referenceRow?.canonical_molecule || trials[0]?.interventionsText?.split(',')[0] || 'Unknown',
    phase: referenceRow?.phase_from_cummings || (phase3Trials.length > 0 ? 'Phase III' : 'Phase II'),
    trials,
    activeTrials,
    phase3Trials,
    medianEnrollment,
    endpointMentions,
    operationalComplexity: {
      hasPET,
      hasMRI,
      hasInfusion,
      score: (hasPET ? 1 : 0) + (hasMRI ? 1 : 0) + (hasInfusion ? 1 : 0)
    },
    populationKeywords: {
      mci: allText.includes('mci') || allText.includes('mild cognitive'),
      mild: allText.includes('mild') && !allText.includes('moderate'),
      moderate: allText.includes('moderate'),
      severe: allText.includes('severe')
    },
    recentActivity: recentTrials.length,
    sponsor: trials[0]?.sponsor || referenceRow?.lead_sponsor_from_cummings || '',
    cadroCategory: referenceRow?.cadro_category,
    mechanismOfAction: referenceRow?.mechanism_of_action
  };
}

export function selectPeerSet(targetProfile: TargetProfile, candidateProfiles: TargetProfile[]): TargetProfile[] {
  const targetPhase = targetProfile.phase;
  const isPhase3 = targetPhase.includes('Phase 3') || targetPhase.includes('Phase III');
  
  const peers = candidateProfiles.filter(profile => {
    if (profile.canonicalName === targetProfile.canonicalName) return false;
    if (isPhase3) {
      return profile.phase3Trials.length > 0;
    } else {
      return profile.activeTrials.length > 0;
    }
  });
  
  peers.sort((a, b) => {
    if (isPhase3) {
      return b.phase3Trials.length - a.phase3Trials.length;
    }
    return b.activeTrials.length - a.activeTrials.length;
  });
  
  return peers.slice(0, 10);
}

export function computeBenchmarks(targetProfile: TargetProfile, peers: TargetProfile[]) {
  if (peers.length === 0) {
    return {
      target: {
        activeTrials: targetProfile.activeTrials.length,
        medianEnrollment: targetProfile.medianEnrollment,
        phase3Trials: targetProfile.phase3Trials.length
      },
      medians: {
        activeTrials: 0,
        medianEnrollment: 0,
        phase3Trials: 0
      },
      deltas: {
        activeTrials: 0,
        medianEnrollment: 0,
        phase3Trials: 0
      }
    };
  }
  
  const peerActiveTrials = peers.map(p => p.activeTrials.length).sort((a, b) => a - b);
  const peerEnrollments = peers.map(p => p.medianEnrollment).filter(e => e > 0).sort((a, b) => a - b);
  const peerPhase3Trials = peers.map(p => p.phase3Trials.length).sort((a, b) => a - b);
  
  const medianActiveTrials = peerActiveTrials.length > 0
    ? peerActiveTrials[Math.floor(peerActiveTrials.length / 2)]
    : 0;
  const medianEnrollment = peerEnrollments.length > 0
    ? peerEnrollments[Math.floor(peerEnrollments.length / 2)]
    : 0;
  const medianPhase3Trials = peerPhase3Trials.length > 0
    ? peerPhase3Trials[Math.floor(peerPhase3Trials.length / 2)]
    : 0;
  
  return {
    target: {
      activeTrials: targetProfile.activeTrials.length,
      medianEnrollment: targetProfile.medianEnrollment,
      phase3Trials: targetProfile.phase3Trials.length
    },
    medians: {
      activeTrials: medianActiveTrials,
      medianEnrollment: medianEnrollment,
      phase3Trials: medianPhase3Trials
    },
    deltas: {
      activeTrials: targetProfile.activeTrials.length - medianActiveTrials,
      medianEnrollment: targetProfile.medianEnrollment - medianEnrollment,
      phase3Trials: targetProfile.phase3Trials.length - medianPhase3Trials
    }
  };
}
