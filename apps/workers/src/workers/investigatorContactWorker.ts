import { Worker, Queue, Job } from 'bullmq';
import Redis from 'ioredis';
import { enrichInvestigatorContacts } from '../enrich/investigatorContactEnrichment';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const QUEUE_NAME = 'investigator-contact-enrichment';

export const investigatorContactQueue = new Queue(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

export async function enqueueInvestigatorEnrichment(
  investigatorId: string,
  fullName: string,
  institution: string | null,
  country: string | null = null,
  topic: string | null = null
): Promise<string> {
  const job = await investigatorContactQueue.add(
    'enrich',
    { investigatorId, fullName, institution, country, topic },
    {
      // Keep unique IDs so completed retained jobs do not block explicit re-runs.
      jobId: `inv-enrich-${investigatorId}-${Date.now()}`,
    }
  );
  return job.id ?? investigatorId;
}

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    const { investigatorId, fullName, institution } = job.data as {
      investigatorId: string;
      fullName: string;
      institution: string | null;
      country?: string | null;
      topic?: string | null;
    };

    console.log(`[InvContactWorker] Processing ${fullName} (${investigatorId})`);
    await enrichInvestigatorContacts({
      investigatorId,
      fullName,
      institution,
      country: job.data?.country ?? null,
      topic: job.data?.topic ?? null,
    });
    console.log(`[InvContactWorker] Completed ${investigatorId}`);
    return { investigatorId };
  },
  {
    connection: redis,
    concurrency: 2, // keep low — SMTP probing is rate-sensitive
  }
);

worker.on('completed', (job: Job) => {
  console.log(`[InvContactWorker] Job ${job.id} completed`);
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[InvContactWorker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err: Error) => {
  console.error('[InvContactWorker] Worker error:', err.message);
});

export { worker as investigatorContactWorker };
