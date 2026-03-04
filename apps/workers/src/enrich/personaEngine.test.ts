import { describe, it, expect } from '@jest/globals';
import { computePersonaRecommendation, PersonaInput } from './personaEngine';

describe('personaEngine', () => {
  describe('computePersonaRecommendation', () => {
    it('should assign Director Clinical Ops as pain owner when enrollment gap is high', () => {
      const input: PersonaInput = {
        sponsorId: 'sponsor_1',
        sponsorName: 'Test Sponsor',
        marketId: 'market_1',
        phase3Count: 2,
        phase2Count: 1,
        totalActiveCount: 3,
        countriesCount: 5,
        medianEnrollment: 100,
        burdenScore: 30,
        burdenFlags: { pet: false, mri: false, infusion: false, aria: false, biomarker: false },
        peerCrowdingCount: 3,
        completionMinMonths: null,
        earliestPrimaryCompletionDate: null,
        lastUpdateDays: null,
        recruitingStartedRecently: false,
        enrollmentGapHigh: true,
        endpointMismatch: false,
        nctIds: ['NCT12345678'],
      };

      const result = computePersonaRecommendation(input);
      expect(result.painOwnerPersona).toBe('Director Clinical Operations');
      expect(result.pitchAngle).toContain('Enrollment velocity');
    });

    it('should assign Head of Trial Monitoring when burden score is high', () => {
      const input: PersonaInput = {
        sponsorId: 'sponsor_2',
        sponsorName: 'Test Sponsor',
        marketId: 'market_1',
        phase3Count: 1,
        phase2Count: 0,
        totalActiveCount: 1,
        countriesCount: 3,
        medianEnrollment: 200,
        burdenScore: 75,
        burdenFlags: { pet: true, mri: true, infusion: false, aria: false, biomarker: false },
        peerCrowdingCount: 2,
        completionMinMonths: null,
        earliestPrimaryCompletionDate: null,
        lastUpdateDays: null,
        recruitingStartedRecently: false,
        enrollmentGapHigh: false,
        endpointMismatch: false,
        nctIds: ['NCT12345678'],
      };

      const result = computePersonaRecommendation(input);
      expect(result.painOwnerPersona).toBe('Head of Trial Monitoring / Clinical Ops Lead');
      expect(result.pitchAngle).toContain('Monitoring automation');
    });

    it('should assign VP Clinical Ops as decision owner when phase3Count >= 3', () => {
      const input: PersonaInput = {
        sponsorId: 'sponsor_3',
        sponsorName: 'Test Sponsor',
        marketId: 'market_1',
        phase3Count: 3,
        phase2Count: 1,
        totalActiveCount: 4,
        countriesCount: 8,
        medianEnrollment: 250,
        burdenScore: 40,
        burdenFlags: { pet: false, mri: false, infusion: false, aria: false, biomarker: false },
        peerCrowdingCount: 4,
        completionMinMonths: null,
        earliestPrimaryCompletionDate: null,
        lastUpdateDays: null,
        recruitingStartedRecently: false,
        enrollmentGapHigh: false,
        endpointMismatch: false,
        nctIds: ['NCT12345678'],
      };

      const result = computePersonaRecommendation(input);
      expect(result.decisionOwnerPersona).toBe('VP Clinical Operations');
    });

    it('should include completionSoon driver with +30 points when completionMinMonths <= 12', () => {
      const input: PersonaInput = {
        sponsorId: 'sponsor_4',
        sponsorName: 'Test Sponsor',
        marketId: 'market_1',
        phase3Count: 1,
        phase2Count: 0,
        totalActiveCount: 1,
        countriesCount: 5,
        medianEnrollment: 150,
        burdenScore: 20,
        burdenFlags: { pet: false, mri: false, infusion: false, aria: false, biomarker: false },
        peerCrowdingCount: 2,
        completionMinMonths: 11,
        earliestPrimaryCompletionDate: new Date(),
        lastUpdateDays: null,
        recruitingStartedRecently: false,
        enrollmentGapHigh: false,
        endpointMismatch: false,
        nctIds: ['NCT12345678'],
      };

      const result = computePersonaRecommendation(input);
      expect(result.urgencyScore).toBeGreaterThanOrEqual(30);
      const completionDriver = result.drivers.find(d => d.key === 'completionSoon');
      expect(completionDriver).toBeDefined();
      expect(completionDriver?.points).toBe(30);
      expect(completionDriver?.detail).toContain('11 months');
      expect(result.whyNowText).toContain('11 months');
    });

    it('should have low confidence when fields are missing', () => {
      const input: PersonaInput = {
        sponsorId: 'sponsor_5',
        sponsorName: 'Test Sponsor',
        marketId: 'market_1',
        phase3Count: 0,
        phase2Count: 0,
        totalActiveCount: 0,
        countriesCount: 0,
        medianEnrollment: 0,
        burdenScore: 0,
        burdenFlags: { pet: false, mri: false, infusion: false, aria: false, biomarker: false },
        peerCrowdingCount: 0,
        completionMinMonths: null,
        earliestPrimaryCompletionDate: null,
        lastUpdateDays: null,
        recruitingStartedRecently: false,
        enrollmentGapHigh: false,
        endpointMismatch: false,
        nctIds: [],
      };

      const result = computePersonaRecommendation(input);
      expect(result.confidence).toBe('low');
      // Should not crash
      expect(result.painOwnerPersona).toBeDefined();
      expect(result.decisionOwnerPersona).toBeDefined();
    });

    it('should pitch competitive intelligence when peer crowding is high', () => {
      const input: PersonaInput = {
        sponsorId: 'sponsor_6',
        sponsorName: 'Test Sponsor',
        marketId: 'market_1',
        phase3Count: 1,
        phase2Count: 1,
        totalActiveCount: 2,
        countriesCount: 6,
        medianEnrollment: 180,
        burdenScore: 25,
        burdenFlags: { pet: false, mri: false, infusion: false, aria: false, biomarker: false },
        peerCrowdingCount: 6,
        completionMinMonths: null,
        earliestPrimaryCompletionDate: null,
        lastUpdateDays: null,
        recruitingStartedRecently: false,
        enrollmentGapHigh: false,
        endpointMismatch: false,
        nctIds: ['NCT12345678'],
      };

      const result = computePersonaRecommendation(input);
      expect(result.painOwnerPersona).toBe('Asset Lead / Program Lead');
      expect(result.pitchAngle).toContain('Competitive intelligence');
      expect(result.urgencyScore).toBeGreaterThanOrEqual(20); // Should include competitorTiming driver
    });

    it('should clamp urgency score to 0-100', () => {
      const input: PersonaInput = {
        sponsorId: 'sponsor_7',
        sponsorName: 'Test Sponsor',
        marketId: 'market_1',
        phase3Count: 5,
        phase2Count: 3,
        totalActiveCount: 8,
        countriesCount: 15,
        medianEnrollment: 300,
        burdenScore: 80,
        burdenFlags: { pet: true, mri: true, infusion: true, aria: true, biomarker: true },
        peerCrowdingCount: 10,
        completionMinMonths: 8,
        earliestPrimaryCompletionDate: new Date(),
        lastUpdateDays: 5,
        recruitingStartedRecently: true,
        enrollmentGapHigh: true,
        endpointMismatch: true,
        nctIds: ['NCT12345678', 'NCT87654321'],
      };

      const result = computePersonaRecommendation(input);
      expect(result.urgencyScore).toBeGreaterThanOrEqual(0);
      expect(result.urgencyScore).toBeLessThanOrEqual(100);
    });

    it('should include all evidence NCT IDs', () => {
      const input: PersonaInput = {
        sponsorId: 'sponsor_8',
        sponsorName: 'Test Sponsor',
        marketId: 'market_1',
        phase3Count: 1,
        phase2Count: 0,
        totalActiveCount: 1,
        countriesCount: 4,
        medianEnrollment: 150,
        burdenScore: 30,
        burdenFlags: { pet: false, mri: false, infusion: false, aria: false, biomarker: false },
        peerCrowdingCount: 2,
        completionMinMonths: null,
        earliestPrimaryCompletionDate: null,
        lastUpdateDays: null,
        recruitingStartedRecently: false,
        enrollmentGapHigh: false,
        endpointMismatch: false,
        nctIds: ['NCT11111111', 'NCT22222222', 'NCT33333333'],
      };

      const result = computePersonaRecommendation(input);
      expect(result.evidence.nctIds).toHaveLength(3);
      expect(result.evidence.nctIds).toContain('NCT11111111');
      expect(result.evidence.nctIds).toContain('NCT22222222');
      expect(result.evidence.nctIds).toContain('NCT33333333');
    });
  });
});
