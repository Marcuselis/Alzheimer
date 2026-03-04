/**
 * Enrichment and scoring functions for analyst workstation
 */

/**
 * Build target profile from trials
 */
function buildTargetProfile(trials, referenceRow = null) {
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
    
    // Extract endpoints
    const allOutcomes = [
        ...trials.flatMap(t => (t.outcomesPrimaryText || [])),
        ...trials.flatMap(t => (t.outcomesSecondaryText || []))
    ];
    const endpointKeywords = ['CDR-SB', 'ADAS-Cog', 'ADCS-ADL', 'MMSE'];
    const endpointMentions = endpointKeywords.map(keyword => ({
        keyword,
        count: allOutcomes.filter(o => o && o.includes(keyword)).length
    }));
    
    // Operational complexity
    const allText = [
        ...trials.map(t => t.interventionsText || ''),
        ...trials.map(t => t.eligibilityCriteria || '')
    ].join(' ').toLowerCase();
    
    const hasPET = allText.includes('pet') || allText.includes('positron');
    const hasMRI = allText.includes('mri') || allText.includes('magnetic resonance');
    const hasInfusion = allText.includes('infusion') || allText.includes('iv');
    
    // Population/stage keywords
    const populationKeywords = {
        mci: allText.includes('mci') || allText.includes('mild cognitive'),
        mild: allText.includes('mild') && !allText.includes('moderate'),
        moderate: allText.includes('moderate'),
        severe: allText.includes('severe')
    };
    
    // Recent activity (last 18 months)
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
        trials: trials,
        activeTrials: activeTrials,
        phase3Trials: phase3Trials,
        medianEnrollment,
        endpointMentions,
        operationalComplexity: {
            hasPET,
            hasMRI,
            hasInfusion,
            score: (hasPET ? 1 : 0) + (hasMRI ? 1 : 0) + (hasInfusion ? 1 : 0)
        },
        populationKeywords,
        recentActivity: recentTrials.length,
        sponsor: trials[0]?.sponsor || referenceRow?.lead_sponsor_from_cummings || '',
        cadroCategory: referenceRow?.cadro_category || '',
        mechanismOfAction: referenceRow?.mechanism_of_action || ''
    };
}

/**
 * Select peer set from candidate profiles
 */
function selectPeerSet(targetProfile, candidateProfiles) {
    // Filter peers: same indication (Alzheimer's), similar phase
    const targetPhase = targetProfile.phase;
    const isPhase3 = targetPhase.includes('Phase 3') || targetPhase.includes('Phase III');
    
    const peers = candidateProfiles.filter(profile => {
        // Exclude self
        if (profile.canonicalName === targetProfile.canonicalName) return false;
        
        // Phase match: Phase 3 peers for Phase 3 targets, Phase 2+ for others
        if (isPhase3) {
            return profile.phase3Trials.length > 0;
        } else {
            return profile.activeTrials.length > 0;
        }
    });
    
    // Sort by relevance (active trials, phase match)
    peers.sort((a, b) => {
        if (isPhase3) {
            return b.phase3Trials.length - a.phase3Trials.length;
        }
        return b.activeTrials.length - a.activeTrials.length;
    });
    
    // Return top 10
    return peers.slice(0, 10);
}

/**
 * Compute benchmarks (medians, deltas)
 */
