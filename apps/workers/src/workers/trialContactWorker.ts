import { Worker, Queue, Job } from 'bullmq';
import Redis from 'ioredis';
import { enrichTrialContacts } from '../enrich/trialContactEnrichment';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const QUEUE_NAME = 'trial-contact-enrichment';

export const trialContactQueue = new Queue(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export async function enqueueTrialContactEnrichment(nctId: string): Promise<string> {
  const job = await trialContactQueue.add(
    'enrich',
    { nctId },
    { jobId: `contact-enrich:${nctId}`, deduplication: { id: nctId } }
  );
  return job.id ?? nctId;
}

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    const { nctId } = job.data as { nctId: string };
    console.log(`[TrialContactWorker] Processing enrichment for ${nctId}`);
    const contacts = await enrichTrialContacts(nctId);
    console.log(`[TrialContactWorker] Completed enrichment for ${nctId}: ${contacts.length} contacts`);
    return { nctId, count: contacts.length };
  },
  {
    connection: redis,
    concurrency: 2, // limit parallel enrichment to avoid rate-limiting web search
  }
);

worker.on('completed', (job: Job) => {
  console.log(`[TrialContactWorker] Job ${job.id} completed`);
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[TrialContactWorker] Job ${job?.id} failed:`, err.message);
});

export { worker as trialContactWorker };
