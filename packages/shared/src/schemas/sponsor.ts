import { z } from 'zod';

export const SponsorSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Sponsor = z.infer<typeof SponsorSchema>;
