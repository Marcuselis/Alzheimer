import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { refreshMarketIndex } from '../jobs/refreshMarketIndex';
import { importAlzheimersFromAACT } from '../jobs/importAlzheimersFromAACT';
import { refreshMarketRollups } from '../jobs/refreshMarket';
import { jobDuration, ingestionItems, sourceFailures } from '../metrics';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Import centralized queue (will create marketDetailQueue in workers context too)
// Note: We need to create Queue instance here since we're in workers package
import { Queue } from 'bullmq';
const detailQueue = new Queue('market-detail', { connection });

// Check if AACT warehouse mode is enabled
const USE_AACT = process.env.USE_AACT === 'true';

export const marketRefreshWorker = new Worker(
  'market-refresh',
  async (job) => {
    const { marketId, quickMode } = job.data;
    const jobId = job.id;
    const startTime = Date.now();
    
    console.log(`[Worker] Starting market refresh job ${jobId} for market ${marketId} (quickMode: ${quickMode || false}, USE_AACT: ${USE_AACT})`);
    
    try {
      await job.updateProgress({
        percent: 10,
        stage: 'starting',
        message: 'Initializing market refresh...',
        elapsedMs: Date.now() - startTime,
      });
      
      let result: any;
      
      if (USE_AACT) {
        // MODE A: Use AACT warehouse (instant, no API calls)
        console.log(`[Worker] Using AACT warehouse mode`);
        
        await job.updateProgress({
          percent: 30,
          stage: 'fetching',
          message: 'Fetching trials from AACT database...',
          source: 'AACT',
          elapsedMs: Date.now() - startTime,
        });
        
        result = await importAlzheimersFromAACT({
          marketId,
          limit: quickMode ? 200 : 5000,
        });
        
        // Refresh materialized views
        await job.updateProgress({
          percent: 90,
          stage: 'finalizing',
          message: 'Computing sponsor rollups and market analytics...',
          elapsedMs: Date.now() - startTime,
        });
        
        console.log(`[Worker] Refreshing materialized views for market ${marketId}...`);
        try {
          await refreshMarketRollups(marketId);
          console.log(`[Worker] Materialized views refreshed successfully`);
        } catch (err) {
          console.error('[Worker] Rollup error:', err);
        }
        
        const duration = Date.now() - startTime;
        await job.updateProgress({
          percent: 100,
          stage: 'completed',
          message: `Completed: ${result.trialsProcessed || 0} trials processed in ${(duration / 1000).toFixed(1)}s`,
          trialsProcessed: result.trialsProcessed || 0,
          elapsedMs: duration,
        });
        
        jobDuration.observe({ job_type: 'market-refresh', status: 'completed' }, duration);
        ingestionItems.inc({ source: 'aact', type: 'trials' }, result.trialsProcessed || 0);
        
        console.log(`[Worker] Job ${jobId} completed (AACT): ${result.trialsProcessed} trials imported in ${duration}ms`);
        
        return { ...result, totalDurationMs: duration, source: 'AACT' };
        
      } else {
        // MODE B: Use ClinicalTrials.gov API (traditional flow)
        console.log(`[Worker] Using ClinicalTrials.gov API mode`);
        
        await job.updateProgress({
          percent: 20,
          stage: 'fetching',
          message: 'Fetching trials from ClinicalTrials.gov...',
          source: 'CT.gov',
          elapsedMs: Date.now() - startTime,
        });
        
        // VAIHE 1: INDEX PULL - kevyt, nopea, koko markkina
        result = await refreshMarketIndex(marketId, { quickMode: quickMode || false, job, startTime });
        
        await job.updateProgress({
          percent: 80,
          stage: 'processing',
          message: `Processed ${result.trialsProcessed || 0} trials, ${result.nctIdsNeedingDetail?.length || 0} need details`,
          trialsProcessed: result.trialsProcessed || 0,
          trialsNeedingDetail: result.nctIdsNeedingDetail?.length || 0,
          elapsedMs: Date.now() - startTime,
        });
        
        // VAIHE 2: Queue detail fetching for trials that need it
        if (result.nctIdsNeedingDetail && result.nctIdsNeedingDetail.length > 0) {
          console.log(`[Worker] Queueing ${result.nctIdsNeedingDetail.length} trials for detail fetch`);
          
          // Queue detail job (non-blocking, processed by detailWorker)
          await detailQueue.add(
            'fetch-details',
            { 
              marketId, 
              nctIds: result.nctIdsNeedingDetail,
            },
            {
              priority: quickMode ? 5 : 10, // Lower priority for detail fetching
              attempts: 3,
              backoff: {
                type: 'exponential',
                delay: 5000,
              },
            }
          );
        }
        
        // VAIHE 3: Refresh materialized views (sponsor rollups, etc.)
        await job.updateProgress({
          percent: 90,
          stage: 'finalizing',
          message: 'Computing sponsor rollups and market analytics...',
          elapsedMs: Date.now() - startTime,
        });
        
        console.log(`[Worker] Refreshing materialized views for market ${marketId}...`);
        try {
          await refreshMarketRollups(marketId);
          console.log(`[Worker] Materialized views refreshed successfully`);
        } catch (err) {
          console.error('[Worker] Rollup error:', err);
          // Don't fail the entire job if rollups fail
        }
        
        const duration = Date.now() - startTime;
        await job.updateProgress({
          percent: 100,
          stage: 'completed',
          message: `Market refresh completed: ${result.trialsProcessed || 0} trials in ${(duration / 1000).toFixed(1)}s`,
          trialsProcessed: result.trialsProcessed || 0,
          elapsedMs: duration,
        });
        
        jobDuration.observe({ job_type: 'market-refresh', status: 'completed' }, duration);
        ingestionItems.inc({ source: 'clinicaltrials.gov', type: 'trials' }, result.trialsProcessed || 0);
        
        console.log(`[Worker] Job ${jobId} completed (CT.gov): ${result.trialsProcessed} trials indexed in ${duration}ms, ${result.nctIdsNeedingDetail?.length || 0} queued for detail`);
        
        return { ...result, totalDurationMs: duration, source: 'CT.gov' };
      }
      
    } catch (error: any) {
      const duration = Date.now() - startTime;
      jobDuration.observe({ job_type: 'market-refresh', status: 'failed' }, duration);
      sourceFailures.inc({ source: USE_AACT ? 'aact' : 'clinicaltrials.gov' });
      
      console.error(`[Worker] Job ${jobId} failed:`, error);
      throw error;
    }
  },
  { 
    connection, 
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 1000, // 5 jobs per second max
    },
  }
);

marketRefreshWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

marketRefreshWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err);
});

marketRefreshWorker.on('error', (err) => {
  console.error('[Worker] Worker error:', err);
});
