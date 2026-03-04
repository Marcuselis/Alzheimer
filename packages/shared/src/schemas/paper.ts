import { z } from 'zod';

export const PaperSchema = z.object({
  pmid: z.string(),
  title: z.string(),
  journal: z.string(),
  year: z.number(),
  authors: z.array(z.string()),
  abstract: z.string(),
  publicationTypes: z.array(z.string()),
  tags: z.array(z.string()).optional(),
  relevanceScore: z.number().optional(),
});

export type Paper = z.infer<typeof PaperSchema>;
