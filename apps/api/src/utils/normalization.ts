/**
 * Normalize sponsor name to canonical form
 */
export function normalizeSponsorName(rawName: string): string {
  if (!rawName) return 'unknown';
  
  // Remove common suffixes and normalize
  let normalized = rawName
    .trim()
    .replace(/\s*,\s*Inc\.?/i, '')
    .replace(/\s*Inc\.?/i, '')
    .replace(/\s*LLC\.?/i, '')
    .replace(/\s*Ltd\.?/i, '')
    .replace(/\s*Corp\.?/i, '')
    .replace(/\s*Corporation/i, '')
    .trim();
  
  // Handle common variations
  const variations: Record<string, string> = {
    'biogen inc': 'Biogen',
    'eli lilly': 'Eli Lilly',
    'eli lilly and company': 'Eli Lilly',
    'roche': 'Roche',
    'novartis': 'Novartis',
  };
  
  const lower = normalized.toLowerCase();
  if (variations[lower]) {
    return variations[lower];
  }
  
  // Capitalize properly
  return normalized
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Normalize phase string to enum
 */
export function normalizePhase(rawPhase: string): 'PHASE2' | 'PHASE23' | 'PHASE3' | 'OTHER' {
  if (!rawPhase) return 'OTHER';
  
  const upper = rawPhase.toUpperCase();
  
  if (upper.includes('PHASE 3') || upper.includes('PHASE III')) {
    return 'PHASE3';
  }
  if (upper.includes('PHASE 2/3') || upper.includes('PHASE II/III') || upper.includes('PHASE23')) {
    return 'PHASE23';
  }
  if (upper.includes('PHASE 2') || upper.includes('PHASE II')) {
    return 'PHASE2';
  }
  
  return 'OTHER';
}

/**
 * Extract route from intervention text
 */
export function extractRoute(text: string): 'oral' | 'iv' | 'sc' | 'infusion' | 'mixed' {
  const lower = text.toLowerCase();
  
  if (lower.includes('infusion') || (lower.includes('iv') && !lower.includes('oral'))) {
    return 'infusion';
  }
  if (lower.includes('subcutaneous') || lower.includes(' sc ') || lower.endsWith(' sc')) {
    return 'sc';
  }
  if (lower.includes('oral')) {
    return 'oral';
  }
  
  return 'mixed';
}

/**
 * Compute burden score from text
 */
export function computeBurdenScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  
  if (lower.includes('pet') || lower.includes('positron')) score += 2;
  if (lower.includes('mri') || lower.includes('magnetic resonance')) score += 2;
  if (lower.includes('infusion') || lower.includes(' iv ')) score += 1;
  if (lower.includes('aria')) score += 1;
  
  return Math.min(score, 6); // Cap at 6
}
