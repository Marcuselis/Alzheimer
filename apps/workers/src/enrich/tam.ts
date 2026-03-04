export interface TAMAssumptions {
  eligiblePatients?: number;
  annualPrice?: number;
  dxRate?: number;
  peakPenetration?: number;
  discontinuation?: number;
  timeToPeakYears?: number;
  geographyMultiplier?: number;
}

export interface TAMResult {
  tam: number;
  sam: number;
  som: number;
  ranges: {
    low: number;
    base: number;
    high: number;
  };
  confidence: 'low' | 'medium' | 'high';
  sensitivity: Array<{
    variable: string;
    base: number;
    lowImpact: number;
    highImpact: number;
  }>;
  assumptions: TAMAssumptions;
}

export function computeTAM(assumptions: TAMAssumptions): TAMResult {
  const {
    eligiblePatients = 6000000,
    annualPrice = 50000,
    dxRate = 0.3,
    peakPenetration = 0.15,
    discontinuation = 0.1,
    timeToPeakYears = 5,
    geographyMultiplier = 1.0
  } = assumptions;
  
  const tam = eligiblePatients * dxRate * peakPenetration * annualPrice * geographyMultiplier;
  const sam = tam * 0.5;
  const som = sam * 0.1;
  
  const low = tam * 0.7;
  const high = tam * 1.3;
  
  const requiredFields = ['eligiblePatients', 'annualPrice', 'dxRate', 'peakPenetration'];
  const userSetFields = requiredFields.filter(f => assumptions[f as keyof TAMAssumptions] !== undefined);
  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (userSetFields.length === requiredFields.length) confidence = 'high';
  else if (userSetFields.length >= 2) confidence = 'medium';
  
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
