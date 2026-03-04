import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { refreshProgram } from '../jobs/refreshProgram';
import { jobDuration } from '../metrics';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const sponsorRefreshWorker = new Worker(
  'sponsor-refresh',
  async (job) => {
    const { sponsorId } = job.data;
    const jobId = job.id;
    const startTime = Date.now();
    
    console.log(`[Worker] Starting sponsor refresh job ${jobId} for sponsor ${sponsorId}`);
    
    try {
      const result = await refreshProgram({ sponsorId });
      
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'sponsor-refresh', status: 'completed' }, duration);
      
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'sponsor-refresh', status: 'failed' }, duration);
      throw error;
    }
  },
  { connection, concurrency: 3 }
);
