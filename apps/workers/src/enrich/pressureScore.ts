import { TargetProfile } from './benchmark';

export function computePressureScore(
  targetProfile: TargetProfile,
  peerBenchmarks: { medians: { medianEnrollment: number; phase3Trials: number } }
): number {
  let score = 0;
  
  if (targetProfile.phase.includes('Phase 3') || targetProfile.phase.includes('Phase III')) {
    score += 25;
  }
  
  if (targetProfile.activeTrials.length >= 2) {
    score += 15;
  }
  
  if (targetProfile.medianEnrollment > (peerBenchmarks.medians.medianEnrollment || 0)) {
    score += 15;
  }
  
  const phase3ThreatsCount = peerBenchmarks.medians.phase3Trials || 0;
  if (phase3ThreatsCount >= 5) {
    score += 15;
  }
  
  if (targetProfile.operationalComplexity.score >= 2) {
    score += 10;
  }
  
  if (targetProfile.recentActivity > 0) {
    score += 10;
  }
  
  return Math.min(100, Math.max(0, score));
}
