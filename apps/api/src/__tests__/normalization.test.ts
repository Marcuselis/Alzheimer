import { describe, it, expect } from '@jest/globals';
import { 
  normalizeSponsorName, 
  normalizePhase, 
  extractRoute, 
  computeBurdenScore 
} from '../utils/normalization';

describe('normalizeSponsorName', () => {
  it('should normalize common variations', () => {
    expect(normalizeSponsorName('Biogen Inc.')).toBe('Biogen');
    expect(normalizeSponsorName('Biogen, Inc.')).toBe('Biogen');
    expect(normalizeSponsorName('Biogen Inc')).toBe('Biogen');
    expect(normalizeSponsorName('Eli Lilly and Company')).toBe('Eli Lilly');
  });
  
  it('should handle unknown/empty', () => {
    expect(normalizeSponsorName('')).toBe('unknown');
    expect(normalizeSponsorName('   ')).toBe('unknown');
  });
});

describe('normalizePhase', () => {
  it('should normalize phase strings', () => {
    expect(normalizePhase('Phase 3')).toBe('PHASE3');
    expect(normalizePhase('Phase III')).toBe('PHASE3');
    expect(normalizePhase('Phase 2/3')).toBe('PHASE23');
    expect(normalizePhase('Phase II/III')).toBe('PHASE23');
    expect(normalizePhase('Phase 2')).toBe('PHASE2');
    expect(normalizePhase('Phase II')).toBe('PHASE2');
    expect(normalizePhase('Phase 1')).toBe('OTHER');
    expect(normalizePhase('Unknown')).toBe('OTHER');
  });
});

describe('extractRoute', () => {
  it('should extract route from text', () => {
    expect(extractRoute('intravenous infusion')).toBe('infusion');
    expect(extractRoute('IV injection')).toBe('infusion');
    expect(extractRoute('subcutaneous injection')).toBe('sc');
    expect(extractRoute('oral tablet')).toBe('oral');
    expect(extractRoute('unknown')).toBe('mixed');
  });
});

describe('computeBurdenScore', () => {
  it('should compute burden score from text', () => {
    expect(computeBurdenScore('PET scan')).toBe(2);
    expect(computeBurdenScore('MRI imaging')).toBe(2);
    expect(computeBurdenScore('IV infusion')).toBe(1);
    expect(computeBurdenScore('ARIA monitoring')).toBe(1);
    expect(computeBurdenScore('PET MRI IV ARIA')).toBe(6); // Capped at 6
    expect(computeBurdenScore('no special requirements')).toBe(0);
  });
});
