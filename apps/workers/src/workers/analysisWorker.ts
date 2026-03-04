import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { runMarketAnalytics } from '../jobs/runMarketAnalytics';
import { jobDuration } from '../metrics';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const analysisWorker = new Worker(
  'analysis',
  async (job) => {
    const { marketId, type, params } = job.data;
    const jobId = job.id;
    const startTime = Date.now();
    
    console.log(`[Worker] Starting analysis job ${jobId} for market ${marketId}, type ${type}`);
    
    try {
      await job.updateProgress(10);
      
      const result = await runMarketAnalytics(marketId, type, params);
      
      await job.updateProgress(100);
      
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'analysis', status: 'completed' }, duration);
      
      console.log(`[Worker] Analysis job ${jobId} completed in ${duration}ms`);
      
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'analysis', status: 'failed' }, duration);
      
      console.error(`[Worker] Analysis job ${jobId} failed:`, error);
      throw error;
    }
  },
  { connection, concurrency: 1 }
);
