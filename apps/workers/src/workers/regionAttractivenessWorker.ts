import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { computeRegionAttractiveness } from '../jobs/computeRegionAttractiveness';
import { jobDuration } from '../metrics';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const regionAttractivenessWorker = new Worker(
  'region-attractiveness',
  async (job) => {
    const { marketId } = job.data;
    const jobId = job.id;
    const startTime = Date.now();
    
    console.log(`[Worker] Starting region attractiveness computation job ${jobId} for market ${marketId}`);
    
    try {
      await job.updateProgress(10);
      
      const result = await computeRegionAttractiveness(marketId);
      
      await job.updateProgress(100);
      
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'region-attractiveness', status: 'completed' }, duration);
      
      console.log(`[Worker] Job ${jobId} completed: ${result.regionsProcessed} regions processed in ${duration}ms`);
      
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'region-attractiveness', status: 'failed' }, duration);
      
      console.error(`[Worker] Job ${jobId} failed:`, error);
      throw error;
    }
  },
  { 
    connection, 
    concurrency: 1, // Only one at a time to avoid DB contention
    limiter: {
      max: 2,
      duration: 1000,
    },
  }
);

regionAttractivenessWorker.on('completed', (job) => {
  console.log(`[Worker] Region attractiveness job ${job.id} completed successfully`);
});

regionAttractivenessWorker.on('failed', (job, err) => {
  console.error(`[Worker] Region attractiveness job ${job?.id} failed:`, err);
});

regionAttractivenessWorker.on('error', (err) => {
  console.error('[Worker] Region attractiveness worker error:', err);
});