function computeBenchmarks(targetProfile, peers) {
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

/**
 * Compute pressure score (0-100)
 */
function computePressureScore(targetProfile, peerBenchmarks) {
    let score = 0;
    
    // +25 if program phase includes III
    if (targetProfile.phase.includes('Phase 3') || targetProfile.phase.includes('Phase III')) {
        score += 25;
    }
    
    // +15 if active trials >= 2
    if (targetProfile.activeTrials.length >= 2) {
        score += 15;
    }
    
    // +15 if median enrollment > peer median
    if (targetProfile.medianEnrollment > (peerBenchmarks.medians.medianEnrollment || 0)) {
        score += 15;
    }
    
    // +15 if peer crowding (phase3ThreatsCount >= 5)
    const phase3ThreatsCount = peerBenchmarks.medians.phase3Trials || 0;
    if (phase3ThreatsCount >= 5) {
        score += 15;
    }
    
    // +10 if high operational complexity
    if (targetProfile.operationalComplexity.score >= 2) {
        score += 10;
    }
    
    // +10 if recent activity (start date within last 18 months)
    if (targetProfile.recentActivity > 0) {
        score += 10;
    }
    
    return Math.min(100, Math.max(0, score));
}

/**
 * Compute top risks (3 items)
 */
function computeTopRisks(targetProfile, peers, benchmarks) {
    const risks = [];
    
    // Enrollment gap vs peer median
    if (targetProfile.medianEnrollment > 0 && benchmarks.medians.medianEnrollment > 0) {
        const gap = benchmarks.medians.medianEnrollment - targetProfile.medianEnrollment;
        if (gap > 50) {
            risks.push({
                id: 'enrollment_gap',
                title: 'Enrollment Gap',
                severity: gap > 200 ? 'red' : 'yellow',
                implication: `Median enrollment (${targetProfile.medianEnrollment}) is ${gap.toFixed(0)} below peer median (${benchmarks.medians.medianEnrollment.toFixed(0)}). May indicate recruitment challenges.`,
                evidenceLinkCount: targetProfile.activeTrials.length
            });
        }
    }
    
    // Endpoint mismatch
    const commonEndpoints = ['CDR-SB', 'ADAS-Cog'];
    const targetHasCommon = targetProfile.endpointMentions.some(e => 
        commonEndpoints.includes(e.keyword) && e.count > 0
    );
    if (!targetHasCommon && peers.length > 0) {
        risks.push({
            id: 'endpoint_mismatch',
            title: 'Endpoint Mismatch',
            severity: 'yellow',
            implication: 'Primary endpoints may differ from common peer endpoints (CDR-SB, ADAS-Cog). Consider comparability for regulatory review.',
            evidenceLinkCount: targetProfile.trials.length
        });
    }
    
    // Operational complexity high
    if (targetProfile.operationalComplexity.score >= 2) {
        risks.push({
            id: 'operational_complexity',
            title: 'High Operational Complexity',
            severity: 'yellow',
            implication: `Complex monitoring requirements (PET: ${targetProfile.operationalComplexity.hasPET}, MRI: ${targetProfile.operationalComplexity.hasMRI}, Infusion: ${targetProfile.operationalComplexity.hasInfusion}) may increase site burden and enrollment time.`,
            evidenceLinkCount: targetProfile.activeTrials.length
        });
    }
    
    // Late timeline vs peers
    const peerRecentActivity = peers.map(p => p.recentActivity).filter(a => a > 0);
    if (peerRecentActivity.length > 0) {
        const peerMedianRecent = peerRecentActivity.sort((a, b) => a - b)[Math.floor(peerRecentActivity.length / 2)];
        if (targetProfile.recentActivity < peerMedianRecent) {
            risks.push({
                id: 'late_timeline',
                title: 'Late Timeline vs Peers',
                severity: 'yellow',
                implication: `Fewer recent trial starts (${targetProfile.recentActivity}) compared to peer median (${peerMedianRecent}). May indicate delayed program progression.`,
                evidenceLinkCount: targetProfile.trials.length
            });
        }
    }
    
    // Sort by severity (red > yellow > green) and return top 3
    const severityOrder = { red: 3, yellow: 2, green: 1 };
    risks.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
    
    return risks.slice(0, 3);
}

/**
 * Generate "Why call them" summary
 */
function generateWhyCallSummary(targetProfile, peers, risks) {
    const sponsor = targetProfile.sponsor || 'This sponsor';
    const phase = targetProfile.phase;
    const peerCrowding = peers.length >= 5 ? 'high peer crowding' : 'moderate peer activity';
    const topRisk1 = risks.length > 0 ? risks[0].title.toLowerCase() : 'competitive pressure';
    const leadWith = targetProfile.operationalComplexity.score >= 2
        ? 'operational complexity support'
        : 'competitive monitoring';
    
    return `${sponsor} is running ${phase} Alzheimer's trials with ${peerCrowding} and ${topRisk1}. This creates urgency to improve visibility and reduce execution risk. Lead with ${leadWith}.`;
}

/**
 * Compute evidence strength score
 */
function computeEvidenceStrength(targetProfile) {
    let score = 0;
    
    // +2 per Phase III trial
    score += targetProfile.phase3Trials.length * 2;
    
    // +1 per Phase II trial
    const phase2Trials = targetProfile.trials.filter(t => 
        t.phase && (t.phase.includes('Phase 2') || t.phase.includes('Phase II'))
    );
    score += phase2Trials.length;
    
    // +1 if primary endpoint matches common set
    const commonEndpoints = ['CDR-SB', 'ADAS-Cog'];
    const hasCommon = targetProfile.endpointMentions.some(e => 
        commonEndpoints.includes(e.keyword) && e.count > 0
    );
    if (hasCommon) score += 1;
    
    // -1 if high mismatch flags
    const mismatchFlags = targetProfile.endpointMentions.filter(e => 
        !commonEndpoints.includes(e.keyword) && e.count > 0
    ).length;
    if (mismatchFlags > 2) score -= 1;
    
    // Classify
    if (score >= 5) return { score, level: 'High' };
    if (score >= 2) return { score, level: 'Medium' };
    return { score, level: 'Low' };
}

/**
 * Compute TAM model
 */
function computeTAM(assumptions) {
    const {
        eligiblePatients = 6000000, // US + EU estimate
        annualPrice = 50000,
        dxRate = 0.3, // 30% diagnosed
        peakPenetration = 0.15, // 15% of diagnosed
        discontinuation = 0.1, // 10% discontinue
        timeToPeakYears = 5,
        geographyMultiplier = 1.0
    } = assumptions;
    
    // TAM = eligible patients * dx rate * peak penetration * annual price * geography
    const tam = eligiblePatients * dxRate * peakPenetration * annualPrice * geographyMultiplier;
    
    // SAM = assume 50% of TAM is addressable in first 5 years
    const sam = tam * 0.5;
    
    // SOM = assume 10% market share
    const som = sam * 0.1;
    
    // Ranges
    const low = tam * 0.7;
    const high = tam * 1.3;
    
    // Model confidence
    const requiredFields = ['eligiblePatients', 'annualPrice', 'dxRate', 'peakPenetration'];
    const userSetFields = requiredFields.filter(f => assumptions[f] !== undefined);
    let confidence = 'low';
    if (userSetFields.length === requiredFields.length) confidence = 'high';
    else if (userSetFields.length >= 2) confidence = 'medium';
    
    // Sensitivity table
    const sensitivity = [
        {
            variable: 'eligiblePatients',
            base: eligiblePatients,
            lowImpact: tam * 0.8 - tam,
            highImpact: tam * 1.2 - tam
        },
        {
            variable: 'annualPrice',
            base: annualPrice,
            lowImpact: (eligiblePatients * dxRate * peakPenetration * annualPrice * 0.8 * geographyMultiplier) - tam,
            highImpact: (eligiblePatients * dxRate * peakPenetration * annualPrice * 1.2 * geographyMultiplier) - tam
        },
        {
            variable: 'peakPenetration',
            base: peakPenetration,
            lowImpact: (eligiblePatients * dxRate * (peakPenetration - 0.1) * annualPrice * geographyMultiplier) - tam,
            highImpact: (eligiblePatients * dxRate * (peakPenetration + 0.1) * annualPrice * geographyMultiplier) - tam
        }
    ];
    
    return {
        tam,
        sam,
        som,
        ranges: { low, base: tam, high },
        confidence,
        sensitivity,
        assumptions
    };
}

/**
 * Compile brief from all data
 */
function compileBrief(targetProfile, peers, benchmarks, pressureScore, risks, whyCall, tam, evidenceStrength, literature, pitch) {
    return {
        executiveSummary: `${targetProfile.canonicalName} is in ${targetProfile.phase} development with ${targetProfile.activeTrials.length} active trials. Pressure score: ${pressureScore}/100.`,
        pressureScore,
        peerCrowding: {
            phase3Peers: peers.filter(p => p.phase3Trials.length > 0).length,
            activePeers: peers.filter(p => p.activeTrials.length > 0).length
        },
        topRisks: risks,
        leadWith: targetProfile.operationalComplexity.score >= 2
            ? 'Operational complexity support for PET/MRI/infusion requirements'
            : 'Competitive monitoring and enrollment risk alerts',
        objections: [
            {
                objection: 'We already have internal systems for tracking trials',
                response: 'Our platform provides real-time competitive intelligence and peer benchmarking that goes beyond basic tracking, helping you identify enrollment risks and operational complexity signals before they impact your program.'
            },
            {
                objection: 'The cost is too high for our budget',
                response: 'Consider the cost of delayed enrollment or missed competitive signals. Our platform helps optimize site selection and protocol design, potentially saving months in development time.'
            },
            {
                objection: 'We need to see more value before committing',
                response: 'We can provide a focused pilot on your current program, demonstrating peer benchmarking and risk signals within 2 weeks. This gives you concrete value before any broader commitment.'
            }
        ],
        tam: tam || null,
        stats: {
            evidenceStrength,
            coverage: {
                totalTrials: targetProfile.trials.length,
                parsedTrials: targetProfile.trials.length, // All trials are "parsed" in our system
                endpointMentions: targetProfile.endpointMentions
            }
        },
        literature: literature ? literature.slice(0, 5) : [],
        pitch: pitch || {
            sponsorSituation: whyCall,
            ourPOV: 'Real-time competitive monitoring and enrollment risk alerts help optimize trial execution and reduce time to market.',
            proofAndAsk: 'We propose a pilot program to demonstrate value within 2 weeks, focusing on peer benchmarking and operational complexity signals.'
        }
    };
}

module.exports = {
    buildTargetProfile,
    selectPeerSet,
    computeBenchmarks,
    computePressureScore,
    computeTopRisks,
    generateWhyCallSummary,
    computeEvidenceStrength,
    computeTAM,
    compileBrief
};
