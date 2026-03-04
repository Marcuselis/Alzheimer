import { Pool } from 'pg';
import { PersonaRecommendation, Driver } from '@app/shared';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

export interface PersonaInput {
  sponsorId: string;
  sponsorName: string;
  marketId: string;
  phase3Count: number;
  phase2Count: number;
  totalActiveCount: number;
  countriesCount: number;
  medianEnrollment: number;
  burdenScore: number;
  burdenFlags: {
    pet: boolean;
    mri: boolean;
    infusion: boolean;
    aria: boolean;
    biomarker: boolean;
  };
  peerCrowdingCount: number;
  completionMinMonths: number | null;
  earliestPrimaryCompletionDate: Date | null;
  lastUpdateDays: number | null;
  recruitingStartedRecently: boolean;
  enrollmentGapHigh: boolean;
  endpointMismatch: boolean;
  nctIds: string[];
}

export async function computePersonaRecommendation(
  input: PersonaInput
): Promise<PersonaRecommendation> {
  const drivers: Driver[] = [];
  let urgencyScore = 0;

  // A) Pain owner (kuka kärsii)
  let painOwnerPersona: string;
  if (input.enrollmentGapHigh) {
    painOwnerPersona = 'Director Clinical Operations';
  } else if (input.burdenScore >= 70 || input.burdenFlags.pet || input.burdenFlags.mri || input.burdenFlags.infusion || input.burdenFlags.aria) {
    painOwnerPersona = 'Head of Trial Monitoring / Clinical Ops Lead';
  } else if (input.countriesCount >= 10) {
    painOwnerPersona = 'VP Global Clinical Operations';
  } else if (input.endpointMismatch) {
    painOwnerPersona = 'VP Clinical Development';
  } else if (input.peerCrowdingCount >= 5) {
    painOwnerPersona = 'Asset Lead / Program Lead';
  } else {
    painOwnerPersona = 'Clinical Operations Lead';
  }

  // B) Decision owner (kuka päättää)
  let decisionOwnerPersona: string;
  if (input.phase3Count >= 3) {
    decisionOwnerPersona = 'VP Clinical Operations';
  } else if (input.phase3Count >= 1 && input.totalActiveCount <= 2) {
    decisionOwnerPersona = 'Chief Medical Officer / Head of Development';
  } else if (input.burdenScore >= 70) {
    decisionOwnerPersona = 'Head of Clinical Systems / Data Strategy';
  } else {
    decisionOwnerPersona = 'VP Clinical Development';
  }

  // C) Urgency score (miksi nyt) with drivers
  if (input.completionMinMonths !== null) {
    if (input.completionMinMonths <= 12) {
      urgencyScore += 30;
      drivers.push({
        key: 'completionSoon',
        points: 30,
        detail: `Earliest primary completion in ${Math.round(input.completionMinMonths)} months`,
      });
    } else if (input.completionMinMonths <= 18) {
      urgencyScore += 15;
      drivers.push({
        key: 'completionSoon',
        points: 15,
        detail: `Earliest primary completion in ${Math.round(input.completionMinMonths)} months`,
      });
    }
  }

  // Competitor timing (if we have peer crowding data)
  if (input.peerCrowdingCount >= 5) {
    urgencyScore += 20;
    drivers.push({
      key: 'competitorTiming',
      points: 20,
      detail: `High peer crowding (${input.peerCrowdingCount} Phase III peers)`,
    });
  }

  if (input.recruitingStartedRecently) {
    urgencyScore += 15;
    drivers.push({
      key: 'recruitingRecent',
      points: 15,
      detail: 'Trial recruiting started within last 90 days',
    });
  }

  if (input.lastUpdateDays !== null && input.lastUpdateDays <= 30) {
    urgencyScore += 15;
    drivers.push({
      key: 'recentUpdates',
      points: 15,
      detail: `CT.gov updated ${input.lastUpdateDays} days ago`,
    });
  }

  // New Phase 3 launch (if we can detect it - simplified check)
  if (input.phase3Count > 0 && input.recruitingStartedRecently) {
    urgencyScore += 20;
    drivers.push({
      key: 'newPhase3Launch',
      points: 20,
      detail: 'Phase III trial launched within last 180 days',
    });
  }

  urgencyScore = Math.min(100, Math.max(0, urgencyScore));

  // D) Pitch angle (mitä pitchata) + avoid angle
  let pitchAngle: string;
  if (input.enrollmentGapHigh) {
    pitchAngle = 'Enrollment velocity + site performance monitoring';
  } else if (input.burdenScore >= 70) {
    const burdenParts: string[] = [];
    if (input.burdenFlags.pet) burdenParts.push('PET');
    if (input.burdenFlags.mri) burdenParts.push('MRI');
    if (input.burdenFlags.infusion) burdenParts.push('infusion');
    if (input.burdenFlags.aria) burdenParts.push('ARIA');
    pitchAngle = `Monitoring automation for complex AD protocols (${burdenParts.join('/')})`;
  } else if (input.peerCrowdingCount >= 5) {
    pitchAngle = 'Competitive intelligence + protocol-change alerts';
  } else if (input.endpointMismatch) {
    pitchAngle = 'Design benchmarking + evidence rigor';
  } else if (input.countriesCount >= 10) {
    pitchAngle = 'Global trial oversight + deviation detection';
  } else {
    pitchAngle = 'Operational visibility for late-stage trials';
  }

  const avoidAngle = "Do not lead with a generic 'data platform' pitch; anchor on the KPI at risk.";

  // E) Why-now narrative
  const strongestDrivers = drivers
    .sort((a, b) => b.points - a.points)
    .slice(0, 2);
  
  let whyNowText: string;
  if (strongestDrivers.length > 0) {
    const driver1 = strongestDrivers[0];
    const driver2 = strongestDrivers[1];
    whyNowText = `${input.sponsorName} is under execution pressure due to ${driver1.detail.toLowerCase()}. ${driver2 ? driver2.detail : 'This is a high-receptivity window to improve oversight and reduce trial risk.'}`;
  } else {
    whyNowText = `${input.sponsorName} has active trials with ${input.countriesCount} countries. This is a high-receptivity window to improve oversight and reduce trial risk.`;
  }

  // F) Confidence
  let confidence: 'low' | 'medium' | 'high' = 'low';
  let fieldsPresent = 0;
  if (input.completionMinMonths !== null) fieldsPresent++;
  if (input.lastUpdateDays !== null) fieldsPresent++;
  if (input.burdenScore > 0 || Object.values(input.burdenFlags).some(v => v)) fieldsPresent++;
  if (input.countriesCount > 0) fieldsPresent++;
  if (input.phase3Count > 0) fieldsPresent++;
  if (input.peerCrowdingCount > 0) fieldsPresent++;

  if (fieldsPresent >= 4) {
    confidence = 'high';
  } else if (fieldsPresent >= 2) {
    confidence = 'medium';
  }

  return {
    sponsorId: input.sponsorId,
    marketId: input.marketId,
    painOwnerPersona,
    decisionOwnerPersona,
    urgencyScore,
    whyNowText,
    pitchAngle,
    avoidAngle,
    confidence,
    drivers,
    evidence: {
      nctIds: input.nctIds,
    },
    computedAtISO: new Date().toISOString(),
  };
}

