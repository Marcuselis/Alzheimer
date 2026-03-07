import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const marketRefreshQueue = new Queue('market-refresh', { connection });
export const marketDetailQueue = new Queue('market-detail', { connection }); // NEW: For detail fetching
export const sponsorRefreshQueue = new Queue('sponsor-refresh', { connection });
export const programRefreshQueue = new Queue('program-refresh', { connection });
export const analysisQueue = new Queue('analysis', { connection });
export const regionAttractivenessQueue = new Queue('region-attractiveness', { connection });
export const investigatorContactQueue = new Queue('investigator-contact-enrichment', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 15000,
    },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

export const queueEvents = new QueueEvents('market-refresh', { connection });

/**
 * Enqueue market refresh job
 */
export async function enqueueMarketRefresh(marketId: string, quickMode?: boolean) {
  const job = await marketRefreshQueue.add(
    'refresh-market',
    { marketId, quickMode: quickMode || false },
    {
      jobId: `market-refresh-${marketId}-${quickMode ? 'quick' : 'full'}-${Date.now()}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );
  return job.id;
}

/**
 * Enqueue sponsor refresh job
 */
export async function enqueueSponsorRefresh(sponsorId: string) {
  const job = await sponsorRefreshQueue.add(
    'refresh-sponsor',
    { sponsorId },
    {
      jobId: `sponsor-refresh-${sponsorId}-${Date.now()}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );
  return job.id;
}

/**
 * Enqueue program refresh job
 */
export async function enqueueProgramRefresh(programId: string) {
  const job = await programRefreshQueue.add(
    'refresh-program',
    { programId },
    {
      jobId: `program-refresh-${programId}-${Date.now()}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );
  return job.id;
}

/**
 * Enqueue analysis job
 */
export async function enqueueAnalysis(marketId: string, type: string, params?: any) {
  const job = await analysisQueue.add(
    'run-analysis',
    { marketId, type, params },
    {
      jobId: `analysis-${marketId}-${type}-${Date.now()}`,
      attempts: 2,
    }
  );
  return job.id;
}

/**
 * Enqueue region attractiveness computation job
 */
export async function enqueueRegionAttractiveness(marketId: string) {
  const job = await regionAttractivenessQueue.add(
    'compute-region-attractiveness',
    { marketId },
    {
      jobId: `region-attractiveness-${marketId}-${Date.now()}`,
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );
  return job.id;
}

export interface InvestigatorEnrichmentJobData {
  investigatorId: string;
  fullName: string;
  institution: string | null;
  country: string | null;
  topic: string | null;
}

export async function enqueueInvestigatorContactEnrichment(data: InvestigatorEnrichmentJobData) {
  const job = await investigatorContactQueue.add(
    'enrich',
    data,
    {
      // Unique job IDs allow manual re-runs while route-level logic still blocks duplicate in-flight runs.
      jobId: `inv-enrich-${data.investigatorId}-${Date.now()}`,
    }
  );
  return job.id;
}

/**
 * Enqueue market detail fetch job (called by marketRefreshWorker)
 */
export async function enqueueMarketDetailFetch(marketId: string, nctIds: string[]) {
  const job = await marketDetailQueue.add(
    'fetch-details',
    { marketId, nctIds },
    {
      jobId: `market-detail-${marketId}-${Date.now()}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      priority: 10, // Lower priority than index refresh
    }
  );
  return job.id;
}

/**
 * Get job status from any queue
 */
export async function getJobStatus(jobId: string, queueName: string = 'market-refresh') {
  let queue: Queue;
  switch (queueName) {
    case 'market-refresh':
      queue = marketRefreshQueue;
      break;
    case 'market-detail':
      queue = marketDetailQueue;
      break;
    case 'sponsor-refresh':
      queue = sponsorRefreshQueue;
      break;
    case 'program-refresh':
      queue = programRefreshQueue;
      break;
    case 'analysis':
      queue = analysisQueue;
      break;
    case 'region-attractiveness':
      queue = regionAttractivenessQueue;
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
  
  const job = await queue.getJob(jobId);
  if (!job) return null;
  
  const state = await job.getState();
  const progress = job.progress;
  const result = job.returnvalue;
  const failedReason = job.failedReason;
  
  return {
    id: jobId,
    queue: queueName,
    state,
    progress,
    result,
    failedReason,
    createdAt: new Date(job.timestamp),
    processedAt: job.processedOn ? new Date(job.processedOn) : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
  };
}
