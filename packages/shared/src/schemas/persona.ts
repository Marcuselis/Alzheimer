import { z } from 'zod';

const DriverSchema = z.object({
  key: z.string(),
  points: z.number(),
  detail: z.string(),
});

const EvidenceSchema = z.object({
  nctIds: z.array(z.string()),
});

export const PersonaRecommendationSchema = z.object({
  sponsorId: z.string(),
  marketId: z.string(),
  painOwnerPersona: z.string(),
  decisionOwnerPersona: z.string(),
  urgencyScore: z.number().min(0).max(100),
  whyNowText: z.string(),
  pitchAngle: z.string(),
  avoidAngle: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
  drivers: z.array(DriverSchema),
  evidence: EvidenceSchema,
  computedAtISO: z.string(),
});

export type PersonaRecommendation = z.infer<typeof PersonaRecommendationSchema>;
export type Driver = z.infer<typeof DriverSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
