import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { importAlzheimersFromAACT } from '../jobs/importAlzheimersFromAACT';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * AACT Import Worker
 * 
 * Processes jobs that import Alzheimer trials from the AACT warehouse
 * into our application database.
 */

const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const aactImportQueue = new Queue('aactImport', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
      age: 86400,
    },
    removeOnFail: {
      count: 50,
    },
  },
});

export const aactImportWorker = new Worker(
  'aactImport',
  async (job) => {
    console.log(`[AACT Import Worker] Processing job ${job.id}: ${job.name}`);
    
    const { marketId, limit } = job.data;
    
    try {
      const result = await importAlzheimersFromAACT({
        marketId,
        limit,
      });
      
      console.log(`[AACT Import Worker] Job ${job.id} completed:`, result);
      
      return result;
    } catch (error: any) {
      console.error(`[AACT Import Worker] Job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 2, // Process 2 imports in parallel max
  }
);

aactImportWorker.on('completed', (job, result) => {
  console.log(`[AACT Import Worker] ✅ Job ${job.id} completed:`, result);
});

aactImportWorker.on('failed', (job, error) => {
  console.error(`[AACT Import Worker] ❌ Job ${job?.id} failed:`, error);
});

aactImportWorker.on('error', (error) => {
  console.error('[AACT Import Worker] Worker error:', error);
});

console.log('[AACT Import Worker] Started');
