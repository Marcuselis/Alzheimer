import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { refreshMarketDetail } from '../jobs/refreshMarketDetail';
import { jobDuration, ingestionItems, sourceFailures } from '../metrics';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

/**
 * VAIHE 2 Worker: Detail Pull
 * Hakee yksityiskohtaiset tiedot vain niille tutkimuksille, joita tarvitaan.
 * Toimii taustalla, ei blokkaa index-refreshiä.
 */
export const marketDetailWorker = new Worker(
  'market-detail',
  async (job) => {
    const { marketId, nctIds } = job.data;
    const jobId = job.id;
    const startTime = Date.now();
    
    console.log(`[DetailWorker] Starting detail fetch job ${jobId} for ${nctIds.length} trials in market ${marketId}`);
    
    try {
      await job.updateProgress(10);
      
      // Fetch details with controlled concurrency (8 concurrent, batched DB updates)
      const result = await refreshMarketDetail(nctIds, 8);
      
      await job.updateProgress(100);
      
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'market-detail', status: 'completed' }, duration);
      ingestionItems.inc({ source: 'clinicaltrials.gov', type: 'trial_details' }, result.trialsProcessed || 0);
      
      console.log(`[DetailWorker] Job ${jobId} completed: ${result.trialsProcessed}/${nctIds.length} details fetched in ${duration}ms`);
      
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'market-detail', status: 'failed' }, duration);
      sourceFailures.inc({ source: 'clinicaltrials.gov' });
      
      console.error(`[DetailWorker] Job ${jobId} failed:`, error);
      throw error;
    }
  },
  { 
    connection, 
    concurrency: 1, // Only 1 detail job at a time to be polite to CT.gov API
    limiter: {
      max: 1,
      duration: 1000, // 1 job per second max
    },
  }
);

marketDetailWorker.on('completed', (job) => {
  console.log(`[DetailWorker] Job ${job.id} completed successfully`);
});

marketDetailWorker.on('failed', (job, err) => {
  console.error(`[DetailWorker] Job ${job?.id} failed:`, err);
});

marketDetailWorker.on('error', (err) => {
  console.error('[DetailWorker] Worker error:', err);
});
