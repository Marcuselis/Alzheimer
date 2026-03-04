import { TargetProfile } from './benchmark';
import { Risk } from '@app/shared';

export function computeTopRisks(
  targetProfile: TargetProfile,
  peers: TargetProfile[],
  benchmarks: { medians: { medianEnrollment: number } }
): Risk[] {
  const risks: Risk[] = [];
  
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
  
  if (targetProfile.operationalComplexity.score >= 2) {
    risks.push({
      id: 'operational_complexity',
      title: 'High Operational Complexity',
      severity: 'yellow',
      implication: `Complex monitoring requirements (PET: ${targetProfile.operationalComplexity.hasPET}, MRI: ${targetProfile.operationalComplexity.hasMRI}, Infusion: ${targetProfile.operationalComplexity.hasInfusion}) may increase site burden and enrollment time.`,
      evidenceLinkCount: targetProfile.activeTrials.length
    });
  }
  
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
  
  const severityOrder = { red: 3, yellow: 2, green: 1 };
  risks.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
  
  return risks.slice(0, 3);
}

export function generateWhyCallSummary(
  targetProfile: TargetProfile,
  peers: TargetProfile[],
  risks: Risk[]
): string {
  const sponsor = targetProfile.sponsor || 'This sponsor';
  const phase = targetProfile.phase;
  const peerCrowding = peers.length >= 5 ? 'high peer crowding' : 'moderate peer activity';
  const topRisk1 = risks.length > 0 ? risks[0].title.toLowerCase() : 'competitive pressure';
  const leadWith = targetProfile.operationalComplexity.score >= 2
    ? 'operational complexity support'
    : 'competitive monitoring';
  
  return `${sponsor} is running ${phase} Alzheimer's trials with ${peerCrowding} and ${topRisk1}. This creates urgency to improve visibility and reduce execution risk. Lead with ${leadWith}.`;
}
