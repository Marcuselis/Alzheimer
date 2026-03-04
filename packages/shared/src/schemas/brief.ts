import { z } from 'zod';

export const BriefSchema = z.object({
  id: z.string(),
  programId: z.string().optional(),
  sponsorName: z.string(),
  programName: z.string(),
  createdAt: z.string(),
  content: z.object({
    executiveSummary: z.string(),
    pressureScore: z.number(),
    peerCrowding: z.object({
      phase3Peers: z.number(),
      activePeers: z.number(),
    }),
    topRisks: z.array(z.object({
      id: z.string(),
      title: z.string(),
      severity: z.enum(['red', 'yellow', 'green']),
      implication: z.string(),
    })),
    leadWith: z.string(),
    objections: z.array(z.object({
      objection: z.string(),
      response: z.string(),
    })),
    tam: z.object({
      tam: z.number(),
      sam: z.number(),
      som: z.number(),
      ranges: z.object({
        low: z.number(),
        base: z.number(),
        high: z.number(),
      }),
      confidence: z.enum(['low', 'medium', 'high']),
    }).optional(),
    stats: z.object({
      evidenceStrength: z.object({
        score: z.number(),
        level: z.enum(['Low', 'Medium', 'High']),
      }),
      coverage: z.object({
        totalTrials: z.number(),
        parsedTrials: z.number(),
        endpointMentions: z.array(z.object({
          keyword: z.string(),
          count: z.number(),
        })),
      }),
    }).optional(),
    literature: z.array(z.object({
      pmid: z.string(),
      title: z.string(),
      journal: z.string(),
      year: z.number(),
    })).optional(),
    pitch: z.object({
      sponsorSituation: z.string(),
      ourPOV: z.string(),
      proofAndAsk: z.string(),
    }).optional(),
  }),
});

export type Brief = z.infer<typeof BriefSchema>;
