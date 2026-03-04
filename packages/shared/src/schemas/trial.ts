import { z } from 'zod';

export const TrialSchema = z.object({
  nctId: z.string(),
  title: z.string(),
  status: z.string(),
  phase: z.string(),
  studyType: z.string().optional(),
  sponsor: z.string().optional(),
  conditions: z.array(z.string()),
  interventionsText: z.string(),
  outcomesPrimaryText: z.array(z.string()),
  outcomesSecondaryText: z.array(z.string()),
  locations: z.array(z.string()),
  startDate: z.string().optional(),
  primaryCompletionDate: z.string().optional(),
  enrollment: z.number(),
  eligibilityCriteria: z.string().optional(),
});

export type Trial = z.infer<typeof TrialSchema>;
