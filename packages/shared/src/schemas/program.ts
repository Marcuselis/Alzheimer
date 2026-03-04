import { z } from 'zod';

const RiskSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(['red', 'yellow', 'green']),
  implication: z.string(),
  evidenceLinkCount: z.number(),
});

const SourceStatusSchema = z.object({
  ctgov: z.enum(['ok', 'error', 'skipped', 'pending']),
  pubmed: z.enum(['ok', 'error', 'skipped', 'pending']),
  websignals: z.enum(['ok', 'error', 'skipped', 'pending']),
});

export const ProgramSummarySchema = z.object({
  sponsorName: z.string(),
  programName: z.string(), // molecule
  indication: z.string(),
  phase: z.string(),
  pressureScore: z.number(),
  peerCrowding: z.object({
    phase3Peers: z.number(),
    activePeers: z.number(),
  }),
  topRisks: z.array(RiskSchema),
  whyCallSummary: z.string(),
  lastUpdatedISO: z.string(),
  sourcesStatus: SourceStatusSchema,
});

export type ProgramSummary = z.infer<typeof ProgramSummarySchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const ProgramSchema = z.object({
  id: z.string(),
  sponsorId: z.string(),
  molecule: z.string(),
  indication: z.string(),
  phase: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Program = z.infer<typeof ProgramSchema>;
