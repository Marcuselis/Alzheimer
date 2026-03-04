import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { refreshProgram } from '../jobs/refreshProgram';
import { jobDuration } from '../metrics';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const programRefreshWorker = new Worker(
  'program-refresh',
  async (job) => {
    const { programId } = job.data;
    const jobId = job.id;
    const startTime = Date.now();
    
    console.log(`[Worker] Starting program refresh job ${jobId} for program ${programId}`);
    
    try {
      const result = await refreshProgram({ programId });
      
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'program-refresh', status: 'completed' }, duration);
      
      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'program-refresh', status: 'failed' }, duration);
      throw error;
    }
  },
  { connection, concurrency: 3 }
);