export async function computePersonaForSponsor(
  sponsorId: string,
  marketId: string
): Promise<PersonaRecommendation | null> {
  // Get sponsor rollup data
  const rollupResult = await db.query(`
    SELECT msr.*, s.name as sponsor_name
    FROM mv_market_sponsor_rollup msr
    JOIN sponsors s ON msr.sponsor_id = s.id
    WHERE msr.market_id = $1 AND msr.sponsor_id = $2
  `, [marketId, sponsorId]);

  if (rollupResult.rows.length === 0) {
    return null;
  }

  const rollup = rollupResult.rows[0];

  // Get trial flags and metadata
  const trialsResult = await db.query(`
    SELECT 
      t.nct_id,
      t.updated_source_date,
      tm.primary_completion_date,
      tm.start_date,
      tm.enrollment,
      tf.has_pet,
      tf.has_mri,
      tf.has_infusion,
      tf.mentions_aria,
      tf.has_biomarker,
      tf.burden_score,
      t.payload_json->>'status' as status,
      t.payload_json->>'phase' as phase
    FROM market_trials mt
    JOIN trials t ON mt.nct_id = t.nct_id
    LEFT JOIN trial_metadata tm ON t.nct_id = tm.nct_id
    LEFT JOIN trial_flags tf ON t.nct_id = tf.nct_id
    WHERE mt.market_id = $1 AND t.sponsor_id = $2
    AND (t.payload_json->>'status' LIKE '%Recruiting%' OR t.payload_json->>'status' LIKE '%Active%')
  `, [marketId, sponsorId]);

  const trials = trialsResult.rows;
  const nctIds = trials.map(t => t.nct_id);

  // Compute burden flags
  const burdenFlags = {
    pet: trials.some(t => t.has_pet),
    mri: trials.some(t => t.has_mri),
    infusion: trials.some(t => t.has_infusion),
    aria: trials.some(t => t.mentions_aria),
    biomarker: trials.some(t => t.has_biomarker),
  };

  // Compute completion min months
  const now = new Date();
  const primaryCompletions = trials
    .map(t => t.primary_completion_date ? new Date(t.primary_completion_date) : null)
    .filter(d => d !== null && d > now) as Date[];
  
  let completionMinMonths: number | null = null;
  let earliestPrimaryCompletionDate: Date | null = null;
  if (primaryCompletions.length > 0) {
    earliestPrimaryCompletionDate = new Date(Math.min(...primaryCompletions.map(d => d.getTime())));
    const monthsDiff = (earliestPrimaryCompletionDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
    completionMinMonths = monthsDiff;
  }

  // Compute last update days
  const lastUpdateDates = trials
    .map(t => t.updated_source_date ? new Date(t.updated_source_date) : null)
    .filter(d => d !== null) as Date[];
  
  let lastUpdateDays: number | null = null;
  if (lastUpdateDates.length > 0) {
    const mostRecent = new Date(Math.max(...lastUpdateDates.map(d => d.getTime())));
    const daysDiff = (now.getTime() - mostRecent.getTime()) / (1000 * 60 * 60 * 24);
    lastUpdateDays = Math.round(daysDiff);
  }

  // Check if recruiting started recently (within 90 days)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const recruitingStartedRecently = trials.some(t => {
    if (!t.start_date) return false;
    const startDate = new Date(t.start_date);
    return startDate >= ninetyDaysAgo;
  });

  // Compute enrollment gap (vs market median)
  const marketMedianResult = await db.query(`
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY median_enrollment) as market_median
    FROM mv_market_sponsor_rollup
    WHERE market_id = $1 AND median_enrollment > 0
  `, [marketId]);
  
  const marketMedianEnrollment = marketMedianResult.rows[0]?.market_median || 0;
  const enrollmentGapHigh = rollup.median_enrollment > 0 && marketMedianEnrollment > 0
    ? (marketMedianEnrollment - rollup.median_enrollment) > 50
    : false;

  // Check endpoint mismatch (simplified - check if common endpoints are mentioned)
  const endpointMismatch = false; // Simplified - would need to check actual endpoints

  // Get peer crowding count (Phase III peers)
  const peerCrowdingResult = await db.query(`
    SELECT COUNT(DISTINCT msr2.sponsor_id) as peer_count
    FROM mv_market_sponsor_rollup msr2
    WHERE msr2.market_id = $1 
    AND msr2.sponsor_id != $2
    AND msr2.phase3_active_count > 0
  `, [marketId, sponsorId]);
  
  const peerCrowdingCount = parseInt(peerCrowdingResult.rows[0]?.peer_count || '0', 10);

  const input: PersonaInput = {
    sponsorId,
    sponsorName: rollup.sponsor_name,
    marketId,
    phase3Count: rollup.phase3_active_count || 0,
    phase2Count: rollup.phase2_active_count || 0,
    totalActiveCount: rollup.total_active_count || 0,
    countriesCount: rollup.countries_count || 0,
    medianEnrollment: rollup.median_enrollment || 0,
    burdenScore: rollup.burden_score || 0,
    burdenFlags,
    peerCrowdingCount,
    completionMinMonths,
    earliestPrimaryCompletionDate,
    lastUpdateDays,
    recruitingStartedRecently,
    enrollmentGapHigh,
    endpointMismatch,
    nctIds,
  };

  return computePersonaRecommendation(input);
}
