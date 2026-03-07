import Fastify from 'fastify';
import cors from '@fastify/cors';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from './db/client';
import { getOrSetJson, buildCacheKey } from './cache/cache';
import {
  enqueueMarketRefresh,
  enqueueSponsorRefresh,
  enqueueProgramRefresh,
  enqueueRegionAttractiveness,
  getJobStatus
} from './queue/queue';
import {
  httpRequestDuration,
  httpRequestsTotal,
  cacheHits,
  cacheMisses,
  register
} from './metrics';
import { ProgramSummarySchema } from '@app/shared';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    serializers: {
      req: (req: any) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: any) => ({
        statusCode: res.statusCode,
      }),
    },
  },
  genReqId: () => uuidv4(),
  requestIdLogLabel: 'request_id',
  requestIdHeader: 'x-request-id',
});

// Wrap everything in async function to avoid top-level await
async function start() {
  // CORS - allow requests from the web frontend
  // In production, allow all origins if CORS_ORIGINS is not set (Railway deployments)
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : true; // Allow all origins if not specified

  await fastify.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? corsOrigins  // In production, use CORS_ORIGINS env var or allow all
      : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    preflight: true,
    preflightContinue: false,
  });

  // Request logging and metrics hooks
  fastify.addHook('onRequest', async (request, reply) => {
    request.log.info({
      request_id: request.id,
      method: request.method,
      url: request.url,
    }, 'Incoming request');
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const duration = reply.elapsedTime;
    const route = request.routeOptions?.url || request.url.split('?')[0];

    // Record metrics
    httpRequestDuration.observe(
      { route, method: request.method, status: reply.statusCode },
      duration
    );
    httpRequestsTotal.inc({ route, method: request.method, status: reply.statusCode });

    request.log.info({
      request_id: request.id,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration_ms: Math.round(duration),
    }, 'Request completed');
  });

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Metrics endpoint
  fastify.get('/metrics', async (request, reply) => {
    reply.type('text/plain');
    return register.metrics();
  });

  // AACT Warehouse Status
  fastify.get('/api/warehouse/status', async (request, reply) => {
    const requestId = request.id;

    try {
      const cacheKey = buildCacheKey(['warehouse', 'status']);

      return getOrSetJson(
        cacheKey,
        async () => {
          try {
            // Check if AACT is enabled
            const USE_AACT = process.env.USE_AACT === 'true';

            // Check if AACT client can connect
            const { testAACTConnection, getAACTStats } = await import('./db/aactClient');
            const connected = await testAACTConnection();

            if (!connected) {
              return {
                enabled: USE_AACT,
                connected: false,
                status: 'offline',
                message: 'AACT database not accessible. Run scripts/aact_restore.sh to set up.',
                stats: null,
              };
            }

            // Get AACT statistics
            const aactStats = await getAACTStats();

            // Get import statistics from app database
            const importStatsResult = await db.query(`
            SELECT 
              coverage_counts_json,
              last_success_at
            FROM market_state
            WHERE coverage_counts_json->>'source' = 'aact'
            ORDER BY last_success_at DESC
            LIMIT 1
          `);

            const importStats = importStatsResult.rows[0];
            const coverageJson = importStats?.coverage_counts_json || {};

            // Count Alzheimer Phase II-III trials imported
            const alzCountResult = await db.query(`
            SELECT COUNT(*) as count
            FROM trials
            WHERE source = 'aact'
          `);

            const alzCount = parseInt(alzCountResult.rows[0]?.count || '0', 10);

            return {
              enabled: USE_AACT,
              connected: true,
              status: 'online',
              message: USE_AACT
                ? 'AACT warehouse is active. Market refresh uses local data.'
                : 'AACT warehouse is ready but not enabled. Set USE_AACT=true to activate.',
              aactDatabase: {
                totalStudies: parseInt(aactStats?.total_studies || '0', 10),
                totalSponsors: parseInt(aactStats?.total_sponsors || '0', 10),
                totalCountries: parseInt(aactStats?.total_countries || '0', 10),
                latestSubmission: aactStats?.latest_submission,
              },
              appDatabase: {
                alzheimerPhase23Imported: alzCount,
                lastImportTimestamp: importStats?.last_success_at?.toISOString() || null,
                trialsProcessed: coverageJson.trialsProcessed || 0,
              },
            };
          } catch (error: any) {
            console.error('[AACT Status] Error:', error);
            return {
              enabled: process.env.USE_AACT === 'true',
              connected: false,
              status: 'error',
              message: `AACT warehouse error: ${error.message}`,
              error: error.message,
            };
          }
        },
        { ttlSeconds: 60 } // Cache for 1 minute
      );
    } catch (error: any) {
      fastify.log.error({ requestId, error: error.message }, 'AACT status error');
      return reply.code(500).send({
        error: error.message,
        requestId,
        enabled: false,
        status: 'error',
      });
    }
  });

  // Get markets
  fastify.get('/api/markets', async (request) => {
    const cacheKey = buildCacheKey(['markets', 'list']);

    return getOrSetJson(
      cacheKey,
      async () => {
        const result = await db.query('SELECT id, key, indication_key, definition_json FROM market_definitions ORDER BY created_at DESC');
        return {
          markets: result.rows.map(row => ({
            id: row.id,
            key: row.key,
            indicationKey: row.indication_key,
            definition: row.definition_json,
          })),
        };
      },
      { ttlSeconds: 300 }
    );
  });

  // Get market summary
  const MarketIdParamsSchema = z.object({
    marketId: z.string().min(1),
  });

  fastify.get('/api/markets/:marketId/summary', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);
      const cacheKey = buildCacheKey(['market-summary', params.marketId]);

      const summary = await getOrSetJson(
        cacheKey,
        async () => {
          // Get market definition
          const defResult = await db.query('SELECT * FROM market_definitions WHERE id = $1', [params.marketId]);
          if (defResult.rows.length === 0) {
            throw new Error('Market not found');
          }

          // Get market state
          const stateResult = await db.query('SELECT * FROM market_state WHERE market_id = $1', [params.marketId]);
          const state = stateResult.rows[0];

          // Get counts from materialized views (fast)
          const trialCountResult = await db.query('SELECT COUNT(*) as count FROM market_trials WHERE market_id = $1', [params.marketId]);
          const sponsorCountResult = await db.query(`
          SELECT COUNT(DISTINCT sponsor_id) as count
          FROM mv_market_sponsor_rollup
          WHERE market_id = $1
        `, [params.marketId]);
          const phase3CountResult = await db.query(`
          SELECT SUM(phase3_active_count) as count
          FROM mv_market_sponsor_rollup
          WHERE market_id = $1
        `, [params.marketId]);

          return {
            marketId: params.marketId,
            indication: defResult.rows[0].indication_key,
            coverage: {
              trials: parseInt(trialCountResult.rows[0]?.count || '0', 10),
              sponsors: parseInt(sponsorCountResult.rows[0]?.count || '0', 10),
              activePhase3: parseInt(phase3CountResult.rows[0]?.count || '0', 10),
            },
            lastRefreshed: state?.last_success_at?.toISOString() || null,
            lastRefreshAttempt: state?.last_refresh_at?.toISOString() || null,
            sourceHealth: {
              ctgov: state?.last_error ? 'error' : (state?.last_success_at ? 'ok' : 'pending'),
              pubmed: 'available', // PubMed is now available on-demand per sponsor
              websignals: 'skipped',
            },
            definition: defResult.rows[0].definition_json,
          };
        },
        { ttlSeconds: 300 }
      );

      return summary;
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        fastify.log.error({ requestId, error: error.errors }, 'Validation error');
        return reply.code(400).send({
          error: 'Invalid request',
          details: error.errors,
          requestId
        });
      }
      fastify.log.error({ requestId, error: error.message }, 'Market summary error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Get market sponsors (with filters and sorting)
  const SponsorsQuerySchema = z.object({
    sort: z.enum(['pressure', 'phase3', 'enrollment']).default('pressure'),
    status: z.enum(['active', 'all']).default('active'),
    phase: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  });

  fastify.get('/api/markets/:marketId/sponsors', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);
      const query = SponsorsQuerySchema.parse(request.query);

      const filtersHash = `${query.sort}-${query.status}-${query.phase || 'all'}-${query.limit}`;
      const cacheKey = buildCacheKey(['markets', params.marketId, 'sponsors', filtersHash]);

      const sponsors = await getOrSetJson(
        cacheKey,
        async () => {
          let sql = `
          SELECT msr.*, s.name as sponsor_name
          FROM mv_market_sponsor_rollup msr
          JOIN sponsors s ON msr.sponsor_id = s.id
          WHERE msr.market_id = $1
        `;
          const sqlParams: any[] = [params.marketId];

          if (query.status === 'active') {
            sql += ' AND msr.total_active_count > 0';
          }

          if (query.phase === '2-3' || query.phase === '23') {
            sql += ' AND (msr.phase2_active_count > 0 OR msr.phase3_active_count > 0)';
          } else if (query.phase === '3') {
            sql += ' AND msr.phase3_active_count > 0';
          } else if (query.phase === '2') {
            sql += ' AND msr.phase2_active_count > 0';
          }

          // Sort
          if (query.sort === 'pressure') {
            sql += ' ORDER BY msr.pressure_score DESC';
          } else if (query.sort === 'phase3') {
            sql += ' ORDER BY msr.phase3_active_count DESC';
          } else if (query.sort === 'enrollment') {
            sql += ' ORDER BY msr.median_enrollment DESC NULLS LAST';
          }

          sql += ` LIMIT $${sqlParams.length + 1}`;
          sqlParams.push(query.limit);

          const result = await db.query(sql, sqlParams);

          return result.rows.map(row => ({
            sponsorId: row.sponsor_id,
            sponsorName: row.sponsor_name,
            pressureScore: row.pressure_score,
            phase3Active: row.phase3_active_count,
            phase2Active: row.phase2_active_count,
            totalActive: row.total_active_count,
            medianEnrollment: row.median_enrollment,
            countriesCount: row.countries_count,
            burdenScore: row.burden_score,
            lastUpdate: row.last_trial_update_date?.toISOString() || null,
            whyNow: row.why_now_snippet,
            evidenceLinkCount: row.evidence_link_count,
          }));
        },
        { ttlSeconds: 600 }
      );

      return { sponsors, marketId: params.marketId, filters: query };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        fastify.log.error({ requestId, error: error.errors }, 'Validation error');
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Sponsors query error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Get sponsor contacts
  fastify.get('/api/markets/:marketId/sponsors/:sponsorId/contacts', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = z.object({
        marketId: z.string().min(1),
        sponsorId: z.string().min(1),
      }).parse(request.params);

      const cacheKey = buildCacheKey(['sponsor', params.marketId, params.sponsorId, 'contacts']);

      return getOrSetJson(
        cacheKey,
        async () => {
          const result = await db.query(`
          SELECT 
            persona_type,
            persona_role,
            full_name,
            title,
            company,
            linkedin_url,
            source,
            confidence,
            evidence_json,
            computed_at
          FROM contact_candidates
          WHERE sponsor_id = $1 AND market_id = $2
          ORDER BY persona_type, confidence DESC, computed_at DESC
        `, [params.sponsorId, params.marketId]);

          const contacts: {
            pain_owner: any[];
            decision_owner: any[];
          } = {
            pain_owner: [],
            decision_owner: [],
          };

          let computedAtISO: string | null = null;

          for (const row of result.rows) {
            const contact = {
              fullName: row.full_name,
              title: row.title,
              company: row.company,
              linkedinUrl: row.linkedin_url,
              confidence: row.confidence,
              evidence: row.evidence_json,
            };

            if (row.persona_type === 'pain_owner') {
              contacts.pain_owner.push(contact);
            } else if (row.persona_type === 'decision_owner') {
              contacts.decision_owner.push(contact);
            }

            // Track latest computed_at
            if (!computedAtISO || (row.computed_at && new Date(row.computed_at) > new Date(computedAtISO))) {
              computedAtISO = row.computed_at?.toISOString() || null;
            }
          }

          // Limit to top 3 per persona type (already sorted by confidence)
          contacts.pain_owner = contacts.pain_owner.slice(0, 3);
          contacts.decision_owner = contacts.decision_owner.slice(0, 3);

          return {
            sponsorId: params.sponsorId,
            marketId: params.marketId,
            contacts,
            computedAtISO,
            source: 'public_web',
            message: contacts.pain_owner.length === 0 && contacts.decision_owner.length === 0
              ? 'No public contacts found yet. Try refresh.'
              : undefined,
          };
        },
        { ttlSeconds: 600 } // 10 min cache
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Contacts error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Get sponsor geographic data
  fastify.get('/api/markets/:marketId/sponsors/:sponsorId/geographic', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = z.object({
        marketId: z.string().min(1),
        sponsorId: z.string().min(1),
      }).parse(request.params);

      const cacheKey = buildCacheKey(['sponsor', params.marketId, params.sponsorId, 'geographic']);

      return getOrSetJson(
        cacheKey,
        async () => {
          // Extract location data from detail_json
          const result = await db.query(`
          SELECT 
            t.nct_id,
            t.detail_json->'locations' as locations,
            t.index_json->>'status' as status
          FROM market_trials mt
          JOIN trials t ON mt.nct_id = t.nct_id
          WHERE mt.market_id = $1 
            AND t.sponsor_id = $2
            AND t.detail_json IS NOT NULL
            AND t.detail_json->'locations' IS NOT NULL
        `, [params.marketId, params.sponsorId]);

          // Nordic countries
          const NORDIC_COUNTRIES = ['Denmark', 'Finland', 'Iceland', 'Norway', 'Sweden'];

          // Aggregate by country
          const countryMap = new Map<string, { name: string; trials: Set<string>; activeTrials: Set<string>; sites: number }>();

          for (const row of result.rows) {
            const locations = row.locations;
            const nctId = row.nct_id;
            const isActive = ['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION'].includes(row.status);

            if (Array.isArray(locations)) {
              for (const loc of locations) {
                const country = loc.country || 'Unknown';
                if (!countryMap.has(country)) {
                  countryMap.set(country, { name: country, trials: new Set(), activeTrials: new Set(), sites: 0 });
                }
                const countryData = countryMap.get(country)!;
                countryData.trials.add(nctId);
                countryData.sites++;
                if (isActive) {
                  countryData.activeTrials.add(nctId);
                }
              }
            }
          }

          const countries = Array.from(countryMap.entries()).map(([code, data]) => ({
            countryCode: code,
            countryName: data.name,
            trialCount: data.trials.size,
            activeCount: data.activeTrials.size,
            siteCount: data.sites,
            isNordic: NORDIC_COUNTRIES.includes(data.name),
          })).sort((a, b) => b.trialCount - a.trialCount);

          const nordicCountries = countries.filter(c => c.isNordic);

          return {
            sponsorId: params.sponsorId,
            countries,
            nordicCountries,
            totalCountries: countries.length,
            nordicTrialCount: new Set(nordicCountries.flatMap(c =>
              Array.from(countryMap.get(c.countryName)?.trials || [])
            )).size,
            nordicSiteCount: nordicCountries.reduce((sum, c) => sum + c.siteCount, 0),
          };
        },
        { ttlSeconds: 600 }
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Geographic data error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Get sponsor statistics
  fastify.get('/api/markets/:marketId/sponsors/:sponsorId/statistics', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = z.object({
        marketId: z.string().min(1),
        sponsorId: z.string().min(1),
      }).parse(request.params);

      const cacheKey = buildCacheKey(['sponsor-stats', params.marketId, params.sponsorId]);

      const statistics = await getOrSetJson(
        cacheKey,
        async () => {
          // Get all trials for this sponsor in this market
          const trialsResult = await db.query(`
          SELECT 
            t.nct_id,
            t.index_json->>'phase' as phase,
            t.index_json->>'status' as status,
            (t.index_json->>'enrollment')::int as enrollment,
            (t.index_json->>'startDate')::text as start_date,
            (t.index_json->>'completionDate')::text as completion_date,
            (t.index_json->>'primaryCompletionDate')::text as primary_completion_date,
            t.index_json->>'title' as title
          FROM market_trials mt
          JOIN trials t ON mt.nct_id = t.nct_id
          WHERE mt.market_id = $1 AND t.sponsor_id = $2
        `, [params.marketId, params.sponsorId]);

          if (trialsResult.rows.length === 0) {
            return {
              totalTrials: 0,
              message: 'No trials found for this sponsor in this market',
            };
          }

          const trials = trialsResult.rows;

          // Calculate statistics
          const totalTrials = trials.length;
          const enrollmentNumbers = trials.map(t => t.enrollment || 0).filter(e => e > 0);
          const totalEnrollment = enrollmentNumbers.reduce((sum, n) => sum + n, 0);
          const avgEnrollment = enrollmentNumbers.length > 0 ? Math.round(totalEnrollment / enrollmentNumbers.length) : 0;
          const medianEnrollment = enrollmentNumbers.length > 0
            ? enrollmentNumbers.sort((a, b) => a - b)[Math.floor(enrollmentNumbers.length / 2)]
            : 0;

          // Phase breakdown
          const phaseBreakdown = trials.reduce((acc: any, t) => {
            const phase = t.phase || 'Unknown';
            acc[phase] = (acc[phase] || 0) + 1;
            return acc;
          }, {});

          // Status breakdown
          const statusBreakdown = trials.reduce((acc: any, t) => {
            const status = t.status || 'Unknown';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
          }, {});

          // Completion rates
          const completedTrials = trials.filter(t =>
            t.status === 'COMPLETED' || t.status === 'TERMINATED'
          ).length;
          const activeTrials = trials.filter(t =>
            t.status === 'RECRUITING' ||
            t.status === 'ACTIVE_NOT_RECRUITING' ||
            t.status === 'ENROLLING_BY_INVITATION'
          ).length;
          const completionRate = totalTrials > 0 ? Math.round((completedTrials / totalTrials) * 100) : 0;

          // Timeline analysis
          const trialsWithDates = trials.filter(t => t.start_date || t.completion_date);
          const earliestStart = trialsWithDates
            .filter(t => t.start_date)
            .map(t => new Date(t.start_date))
            .sort((a, b) => a.getTime() - b.getTime())[0];
          const latestCompletion = trialsWithDates
            .filter(t => t.completion_date)
            .map(t => new Date(t.completion_date))
            .sort((a, b) => b.getTime() - a.getTime())[0];

          return {
            sponsorId: params.sponsorId,
            marketId: params.marketId,
            totalTrials,
            enrollment: {
              total: totalEnrollment,
              average: avgEnrollment,
              median: medianEnrollment,
              min: enrollmentNumbers.length > 0 ? Math.min(...enrollmentNumbers) : 0,
              max: enrollmentNumbers.length > 0 ? Math.max(...enrollmentNumbers) : 0,
            },
            phases: phaseBreakdown,
            statuses: statusBreakdown,
            completionRate,
            activeTrials,
            completedTrials,
            timeline: {
              earliestStart: earliestStart?.toISOString() || null,
              latestCompletion: latestCompletion?.toISOString() || null,
              yearsActive: earliestStart && latestCompletion
                ? Math.round((latestCompletion.getTime() - earliestStart.getTime()) / (365 * 24 * 60 * 60 * 1000))
                : 0,
            },
            trials: trials.map(t => ({
              nctId: t.nct_id,
              title: t.title,
              phase: t.phase,
              status: t.status,
              enrollment: t.enrollment,
              startDate: t.start_date,
              completionDate: t.completion_date,
            })),
          };
        },
        { ttlSeconds: 600 }
      );

      return reply.send(statistics);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Statistics error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Get sponsor detail
  fastify.get('/api/markets/:marketId/sponsors/:sponsorId', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = z.object({
        marketId: z.string().min(1),
        sponsorId: z.string().min(1),
      }).parse(request.params);

      const cacheKey = buildCacheKey(['sponsor', params.marketId, params.sponsorId]);

      const sponsorDetail = await getOrSetJson(
        cacheKey,
        async () => {
          const rollupResult = await db.query(`
          SELECT msr.*, s.name as sponsor_name
          FROM mv_market_sponsor_rollup msr
          JOIN sponsors s ON msr.sponsor_id = s.id
          WHERE msr.market_id = $1 AND msr.sponsor_id = $2
        `, [params.marketId, params.sponsorId]);

          if (rollupResult.rows.length === 0) {
            throw new Error('Sponsor not found in market');
          }

          const rollup = rollupResult.rows[0];

          // Get programs
          const programsResult = await db.query(`
          SELECT DISTINCT
            t.payload_json->>'interventionsText' as molecule,
            t.payload_json->>'phase' as phase,
            COUNT(*) as trial_count
          FROM market_trials mt
          JOIN trials t ON mt.nct_id = t.nct_id
          WHERE mt.market_id = $1 AND t.sponsor_id = $2
          GROUP BY t.payload_json->>'interventionsText', t.payload_json->>'phase'
          ORDER BY trial_count DESC
        `, [params.marketId, params.sponsorId]);

          return {
            sponsorId: params.sponsorId,
            sponsorName: rollup.sponsor_name,
            marketId: params.marketId,
            pressureScore: rollup.pressure_score,
            programs: programsResult.rows.map(row => ({
              programKey: row.molecule,
              molecule: row.molecule,
              phase: row.phase,
              trialCount: parseInt(row.trial_count, 10),
            })),
            whyCallThem: rollup.why_now_snippet || `Active Phase III trials with ${rollup.phase3_active_count} studies`,
            coverage: {
              phase3Active: rollup.phase3_active_count,
              phase2Active: rollup.phase2_active_count,
              totalActive: rollup.total_active_count,
              countries: rollup.countries_count,
              evidenceLinks: rollup.evidence_link_count,
            },
          };
        },
        { ttlSeconds: 600 }
      );

      return sponsorDetail;
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Sponsor detail error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Refresh market (now uses job queue)
  fastify.post('/api/markets/:marketId/refresh', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);
      const { quick } = request.query as any;
      const quickMode = quick === 'true' || quick === '1';

      const jobId = await enqueueMarketRefresh(params.marketId, quickMode);

      fastify.log.info({ requestId, marketId: params.marketId, jobId, quickMode }, 'Market refresh job enqueued');

      return reply.code(202).send({
        status: 'accepted',
        jobId,
        marketId: params.marketId,
        quickMode,
        message: quickMode ? 'Quick market refresh job enqueued (200 studies)' : 'Full market refresh job enqueued (1000 studies)',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Failed to enqueue job');
      return reply.code(500).send({ error: 'Failed to enqueue job', requestId });
    }
  });

  // Helper: enrich job status with elapsedMs and ensure progress is always an object for the UI
  function enrichJobStatusWithTiming(status: any): any {
    const createdAt = status.createdAt ? new Date(status.createdAt).getTime() : null;
    const finishedAt = status.finishedAt ? new Date(status.finishedAt).getTime() : null;
    let elapsedMs: number | null = null;
    if (finishedAt && createdAt) {
      elapsedMs = finishedAt - createdAt;
    } else if (createdAt && (status.state === 'active' || status.state === 'waiting')) {
      elapsedMs = Date.now() - createdAt;
    }
    // BullMQ can return progress as a number (0) or object; normalize to object so UI always has percent/message
    const raw = status.progress;
    const progress =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw
        : typeof raw === 'number'
          ? { percent: raw, message: status.state === 'waiting' ? 'Waiting for worker…' : 'Starting…' }
          : { percent: 0, message: status.state === 'waiting' ? 'Waiting for worker…' : 'Starting…' };
    return {
      ...status,
      progress,
      elapsedMs: elapsedMs ?? progress.elapsedMs ?? null,
      totalDurationMs: status.result?.totalDurationMs ?? (elapsedMs || null),
      source: progress.source ?? status.result?.source ?? null,
    };
  }

  // Get job status
  fastify.get('/api/jobs/:jobId', async (request, reply) => {
    const requestId = request.id;
    try {
      const params = z.object({ jobId: z.string().min(1) }).parse(request.params);
      const { queue } = request.query as any;
      const status = await getJobStatus(params.jobId, queue || 'market-refresh');
      if (!status) return reply.code(404).send({ error: 'Job not found', jobId: params.jobId, requestId });
      return enrichJobStatusWithTiming(status);
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Alias for frontend that polls /api/jobs/:id/status
  fastify.get('/api/jobs/:jobId/status', async (request, reply) => {
    const requestId = request.id;
    try {
      const params = z.object({ jobId: z.string().min(1) }).parse(request.params);
      const { queue } = request.query as any;
      const status = await getJobStatus(params.jobId, queue || 'market-refresh');
      if (!status) return reply.code(404).send({ error: 'Job not found', jobId: params.jobId, requestId });
      return enrichJobStatusWithTiming(status);
    } catch (error: any) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Get market refresh status
  fastify.get('/api/markets/:marketId/refresh/status', async (request) => {
    const params = MarketIdParamsSchema.parse(request.params);

    const result = await db.query('SELECT * FROM market_state WHERE market_id = $1', [params.marketId]);
    if (result.rows.length === 0) {
      return { status: 'not_started' };
    }

    const state = result.rows[0];
    return {
      status: state.last_error ? 'error' : (state.last_success_at ? 'completed' : 'in_progress'),
      lastRefreshAt: state.last_refresh_at?.toISOString() || null,
      lastSuccessAt: state.last_success_at?.toISOString() || null,
      lastError: state.last_error || null,
      coverage: state.coverage_counts_json || null,
    };
  });

  // Get market coverage (index vs detail) - NEW INDEX+DELTA VISIBILITY
  fastify.get('/api/markets/:marketId/coverage', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);

      const coverageResult = await db.query(`
      SELECT 
        COUNT(*) as total_trials,
        COUNT(*) FILTER (WHERE index_json IS NOT NULL) as index_coverage,
        COUNT(*) FILTER (WHERE detail_json IS NOT NULL) as detail_coverage,
        COUNT(*) FILTER (WHERE index_json IS NOT NULL AND detail_json IS NOT NULL) as full_coverage,
        MAX(fetched_at) as last_index_fetch,
        MAX(detail_fetched_at) as last_detail_fetch
      FROM trials t
      JOIN market_trials mt ON t.nct_id = mt.nct_id
      WHERE mt.market_id = $1
    `, [params.marketId]);

      const coverage = coverageResult.rows[0] || {};

      const totalTrials = parseInt(coverage.total_trials || '0', 10);
      const indexCoverage = parseInt(coverage.index_coverage || '0', 10);
      const detailCoverage = parseInt(coverage.detail_coverage || '0', 10);
      const fullCoverage = parseInt(coverage.full_coverage || '0', 10);

      const indexPercent = totalTrials > 0 ? Math.round((indexCoverage / totalTrials) * 100) : 0;
      const detailPercent = totalTrials > 0 ? Math.round((detailCoverage / totalTrials) * 100) : 0;

      return {
        marketId: params.marketId,
        totalTrials,
        coverage: {
          index: {
            count: indexCoverage,
            percent: indexPercent,
            lastFetch: coverage.last_index_fetch?.toISOString() || null,
          },
          detail: {
            count: detailCoverage,
            percent: detailPercent,
            lastFetch: coverage.last_detail_fetch?.toISOString() || null,
            inProgress: indexCoverage > detailCoverage, // If index > detail, detail fetch is in progress
          },
          full: {
            count: fullCoverage,
          },
        },
        message: indexPercent === 100 && detailPercent === 100
          ? 'Full market coverage complete'
          : indexPercent === 100 && detailPercent < 100
            ? `Index complete (${indexPercent}%), detail fetch in progress (${detailPercent}%)`
            : `Index fetch in progress (${indexPercent}%, detail: ${detailPercent}%)`,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Coverage error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Alzheimer's market endpoints (simplified paths)
  const ALZHEIMERS_MARKET_ID = 'market_alzheimers_phase23';

  fastify.get('/api/market/alzheimers/sponsors', async (request) => {
    const cacheKey = buildCacheKey(['market', 'alzheimers', 'sponsors']);

    return getOrSetJson(
      cacheKey,
      async () => {
        const result = await db.query(`
        SELECT msr.*, s.name as sponsor_name
        FROM mv_market_sponsor_rollup msr
        JOIN sponsors s ON msr.sponsor_id = s.id
        WHERE msr.market_id = $1
        ORDER BY msr.pressure_score DESC
        LIMIT 200
      `, [ALZHEIMERS_MARKET_ID]);

        return {
          sponsors: result.rows.map(row => ({
            sponsorId: row.sponsor_id,
            sponsorName: row.sponsor_name,
            pressureScore: row.pressure_score,
            phase3Active: row.phase3_active_count,
            phase2Active: row.phase2_active_count,
            totalActive: row.total_active_count,
            medianEnrollment: row.median_enrollment,
            countriesCount: row.countries_count,
            burdenScore: row.burden_score,
            lastUpdate: row.last_trial_update_date?.toISOString() || null,
            whyNow: row.why_now_snippet,
            evidenceLinkCount: row.evidence_link_count,
          })),
          indication: "Alzheimer's",
          phaseRange: "Phase II-III",
        };
      },
      { ttlSeconds: 600 }
    );
  });

  // Market scan search: filter by region, country, city, university, molecule, phases, NCT, sponsor, contact person(s)
  const MARKET_SEARCH_REGIONS: Record<string, string[]> = {
    nordic: ['Denmark', 'Finland', 'Iceland', 'Norway', 'Sweden'],
    eu: ['Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden'],
  };

  fastify.get('/api/market/alzheimers/search', async (request, reply) => {
    const requestId = request.id;
    try {
      const q = request.query as Record<string, string | undefined>;
      const region = (q.region || '').trim().toLowerCase();
      const country = (q.country || '').trim();
      const city = (q.city || '').trim();
      const university = (q.university || '').trim();
      const molecule = (q.molecule || '').trim();
      const phases = (q.phases || '').trim();
      const nct = (q.nct || '').trim();
      const sponsor = (q.sponsor || '').trim();
      const contactPerson = (q.contactPerson || '').trim();
      const limit = Math.min(parseInt(q.limit || '200', 10) || 200, 500);

      let sql = `
      SELECT DISTINCT
        t.nct_id,
        t.sponsor_id,
        s.name as sponsor_name,
        COALESCE(t.index_json->>'interventionsText', t.payload_json->>'interventionsText') as molecule,
        COALESCE(t.index_json->>'phase', t.payload_json->>'phase') as phase,
        COALESCE(t.index_json->>'status', t.payload_json->>'status') as status,
        tl.country_name,
        t.detail_json->'locations' as locations
      FROM market_trials mt
      JOIN trials t ON mt.nct_id = t.nct_id
      JOIN sponsors s ON t.sponsor_id = s.id
      LEFT JOIN trial_locations tl ON t.nct_id = tl.nct_id
    `;
      const params: any[] = [ALZHEIMERS_MARKET_ID];
      let paramIndex = 1;
      const conditions: string[] = ['mt.market_id = $1'];

      if (nct) {
        paramIndex += 1;
        conditions.push(`t.nct_id ILIKE $${paramIndex}`);
        params.push(`%${nct}%`);
      }
      if (sponsor) {
        paramIndex += 1;
        conditions.push(`s.name ILIKE $${paramIndex}`);
        params.push(`%${sponsor}%`);
      }
      if (molecule) {
        paramIndex += 1;
        conditions.push(`(t.index_json->>'interventionsText' ILIKE $${paramIndex} OR t.payload_json->>'interventionsText' ILIKE $${paramIndex})`);
        params.push(`%${molecule}%`);
      }
      if (phases) {
        const phaseList = phases.split(/[\s,]+/).filter(Boolean).map(p => p.replace(/^phase\s*/i, 'Phase '));
        if (phaseList.length > 0) {
          paramIndex += 1;
          conditions.push(`(COALESCE(t.index_json->>'phase', t.payload_json->>'phase') ILIKE ANY($${paramIndex}))`);
          params.push(phaseList.map(p => `%${p}%`));
        }
      }
      if (country) {
        paramIndex += 1;
        conditions.push(`tl.country_name ILIKE $${paramIndex}`);
        params.push(`%${country}%`);
      }
      if (region && MARKET_SEARCH_REGIONS[region]) {
        const countries = MARKET_SEARCH_REGIONS[region];
        paramIndex += 1;
        conditions.push(`tl.country_name = ANY($${paramIndex})`);
        params.push(countries);
      }

      sql += ` WHERE ${conditions.join(' AND ')}`;
      params.push(limit);
      sql += ` ORDER BY t.nct_id LIMIT $${paramIndex + 1}`;

      const result = await db.query(sql, params);
      const nctIds = [...new Set(result.rows.map((r: any) => r.nct_id))];

      let contactMap: Record<string, string[]> = {};
      if (contactPerson && nctIds.length > 0) {
        const sponsorIds = [...new Set(result.rows.map((r: any) => r.sponsor_id))];
        const contactResult = await db.query(`
        SELECT sponsor_id, full_name
        FROM contact_candidates
        WHERE market_id = $1 AND sponsor_id = ANY($2) AND full_name ILIKE $3
      `, [ALZHEIMERS_MARKET_ID, sponsorIds, `%${contactPerson}%`]);
        for (const row of contactResult.rows as any[]) {
          if (!contactMap[row.sponsor_id]) contactMap[row.sponsor_id] = [];
          contactMap[row.sponsor_id].push(row.full_name || '');
        }
      } else if (nctIds.length > 0 && result.rows.length > 0) {
        const sponsorIds = [...new Set(result.rows.map((r: any) => r.sponsor_id))];
        const contactResult = await db.query(`
        SELECT sponsor_id, full_name
        FROM contact_candidates
        WHERE market_id = $1 AND sponsor_id = ANY($2)
      `, [ALZHEIMERS_MARKET_ID, sponsorIds]);
        for (const row of contactResult.rows as any[]) {
          if (!contactMap[row.sponsor_id]) contactMap[row.sponsor_id] = [];
          contactMap[row.sponsor_id].push(row.full_name || '');
        }
      }

      const byNct = new Map<string, { nctId: string; sponsorId: string; sponsorName: string; molecule: string; phase: string; status: string; countries: string[]; cities: string[]; universities: string[]; contactPersons: string[] }>();
      for (const row of result.rows as any[]) {
        const key = row.nct_id;
        if (!byNct.has(key)) {
          const locations = row.locations;
          const cities: string[] = [];
          const universities: string[] = [];
          if (Array.isArray(locations)) {
            for (const loc of locations) {
              if (loc.city) cities.push(loc.city);
              if (loc.facility || loc.facility_name) universities.push(loc.facility || loc.facility_name);
            }
          }
          let include = true;
          if (city) {
            if (cities.length === 0 || !cities.some((c: string) => (c || '').toLowerCase().includes(city.toLowerCase()))) include = false;
          }
          if (university) {
            if (universities.length === 0 || !universities.some((u: string) => (u || '').toLowerCase().includes(university.toLowerCase()))) include = false;
          }
          if (contactPerson && (!contactMap[row.sponsor_id] || contactMap[row.sponsor_id].length === 0)) include = false;
          if (!include) continue;

          byNct.set(key, {
            nctId: row.nct_id,
            sponsorId: row.sponsor_id,
            sponsorName: row.sponsor_name,
            molecule: row.molecule || '',
            phase: row.phase || '',
            status: row.status || '',
            countries: [],
            cities: [...new Set(cities)],
            universities: [...new Set(universities)],
            contactPersons: contactMap[row.sponsor_id] || [],
          });
        }
        const rec = byNct.get(key)!;
        if (row.country_name && !rec.countries.includes(row.country_name)) rec.countries.push(row.country_name);
      }

      const trials = Array.from(byNct.values()).slice(0, limit);
      return { trials, total: trials.length };
    } catch (error: any) {
      fastify.log.error({ requestId, error: error.message }, 'Market search error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  fastify.get('/api/market/alzheimers/programs', async (request) => {
    const cacheKey = buildCacheKey(['market', 'alzheimers', 'programs']);

    return getOrSetJson(
      cacheKey,
      async () => {
        const result = await db.query(`
        SELECT
          t.payload_json->>'interventionsText' as molecule,
          t.payload_json->>'phase' as phase,
          t.sponsor_id,
          s.name as sponsor_name,
          COUNT(*) as trial_count,
          COUNT(*) FILTER (WHERE t.payload_json->>'status' LIKE '%Recruiting%') as active_count,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (t.payload_json->>'enrollment')::int) FILTER (WHERE (t.payload_json->>'enrollment')::int > 0) as median_enrollment,
          COUNT(DISTINCT tl.country_code) as countries_count
        FROM market_trials mt
        JOIN trials t ON mt.nct_id = t.nct_id
        LEFT JOIN sponsors s ON t.sponsor_id = s.id
        LEFT JOIN trial_locations tl ON t.nct_id = tl.nct_id
        WHERE mt.market_id = $1
          AND t.payload_json->>'interventionsText' IS NOT NULL
          AND t.payload_json->>'interventionsText' != ''
        GROUP BY t.payload_json->>'interventionsText', t.payload_json->>'phase', t.sponsor_id, s.name
        ORDER BY trial_count DESC, active_count DESC
        LIMIT 200
      `, [ALZHEIMERS_MARKET_ID]);

        return {
          programs: result.rows.map(row => ({
            programKey: `${row.molecule}_${row.sponsor_id}`,
            molecule: row.molecule,
            sponsorId: row.sponsor_id,
            sponsorName: row.sponsor_name,
            phase: row.phase,
            trialCount: parseInt(row.trial_count, 10),
            activeCount: parseInt(row.active_count, 10),
            medianEnrollment: row.median_enrollment ? parseInt(row.median_enrollment, 10) : null,
            countriesCount: parseInt(row.countries_count, 10),
          })),
          indication: "Alzheimer's",
          phaseRange: "Phase II-III",
        };
      },
      { ttlSeconds: 600 }
    );
  });

  fastify.get('/api/market/alzheimers/competitive_peers', async (request) => {
    const { programKey, sponsorId } = request.query as any;

    if (!programKey && !sponsorId) {
      return { error: 'programKey or sponsorId required' };
    }

    const cacheKey = buildCacheKey(['market', 'alzheimers', 'peers', programKey || sponsorId]);

    return getOrSetJson(
      cacheKey,
      async () => {
        // Get target program/sponsor phase
        let targetPhase = 'PHASE3';
        if (programKey) {
          const programResult = await db.query(`
          SELECT t.payload_json->>'phase' as phase
          FROM market_trials mt
          JOIN trials t ON mt.nct_id = t.nct_id
          WHERE mt.market_id = $1
            AND t.payload_json->>'interventionsText' = $2
          LIMIT 1
        `, [ALZHEIMERS_MARKET_ID, programKey.split('_')[0]]);
          if (programResult.rows.length > 0) {
            const phase = programResult.rows[0].phase?.toUpperCase() || '';
            if (phase.includes('PHASE 3') || phase.includes('PHASE III')) targetPhase = 'PHASE3';
            else if (phase.includes('PHASE 2') || phase.includes('PHASE II')) targetPhase = 'PHASE2';
          }
        }

        // Get peer set
        const peerResult = await db.query(`
        SELECT DISTINCT
          t.sponsor_id,
          s.name as sponsor_name,
          t.payload_json->>'interventionsText' as molecule,
          COUNT(*) as trial_count,
          COUNT(*) FILTER (WHERE t.payload_json->>'status' LIKE '%Recruiting%') as active_count
        FROM market_trials mt
        JOIN trials t ON mt.nct_id = t.nct_id
        LEFT JOIN sponsors s ON t.sponsor_id = s.id
        WHERE mt.market_id = $1
          AND t.sponsor_id != COALESCE($2, '')
          AND (
            ($3 = 'PHASE3' AND (t.payload_json->>'phase' LIKE '%Phase 3%' OR t.payload_json->>'phase' LIKE '%Phase III%'))
            OR ($3 = 'PHASE2' AND (t.payload_json->>'phase' LIKE '%Phase 2%' OR t.payload_json->>'phase' LIKE '%Phase II%'))
          )
        GROUP BY t.sponsor_id, s.name, t.payload_json->>'interventionsText'
        ORDER BY active_count DESC, trial_count DESC
        LIMIT 20
      `, [ALZHEIMERS_MARKET_ID, sponsorId || null, targetPhase]);

        return {
          peers: peerResult.rows.map(row => ({
            sponsorId: row.sponsor_id,
            sponsorName: row.sponsor_name,
            molecule: row.molecule,
            trialCount: parseInt(row.trial_count, 10),
            activeCount: parseInt(row.active_count, 10),
          })),
          targetPhase,
          indication: "Alzheimer's",
        };
      },
      { ttlSeconds: 600 }
    );
  });

  fastify.get('/api/market/alzheimers/pressure_scores', async (request) => {
    const cacheKey = buildCacheKey(['market', 'alzheimers', 'pressure_scores']);

    return getOrSetJson(
      cacheKey,
      async () => {
        const result = await db.query(`
        SELECT
          msr.sponsor_id,
          s.name as sponsor_name,
          msr.pressure_score,
          msr.phase3_active_count,
          msr.phase2_active_count,
          msr.total_active_count,
          msr.median_enrollment,
          msr.countries_count,
          msr.burden_score
        FROM mv_market_sponsor_rollup msr
        JOIN sponsors s ON msr.sponsor_id = s.id
        WHERE msr.market_id = $1
        ORDER BY msr.pressure_score DESC
      `, [ALZHEIMERS_MARKET_ID]);

        return {
          scores: result.rows.map(row => ({
            sponsorId: row.sponsor_id,
            sponsorName: row.sponsor_name,
            pressureScore: row.pressure_score,
            contributors: {
              phase3Active: row.phase3_active_count,
              totalActive: row.total_active_count,
              countries: row.countries_count,
              enrollment: row.median_enrollment,
              burden: row.burden_score,
            },
          })),
          indication: "Alzheimer's",
          phaseRange: "Phase II-III",
        };
      },
      { ttlSeconds: 600 }
    );
  });

  fastify.get('/api/market/alzheimers/benchmarks', async (request) => {
    const cacheKey = buildCacheKey(['market', 'alzheimers', 'benchmarks']);

    return getOrSetJson(
      cacheKey,
      async () => {
        const result = await db.query(`
        SELECT
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY phase3_active_count) as median_phase3_active,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_active_count) as median_total_active,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY median_enrollment) FILTER (WHERE median_enrollment > 0) as median_enrollment,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY countries_count) as median_countries,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY burden_score) as median_burden,
          AVG(phase3_active_count)::int as avg_phase3_active,
          AVG(total_active_count)::int as avg_total_active,
          COUNT(*) as sponsor_count
        FROM mv_market_sponsor_rollup
        WHERE market_id = $1
      `, [ALZHEIMERS_MARKET_ID]);

        const row = result.rows[0] || {};

        return {
          benchmarks: {
            medians: {
              phase3Active: parseInt(row.median_phase3_active || '0', 10),
              totalActive: parseInt(row.median_total_active || '0', 10),
              enrollment: parseInt(row.median_enrollment || '0', 10),
              countries: parseInt(row.median_countries || '0', 10),
              burden: parseInt(row.median_burden || '0', 10),
            },
            averages: {
              phase3Active: parseInt(row.avg_phase3_active || '0', 10),
              totalActive: parseInt(row.avg_total_active || '0', 10),
            },
            marketSize: {
              sponsorCount: parseInt(row.sponsor_count || '0', 10),
            },
          },
          indication: "Alzheimer's",
          phaseRange: "Phase II-III",
        };
      },
      { ttlSeconds: 600 }
    );
  });

  // Refresh Alzheimer's market
  fastify.post('/api/market/alzheimers/refresh', async (request, reply) => {
    const requestId = request.id;

    try {
      const { phaseRange, quick } = request.body as any;
      const quickMode = quick === true || quick === 'true' || quick === '1';

      // Use the default market ID
      const jobId = await enqueueMarketRefresh(ALZHEIMERS_MARKET_ID, quickMode);

      fastify.log.info({ requestId, marketId: ALZHEIMERS_MARKET_ID, jobId, quickMode }, 'Alzheimer market refresh job enqueued');

      return reply.code(202).send({
        status: 'accepted',
        message: quickMode
          ? 'Alzheimer\'s market quick refresh job started (200 studies, ~2-3 min)'
          : 'Alzheimer\'s market full refresh job started (1000 studies, ~15+ min)',
        indication: "Alzheimer Disease",
        phaseRange: phaseRange || ['PHASE2', 'PHASE23', 'PHASE3'],
        quickMode,
        jobId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      fastify.log.error({ requestId, error: error.message }, 'Failed to enqueue refresh');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Analysis endpoints
  fastify.get('/api/markets/:marketId/viz/market-map', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);
      const cacheKey = buildCacheKey(['analysis', params.marketId, 'market-map']);

      return getOrSetJson(
        cacheKey,
        async () => {
          // Get latest analysis output
          const result = await db.query(`
          SELECT ao.payload_json
          FROM analysis_outputs ao
          JOIN analysis_runs ar ON ao.run_id = ar.id
          WHERE ar.market_id = $1 AND ar.type = 'market-map' AND ar.status = 'completed'
          ORDER BY ar.finished_at DESC
          LIMIT 1
        `, [params.marketId]);

          if (result.rows.length === 0) {
            throw new Error('Analysis not found. Run analysis first.');
          }

          return result.rows[0].payload_json;
        },
        { ttlSeconds: 3600 }
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Analysis error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  fastify.get('/api/markets/:marketId/viz/timeline-race', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);
      const cacheKey = buildCacheKey(['analysis', params.marketId, 'timeline-race']);

      return getOrSetJson(
        cacheKey,
        async () => {
          const result = await db.query(`
          SELECT ao.payload_json
          FROM analysis_outputs ao
          JOIN analysis_runs ar ON ao.run_id = ar.id
          WHERE ar.market_id = $1 AND ar.type = 'timeline-race' AND ar.status = 'completed'
          ORDER BY ar.finished_at DESC
          LIMIT 1
        `, [params.marketId]);

          if (result.rows.length === 0) {
            throw new Error('Analysis not found. Run analysis first.');
          }

          return result.rows[0].payload_json;
        },
        { ttlSeconds: 3600 }
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  fastify.get('/api/markets/:marketId/viz/pressure', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);
      const cacheKey = buildCacheKey(['analysis', params.marketId, 'pressure']);

      return getOrSetJson(
        cacheKey,
        async () => {
          const result = await db.query(`
          SELECT ao.payload_json
          FROM analysis_outputs ao
          JOIN analysis_runs ar ON ao.run_id = ar.id
          WHERE ar.market_id = $1 AND ar.type = 'pressure' AND ar.status = 'completed'
          ORDER BY ar.finished_at DESC
          LIMIT 1
        `, [params.marketId]);

          if (result.rows.length === 0) {
            throw new Error('Analysis not found. Run analysis first.');
          }

          return result.rows[0].payload_json;
        },
        { ttlSeconds: 3600 }
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  fastify.get('/api/markets/:marketId/viz/risks', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);
      const cacheKey = buildCacheKey(['analysis', params.marketId, 'risks']);

      return getOrSetJson(
        cacheKey,
        async () => {
          const result = await db.query(`
          SELECT ao.payload_json
          FROM analysis_outputs ao
          JOIN analysis_runs ar ON ao.run_id = ar.id
          WHERE ar.market_id = $1 AND ar.type = 'risks' AND ar.status = 'completed'
          ORDER BY ar.finished_at DESC
          LIMIT 1
        `, [params.marketId]);

          if (result.rows.length === 0) {
            throw new Error('Analysis not found. Run analysis first.');
          }

          return result.rows[0].payload_json;
        },
        { ttlSeconds: 3600 }
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Signals endpoint (placeholder - would compute from market data)
  fastify.get('/api/signals', async (request, reply) => {
    const requestId = request.id;

    try {
      const cacheKey = buildCacheKey(['signals', 'all']);

      return getOrSetJson(
        cacheKey,
        async () => {
          // TODO: Implement actual signal detection from market data
          // For now, return empty array
          return {
            signals: [],
            lastUpdated: new Date().toISOString(),
          };
        },
        { ttlSeconds: 300 }
      );
    } catch (error: any) {
      fastify.log.error({ requestId, error: error.message }, 'Signals error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Trigger analysis
  fastify.post('/api/markets/:marketId/analyze', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);
      const { type, params: analysisParams } = request.body as any;

      if (!type || !['market-map', 'timeline-race', 'pressure', 'risks'].includes(type)) {
        return reply.code(400).send({ error: 'Invalid analysis type', requestId });
      }

      const { enqueueAnalysis } = await import('./queue/queue');
      const jobId = await enqueueAnalysis(params.marketId, type, analysisParams);

      fastify.log.info({ requestId, marketId: params.marketId, type, jobId }, 'Analysis job enqueued');

      return reply.code(202).send({
        status: 'accepted',
        jobId,
        marketId: params.marketId,
        type,
        message: 'Analysis job enqueued',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Failed to enqueue analysis');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Search by NCT ID
  fastify.get('/api/search/nct/:nctId', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = z.object({
        nctId: z.string().min(1),
      }).parse(request.params);

      const nctId = params.nctId.toUpperCase();
      const cacheKey = buildCacheKey(['search', 'nct', nctId]);

      return getOrSetJson(
        cacheKey,
        async () => {
          const result = await db.query(`
          SELECT 
            t.*,
            s.name as sponsor_name,
            s.id as sponsor_id,
            tm.start_date,
            tm.primary_completion_date,
            tm.completion_date,
            tm.enrollment,
            tm.endpoints_text,
            tm.eligibility_criteria,
            tf.has_pet,
            tf.has_mri,
            tf.has_infusion,
            tf.mentions_aria,
            tf.has_biomarker,
            tf.route_enum,
            tf.burden_score
          FROM trials t
          LEFT JOIN sponsors s ON t.sponsor_id = s.id
          LEFT JOIN trial_metadata tm ON t.nct_id = tm.nct_id
          LEFT JOIN trial_flags tf ON t.nct_id = tf.nct_id
          WHERE t.nct_id = $1
        `, [nctId]);

          if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Trial not found', nctId, requestId });
          }

          const trial = result.rows[0];
          const payload = trial.payload_json || {};

          // Get locations
          const locationsResult = await db.query(`
          SELECT country_code, country_name
          FROM trial_locations
          WHERE nct_id = $1
        `, [nctId]);

          return {
            nctId: trial.nct_id,
            title: payload.title || payload.BriefTitle || 'Unknown',
            status: payload.status || payload.OverallStatus || 'Unknown',
            phase: payload.phase || payload.Phase || 'Unknown',
            sponsor: trial.sponsor_name,
            sponsorId: trial.sponsor_id,
            enrollment: trial.enrollment,
            startDate: trial.start_date?.toISOString(),
            primaryCompletionDate: trial.primary_completion_date?.toISOString(),
            completionDate: trial.completion_date?.toISOString(),
            conditions: payload.conditions || payload.Condition || [],
            interventions: payload.interventionsText || (payload.InterventionName || []).join(', '),
            endpoints: trial.endpoints_text,
            eligibility: trial.eligibility_criteria,
            locations: locationsResult.rows.map(row => ({
              countryCode: row.country_code,
              countryName: row.country_name,
            })),
            flags: {
              pet: trial.has_pet,
              mri: trial.has_mri,
              infusion: trial.has_infusion,
              aria: trial.mentions_aria,
              biomarker: trial.has_biomarker,
              route: trial.route_enum,
              burdenScore: trial.burden_score,
            },
            ctgovUrl: `https://clinicaltrials.gov/study/${nctId}`,
          };
        },
        { ttlSeconds: 3600 }
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'NCT search error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Search by molecule
  fastify.get('/api/search/molecule', async (request, reply) => {
    const requestId = request.id;

    try {
      const { q } = request.query as any;
      if (!q || q.trim().length < 2) {
        return { query: q, trials: [], programs: [] };
      }

      const cacheKey = buildCacheKey(['search', 'molecule', q]);

      return getOrSetJson(
        cacheKey,
        async () => {
          // Search trials by intervention text
          const trialsResult = await db.query(`
          SELECT DISTINCT
            t.nct_id,
            t.payload_json->>'title' as title,
            t.payload_json->>'status' as status,
            t.payload_json->>'phase' as phase,
            s.name as sponsor_name,
            t.sponsor_id,
            tm.enrollment
          FROM trials t
          LEFT JOIN sponsors s ON t.sponsor_id = s.id
          LEFT JOIN trial_metadata tm ON t.nct_id = tm.nct_id
          WHERE t.payload_json->>'interventionsText' ILIKE $1
             OR EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(t.payload_json->'InterventionName') AS intervention
               WHERE intervention ILIKE $1
             )
          ORDER BY 
            CASE WHEN t.payload_json->>'status' LIKE '%Recruiting%' THEN 1 ELSE 2 END,
            t.payload_json->>'phase' DESC
          LIMIT 50
        `, [`%${q}%`]);

          // Group by sponsor/program
          const programsResult = await db.query(`
          SELECT DISTINCT
            t.sponsor_id,
            s.name as sponsor_name,
            t.payload_json->>'interventionsText' as molecule,
            COUNT(*) as trial_count,
            COUNT(*) FILTER (WHERE t.payload_json->>'status' LIKE '%Recruiting%') as active_count,
            COUNT(*) FILTER (WHERE t.payload_json->>'phase' LIKE '%Phase 3%' OR t.payload_json->>'phase' LIKE '%Phase III%') as phase3_count
          FROM trials t
          LEFT JOIN sponsors s ON t.sponsor_id = s.id
          WHERE t.payload_json->>'interventionsText' ILIKE $1
             OR EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(t.payload_json->'InterventionName') AS intervention
               WHERE intervention ILIKE $1
             )
          GROUP BY t.sponsor_id, s.name, t.payload_json->>'interventionsText'
          ORDER BY trial_count DESC, active_count DESC
          LIMIT 20
        `, [`%${q}%`]);

          return {
            query: q,
            trials: trialsResult.rows.map(row => ({
              nctId: row.nct_id,
              title: row.title,
              status: row.status,
              phase: row.phase,
              sponsor: row.sponsor_name,
              sponsorId: row.sponsor_id,
              enrollment: row.enrollment,
            })),
            programs: programsResult.rows.map(row => ({
              sponsorId: row.sponsor_id,
              sponsorName: row.sponsor_name,
              molecule: row.molecule,
              trialCount: parseInt(row.trial_count, 10),
              activeCount: parseInt(row.active_count, 10),
              phase3Count: parseInt(row.phase3_count, 10),
            })),
          };
        },
        { ttlSeconds: 300 }
      );
    } catch (error: any) {
      fastify.log.error({ requestId, error: error.message }, 'Molecule search error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Search by sponsor (enhanced)
  fastify.get('/api/search/sponsor', async (request, reply) => {
    const requestId = request.id;

    try {
      const { q } = request.query as any;
      if (!q || q.trim().length < 2) {
        return { sponsors: [] };
      }

      const cacheKey = buildCacheKey(['search', 'sponsor', q]);

      return getOrSetJson(
        cacheKey,
        async () => {
          const result = await db.query(`
          SELECT 
            s.id,
            s.name,
            COUNT(DISTINCT t.nct_id) as trial_count,
            COUNT(DISTINCT t.payload_json->>'interventionsText') FILTER (WHERE t.payload_json->>'interventionsText' IS NOT NULL) as program_count,
            COUNT(DISTINCT t.nct_id) FILTER (WHERE t.payload_json->>'status' LIKE '%Recruiting%') as active_trial_count
          FROM sponsors s
          LEFT JOIN trials t ON s.id = t.sponsor_id
          WHERE s.name ILIKE $1
          GROUP BY s.id, s.name
          ORDER BY trial_count DESC, s.name
          LIMIT 20
        `, [`%${q}%`]);

          return {
            query: q,
            sponsors: result.rows.map(row => ({
              id: row.id,
              name: row.name,
              trialCount: parseInt(row.trial_count, 10),
              programCount: parseInt(row.program_count, 10),
              activeTrialCount: parseInt(row.active_trial_count, 10),
            })),
          };
        },
        { ttlSeconds: 300 }
      );
    } catch (error: any) {
      fastify.log.error({ requestId, error: error.message }, 'Sponsor search error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Legacy endpoint (keep for compatibility)
  fastify.get('/api/sponsors/search', async (request) => {
    const { q } = request.query as any;

    if (!q) {
      return { sponsors: [] };
    }

    const result = await db.query(`
    SELECT 
      s.id,
      s.name,
      COUNT(DISTINCT t.nct_id) as trial_count,
      COUNT(DISTINCT t.payload_json->>'interventionsText') FILTER (WHERE t.payload_json->>'interventionsText' IS NOT NULL) as program_count,
      COUNT(DISTINCT t.nct_id) FILTER (WHERE t.payload_json->>'status' LIKE '%Recruiting%') as active_trial_count
    FROM sponsors s
    LEFT JOIN trials t ON s.id = t.sponsor_id
    WHERE s.name ILIKE $1
    GROUP BY s.id, s.name
    ORDER BY trial_count DESC, s.name
    LIMIT 20
  `, [`%${q}%`]);

    return {
      query: q,
      sponsors: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        trialCount: parseInt(row.trial_count, 10),
        programCount: parseInt(row.program_count, 10),
        activeTrialCount: parseInt(row.active_trial_count, 10),
      })),
    };
  });


  // Get regions for a market
  fastify.get('/api/markets/:marketId/regions', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);
      const cacheKey = buildCacheKey(['markets', params.marketId, 'regions']);

      const regions = await getOrSetJson(
        cacheKey,
        async () => {
          const result = await db.query(`
          SELECT 
            r.id as region_id,
            r.code,
            r.name,
            rr.final_attractiveness_score,
            rr.score_breakdown_json,
            rr.computed_at
          FROM regions r
          LEFT JOIN region_rollups rr ON r.id = rr.region_id AND rr.market_id = $1
          ORDER BY rr.final_attractiveness_score DESC NULLS LAST, r.code
        `, [params.marketId]);

          return result.rows.map(row => {
            const breakdown = row.score_breakdown_json || {};
            const entryPhaseBucket = row.final_attractiveness_score
              ? (row.final_attractiveness_score >= 70 ? 'Monitor' : row.final_attractiveness_score >= 50 ? 'Phase 2' : 'Phase 1')
              : null;

            return {
              regionId: row.region_id,
              code: row.code,
              name: row.name,
              finalAttractivenessScore: row.final_attractiveness_score ? parseFloat(row.final_attractiveness_score) : null,
              entryPhaseBucket,
              topDrivers: breakdown.topDrivers || [],
              computedAt: row.computed_at?.toISOString() || null,
            };
          });
        },
        { ttlSeconds: 600 }
      );

      return { regions, marketId: params.marketId };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Regions query error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Get region detail
  fastify.get('/api/markets/:marketId/regions/:regionId', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = z.object({
        marketId: z.string().min(1),
        regionId: z.string().min(1),
      }).parse(request.params);

      const cacheKey = buildCacheKey(['markets', params.marketId, 'regions', params.regionId]);

      const regionDetail = await getOrSetJson(
        cacheKey,
        async () => {
          // Get region rollup
          const rollupResult = await db.query(`
          SELECT 
            rr.*,
            r.code,
            r.name,
            r.countries
          FROM region_rollups rr
          JOIN regions r ON rr.region_id = r.id
          WHERE rr.market_id = $1 AND rr.region_id = $2
        `, [params.marketId, params.regionId]);

          if (rollupResult.rows.length === 0) {
            throw new Error('Region not found for market');
          }

          const rollup = rollupResult.rows[0];

          // Get top 10 sponsor targets in this region
          const sponsorsResult = await db.query(`
          SELECT DISTINCT
            t.sponsor_id,
            s.name as sponsor_name,
            COUNT(DISTINCT mt.nct_id) as active_trials,
            MAX(msr.pressure_score) as pressure_score
          FROM market_trials mt
          JOIN trials t ON mt.nct_id = t.nct_id
          JOIN trial_locations tl ON mt.nct_id = tl.nct_id
          JOIN sponsors s ON t.sponsor_id = s.id
          LEFT JOIN mv_market_sponsor_rollup msr ON msr.market_id = $1 AND msr.sponsor_id = t.sponsor_id
          WHERE mt.market_id = $1
            AND tl.country_code = ANY($2)
            AND t.payload_json->>'status' LIKE '%Recruiting%'
            AND (
              t.payload_json->>'phase' LIKE '%Phase 2%' OR
              t.payload_json->>'phase' LIKE '%Phase 3%' OR
              t.payload_json->>'phase' LIKE '%Phase II%' OR
              t.payload_json->>'phase' LIKE '%Phase III%'
            )
          GROUP BY t.sponsor_id, s.name
          ORDER BY pressure_score DESC NULLS LAST, active_trials DESC
          LIMIT 10
        `, [params.marketId, rollup.countries]);

          const sponsors = sponsorsResult.rows.map(row => ({
            sponsorId: row.sponsor_id,
            sponsorName: row.sponsor_name,
            pressureScore: row.pressure_score ? parseInt(row.pressure_score, 10) : null,
            activeTrials: parseInt(row.active_trials, 10),
            recommendedPersona: row.pressure_score >= 70 ? 'High Priority' : row.pressure_score >= 50 ? 'Medium Priority' : 'Monitor',
          }));

          const finalScore = parseFloat(rollup.final_attractiveness_score || '0');
          const entryPhaseBucket = finalScore >= 70 ? 'Monitor' : finalScore >= 50 ? 'Phase 2' : 'Phase 1';

          return {
            regionId: params.regionId,
            regionCode: rollup.code,
            regionName: rollup.name,
            marketId: params.marketId,
            entryPhaseBucket,
            scores: {
              finalAttractivenessScore: finalScore,
              clinicalActivity: parseFloat(rollup.clinical_activity_score || '0'),
              growth: parseFloat(rollup.growth_score || '0'),
              burden: parseFloat(rollup.burden_score || '0'),
              competition: parseFloat(rollup.competition_score || '0'),
              sales: parseFloat(rollup.sales_score || '0'),
              signal: parseFloat(rollup.signal_score || '0'),
            },
            metrics: {
              activePhase23Trials: rollup.active_phase23_trials,
              growthRate12m: parseFloat(rollup.growth_rate_12m || '0'),
              medianEnrollment: rollup.median_enrollment,
              monitoringBurdenScore: parseFloat(rollup.monitoring_burden_score || '0'),
              competitorSaturation: parseFloat(rollup.competitor_saturation || '0'),
              salesReadinessScore: parseFloat(rollup.sales_readiness_score || '0'),
            },
            scoreBreakdown: rollup.score_breakdown_json || {},
            sponsorTargets: sponsors,
            computedAt: rollup.computed_at?.toISOString() || null,
          };
        },
        { ttlSeconds: 600 }
      );

      return regionDetail;
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Region detail error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Trigger region attractiveness computation
  fastify.post('/api/markets/:marketId/regions/compute', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);

      const jobId = await enqueueRegionAttractiveness(params.marketId);

      fastify.log.info({ requestId, marketId: params.marketId, jobId }, 'Region attractiveness computation job enqueued');

      return reply.code(202).send({
        status: 'accepted',
        jobId,
        marketId: params.marketId,
        message: 'Region attractiveness computation job enqueued',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Failed to enqueue job');
      return reply.code(500).send({ error: 'Failed to enqueue job', requestId });
    }
  });

  // Get sponsor summary (legacy endpoint)
  fastify.get('/api/sponsors/:sponsorId/summary', async (request) => {
    const { sponsorId } = request.params as any;

    const cacheKey = buildCacheKey(['sponsor-summary', sponsorId]);

    return getOrSetJson(
      cacheKey,
      async () => {
        const result = await db.query(`
        SELECT ps.payload_json, ps.created_at, p.id as program_id, p.molecule, p.indication, p.phase, s.name as sponsor_name
        FROM program_snapshots ps
        JOIN programs p ON ps.program_id = p.id
        JOIN sponsors s ON p.sponsor_id = s.id
        WHERE s.id = $1
        ORDER BY ps.created_at DESC
        LIMIT 1
      `, [sponsorId]);

        if (result.rows.length === 0) {
          throw new Error('No summary found for sponsor');
        }

        const row = result.rows[0];
        const summary = {
          ...row.payload_json,
          sponsorName: row.sponsor_name,
          programName: row.molecule,
          indication: row.indication,
          phase: row.phase,
          lastUpdatedISO: row.created_at.toISOString(),
        };

        return ProgramSummarySchema.parse(summary);
      },
      { ttlSeconds: 300 }
    );
  });

  // Refresh program (legacy)
  fastify.post('/api/refresh', async (request, reply) => {
    const requestId = request.id;
    const { sponsorId, programId, sponsorName, moleculeName } = request.body as any;

    if (programId) {
      const jobId = await enqueueProgramRefresh(programId);
      return reply.code(202).send({ status: 'accepted', jobId, message: 'Program refresh job enqueued' });
    } else if (sponsorId) {
      const jobId = await enqueueSponsorRefresh(sponsorId);
      return reply.code(202).send({ status: 'accepted', jobId, message: 'Sponsor refresh job enqueued' });
    }

    return reply.code(400).send({ error: 'sponsorId or programId required' });
  });

  // Briefs endpoints
  fastify.get('/api/briefs', async (request) => {
    const { sponsorId } = request.query as any;

    let query = 'SELECT id, program_id, created_at, payload_json FROM briefs';
    const params: any[] = [];

    if (sponsorId) {
      query += ' JOIN programs p ON briefs.program_id = p.id WHERE p.sponsor_id = $1';
      params.push(sponsorId);
    }

    query += ' ORDER BY created_at DESC LIMIT 50';

    const result = await db.query(query, params);

    return {
      briefs: result.rows.map(row => ({
        id: row.id,
        programId: row.program_id,
        createdAt: row.created_at.toISOString(),
        ...row.payload_json,
      })),
    };
  });

  fastify.post('/api/briefs', async (request) => {
    const body = request.body as any;

    const briefId = `brief_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.query(
      'INSERT INTO briefs (id, program_id, created_at, payload_json) VALUES ($1, $2, NOW(), $3)',
      [briefId, body.programId || null, JSON.stringify(body.content)]
    );

    return {
      id: briefId,
      ...body,
      createdAt: new Date().toISOString(),
    };
  });

  // ===========================================
  // PUBMED LITERATURE ENDPOINTS
  // ===========================================

  // Get literature for a sponsor (searches by their molecules)
  fastify.get('/api/markets/:marketId/sponsors/:sponsorId/literature', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = z.object({
        marketId: z.string().min(1),
        sponsorId: z.string().min(1),
      }).parse(request.params);

      const query = z.object({
        recencyDays: z.coerce.number().int().min(30).max(1095).default(365),
        maxResults: z.coerce.number().int().min(10).max(200).default(100),
      }).parse(request.query);

      const cacheKey = buildCacheKey(['literature', params.marketId, params.sponsorId, `${query.recencyDays}-${query.maxResults}`]);

      return getOrSetJson(
        cacheKey,
        async () => {
          // Get sponsor name and their molecules
          const sponsorResult = await db.query(`
          SELECT s.name
          FROM sponsors s
          WHERE s.id = $1
        `, [params.sponsorId]);

          if (sponsorResult.rows.length === 0) {
            throw new Error('Sponsor not found');
          }

          const sponsorName = sponsorResult.rows[0].name;

          // Get molecules for this sponsor in this market
          const moleculesResult = await db.query(`
          SELECT DISTINCT
            t.index_json->>'interventionsText' as molecule
          FROM market_trials mt
          JOIN trials t ON mt.nct_id = t.nct_id
          WHERE mt.market_id = $1 AND t.sponsor_id = $2
            AND t.index_json->>'interventionsText' IS NOT NULL
            AND t.index_json->>'interventionsText' != ''
        `, [params.marketId, params.sponsorId]);

          const molecules = moleculesResult.rows
            .map(r => r.molecule)
            .filter(Boolean)
            .slice(0, 5); // Limit to top 5 molecules

          if (molecules.length === 0) {
            return {
              sponsorId: params.sponsorId,
              sponsorName,
              papers: [],
              insights: {
                totalPapers: 0,
                tagBreakdown: {},
                recentPublications: 0,
                topJournals: [],
              },
              searchTerms: [],
              message: 'No molecules found for this sponsor to search literature',
            };
          }

          // Import PubMed search function
          const { searchLiterature } = await import('@app/shared');

          // Search for each molecule and combine results
          const allPapers: any[] = [];
          const searchErrors: string[] = [];

          for (const molecule of molecules) {
            try {
              // Clean molecule name - extract main compound
              const cleanMolecule = molecule
                .split(/[|;,]/)[0]
                .replace(/\([^)]*\)/g, '')
                .trim();

              if (cleanMolecule.length < 3) continue;

              const papers = await searchLiterature(
                cleanMolecule,
                [], // No synonyms for now
                {
                  recencyDays: query.recencyDays,
                  maxResults: Math.floor(query.maxResults / molecules.length)
                }
              );

              // Add molecule context to papers
              papers.forEach(p => {
                (p as any).searchedMolecule = cleanMolecule;
              });

              allPapers.push(...papers);
            } catch (error: any) {
              searchErrors.push(`${molecule}: ${error.message}`);
            }
          }

          // Dedupe by PMID
          const seenPmids = new Set<string>();
          const dedupedPapers = allPapers.filter(p => {
            if (seenPmids.has(p.pmid)) return false;
            seenPmids.add(p.pmid);
            return true;
          });

          // Sort by year descending
          dedupedPapers.sort((a, b) => (b.year || 0) - (a.year || 0));

          // Compute insights
          const tagBreakdown: Record<string, number> = {};
          const journalCounts: Record<string, number> = {};
          const currentYear = new Date().getFullYear();
          let recentCount = 0;

          for (const paper of dedupedPapers) {
            // Count tags
            if (paper.tags) {
              for (const tag of paper.tags) {
                tagBreakdown[tag] = (tagBreakdown[tag] || 0) + 1;
              }
            }

            // Count journals
            if (paper.journal) {
              journalCounts[paper.journal] = (journalCounts[paper.journal] || 0) + 1;
            }

            // Count recent (last 12 months)
            if (paper.year >= currentYear - 1) {
              recentCount++;
            }
          }

          // Get top journals
          const topJournals = Object.entries(journalCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

          // Identify key papers (high relevance score or Phase 3 tags)
          const keyPapers = dedupedPapers
            .filter(p =>
              (p.relevanceScore && p.relevanceScore >= 2) ||
              (p.tags && (p.tags.includes('phase3') || p.tags.includes('efficacy')))
            )
            .slice(0, 10);

          return {
            sponsorId: params.sponsorId,
            sponsorName,
            papers: dedupedPapers.slice(0, query.maxResults),
            keyPapers,
            insights: {
              totalPapers: dedupedPapers.length,
              tagBreakdown,
              recentPublications: recentCount,
              topJournals,
              yearBreakdown: dedupedPapers.reduce((acc: Record<number, number>, p) => {
                if (p.year) acc[p.year] = (acc[p.year] || 0) + 1;
                return acc;
              }, {}),
            },
            searchTerms: molecules,
            searchErrors: searchErrors.length > 0 ? searchErrors : undefined,
            fetchedAt: new Date().toISOString(),
          };
        },
        { ttlSeconds: 3600 } // Cache for 1 hour
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message, stack: error.stack }, 'Literature search error');
      return reply.code(500).send({ error: error.message, stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined, requestId });
    }
  });

  // Search literature by molecule directly
  fastify.get('/api/literature/search', async (request, reply) => {
    const requestId = request.id;

    try {
      const query = z.object({
        q: z.string().min(2),
        synonyms: z.string().optional(),
        recencyDays: z.coerce.number().int().min(30).max(1095).default(365),
        maxResults: z.coerce.number().int().min(10).max(200).default(100),
      }).parse(request.query);

      const cacheKey = buildCacheKey(['literature-search', query.q, `${query.recencyDays}-${query.maxResults}`]);

      return getOrSetJson(
        cacheKey,
        async () => {
          const { searchLiterature } = await import('@app/shared');

          const synonyms = query.synonyms ? query.synonyms.split(',').map(s => s.trim()) : [];

          const papers = await searchLiterature(
            query.q,
            synonyms,
            { recencyDays: query.recencyDays, maxResults: query.maxResults }
          );

          // Compute insights
          const tagBreakdown: Record<string, number> = {};
          const journalCounts: Record<string, number> = {};
          const currentYear = new Date().getFullYear();
          let recentCount = 0;

          for (const paper of papers) {
            if (paper.tags) {
              for (const tag of paper.tags) {
                tagBreakdown[tag] = (tagBreakdown[tag] || 0) + 1;
              }
            }
            if (paper.journal) {
              journalCounts[paper.journal] = (journalCounts[paper.journal] || 0) + 1;
            }
            if (paper.year >= currentYear - 1) {
              recentCount++;
            }
          }

          const topJournals = Object.entries(journalCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

          return {
            query: query.q,
            synonyms,
            papers,
            insights: {
              totalPapers: papers.length,
              tagBreakdown,
              recentPublications: recentCount,
              topJournals,
              yearBreakdown: papers.reduce((acc: Record<number, number>, p) => {
                if (p.year) acc[p.year] = (acc[p.year] || 0) + 1;
                return acc;
              }, {}),
            },
            fetchedAt: new Date().toISOString(),
          };
        },
        { ttlSeconds: 3600 }
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Literature search error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  // Get literature trends for a market
  fastify.get('/api/markets/:marketId/literature/trends', async (request, reply) => {
    const requestId = request.id;

    try {
      const params = MarketIdParamsSchema.parse(request.params);

      const cacheKey = buildCacheKey(['literature-trends', params.marketId]);

      return getOrSetJson(
        cacheKey,
        async () => {
          // Get top molecules in the market
          const moleculesResult = await db.query(`
          SELECT 
            t.index_json->>'interventionsText' as molecule,
            COUNT(DISTINCT t.nct_id) as trial_count
          FROM market_trials mt
          JOIN trials t ON mt.nct_id = t.nct_id
          WHERE mt.market_id = $1
            AND t.index_json->>'interventionsText' IS NOT NULL
            AND t.index_json->>'interventionsText' != ''
          GROUP BY t.index_json->>'interventionsText'
          ORDER BY trial_count DESC
          LIMIT 10
        `, [params.marketId]);

          const { searchLiterature } = await import('@app/shared');

          const moleculeTrends: any[] = [];

          for (const row of moleculesResult.rows.slice(0, 5)) {
            try {
              const cleanMolecule = row.molecule
                .split(/[|;,]/)[0]
                .replace(/\([^)]*\)/g, '')
                .trim();

              if (cleanMolecule.length < 3) continue;

              const papers = await searchLiterature(cleanMolecule, [], { recencyDays: 730, maxResults: 50 });

              // Count by year
              const yearCounts: Record<number, number> = {};
              let efficacyCount = 0;
              let safetyCount = 0;

              for (const paper of papers) {
                if (paper.year) {
                  yearCounts[paper.year] = (yearCounts[paper.year] || 0) + 1;
                }
                if (paper.tags?.includes('efficacy')) efficacyCount++;
                if (paper.tags?.includes('safety')) safetyCount++;
              }

              moleculeTrends.push({
                molecule: cleanMolecule,
                trialCount: parseInt(row.trial_count, 10),
                paperCount: papers.length,
                yearBreakdown: yearCounts,
                efficacyPapers: efficacyCount,
                safetyPapers: safetyCount,
                trend: calculateTrend(yearCounts),
              });
            } catch (error) {
              // Skip molecules that error
            }
          }

          return {
            marketId: params.marketId,
            moleculeTrends,
            fetchedAt: new Date().toISOString(),
          };
        },
        { ttlSeconds: 7200 } // Cache for 2 hours
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid request', details: error.errors, requestId });
      }
      fastify.log.error({ requestId, error: error.message }, 'Literature trends error');
      return reply.code(500).send({ error: error.message, requestId });
    }
  });

  function calculateTrend(yearCounts: Record<number, number>): 'increasing' | 'stable' | 'decreasing' {
    const currentYear = new Date().getFullYear();
    const recentYears = [currentYear, currentYear - 1];
    const olderYears = [currentYear - 2, currentYear - 3];

    const recentAvg = recentYears.reduce((sum, y) => sum + (yearCounts[y] || 0), 0) / 2;
    const olderAvg = olderYears.reduce((sum, y) => sum + (yearCounts[y] || 0), 0) / 2;

    if (recentAvg > olderAvg * 1.2) return 'increasing';
    if (recentAvg < olderAvg * 0.8) return 'decreasing';
    return 'stable';
  }

  const port = parseInt(process.env.API_PORT || '3001', 10);
  const host = '0.0.0.0';

  // Run migrations on startup
  console.log('[API] Running database migrations...');
  try {
    const { migrate } = await import('./db/migrate');
    await migrate();
    console.log('[API] Migrations completed');
  } catch (error) {
    console.error('[API] Migration error:', error);
    // Continue anyway - tables might already exist
  }

  // Initialize market definitions
  console.log('[API] Initializing market definitions...');
  try {
    const { initMarket } = await import('./scripts/initMarket');
    await initMarket();
    console.log('[API] Market definitions initialized');
  } catch (error) {
    console.error('[API] Market init error:', error);
    // Continue anyway - market might already exist
  }

  // ── Investigator Endpoints ────────────────────────────────────────────────

  // GET /api/investigators — list top investigators, sorted by influence score
  fastify.get('/api/investigators', async (request, reply) => {
    try {
      const { limit, minScore, orgId } = request.query as any;
      const { listTopInvestigators } = await import('./investigators');
      const investigators = await listTopInvestigators({
        limit: parseInt(limit, 10) || 50,
        minInfluenceScore: parseInt(minScore, 10) || 0,
        orgId: orgId || undefined,
      });
      return { investigators, total: investigators.length };
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Failed to list investigators');
      return reply.code(500).send({ error: error.message });
    }
  });

  // GET /api/investigators/:personId — full investigator profile
  fastify.get('/api/investigators/:personId', async (request, reply) => {
    const { personId } = request.params as { personId: string };
    try {
      const { getInvestigatorProfile } = await import('./investigators');
      const profile = await getInvestigatorProfile(personId);
      if (!profile) return reply.code(404).send({ error: 'Investigator not found' });
      return profile;
    } catch (error: any) {
      fastify.log.error({ personId, error: error.message }, 'Failed to get investigator profile');
      return reply.code(500).send({ error: error.message });
    }
  });

  // ── Investigator Contact Endpoints ───────────────────────────────────────

  // GET /api/investigators/:personId/contacts
  fastify.get('/api/investigators/:personId/contacts', async (request, reply) => {
    const { personId } = request.params as { personId: string };
    try {
      const { getContactsForInvestigator, getEnrichmentStatus } = await import('./investigatorContacts');
      const [contacts, enrichmentStatus] = await Promise.all([
        getContactsForInvestigator(personId),
        getEnrichmentStatus(personId),
      ]);
      return { investigatorId: personId, contacts, enrichmentStatus };
    } catch (error: any) {
      fastify.log.error({ personId, error: error.message }, 'Failed to get investigator contacts');
      return reply.code(500).send({ error: error.message });
    }
  });

  // POST /api/investigators/:personId/enrich
  // Body: { fullName: string; institution?: string; country?: string; topic?: string }
  fastify.post('/api/investigators/:personId/enrich', async (request, reply) => {
    const { personId } = request.params as { personId: string };
    const { fullName, institution, country, topic } = request.body as {
      fullName?: string;
      institution?: string;
      country?: string;
      topic?: string;
    };

    if (!fullName) {
      return reply.code(400).send({ error: 'fullName is required' });
    }

    try {
      const Redis = (await import('ioredis')).default;
      const { Queue } = await import('bullmq');
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
      const queue = new Queue('investigator-contact-enrichment', { connection: redis });

      await queue.add(
        'enrich',
        {
          investigatorId: personId,
          fullName,
          institution: institution ?? null,
          country: country ?? null,
          topic: topic ?? null,
        },
        { jobId: `inv-enrich-${personId}`, deduplication: { id: personId } }
      );

      // Mark as queued in DB
      const pg = (await import('pg')).default;
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app' });
      await pool.query(
        `INSERT INTO investigator_enrichment_status (investigator_id, status, contacts_found)
         VALUES ($1, 'queued', 0)
         ON CONFLICT (investigator_id) DO UPDATE
           SET status = 'queued', updated_at = NOW()`,
        [personId]
      );
      await pool.end();

      return { investigatorId: personId, status: 'queued' };
    } catch (error: any) {
      fastify.log.error({ personId, error: error.message }, 'Failed to queue investigator enrichment');
      return reply.code(500).send({ error: error.message });
    }
  });

  // GET /api/investigators/:personId/enrichment-status
  fastify.get('/api/investigators/:personId/enrichment-status', async (request, reply) => {
    const { personId } = request.params as { personId: string };
    try {
      const { getEnrichmentStatus } = await import('./investigatorContacts');
      const status = await getEnrichmentStatus(personId);
      return status;
    } catch (error: any) {
      fastify.log.error({ personId, error: error.message }, 'Failed to get enrichment status');
      return reply.code(500).send({ error: error.message });
    }
  });

  // ── Sponsor Endpoints ─────────────────────────────────────────────────────

  // GET /api/sponsors — list sponsors sorted by active trial count
  fastify.get('/api/sponsors', async (request, reply) => {
    try {
      const { limit, minTrials, search } = request.query as any;
      const { listSponsors } = await import('./sponsors');
      const sponsors = await listSponsors({
        limit: parseInt(limit, 10) || 100,
        minTrials: parseInt(minTrials, 10) || 1,
        search: search || undefined,
      });
      return { sponsors, total: sponsors.length };
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Failed to list sponsors');
      return reply.code(500).send({ error: error.message });
    }
  });

  // GET /api/sponsors/:sponsorId — full sponsor intelligence profile
  fastify.get('/api/sponsors/:sponsorId', async (request, reply) => {
    const { sponsorId } = request.params as { sponsorId: string };
    try {
      const { getSponsorDetail } = await import('./sponsors');
      const detail = await getSponsorDetail(sponsorId);
      if (!detail) return reply.code(404).send({ error: 'Sponsor not found' });
      return detail;
    } catch (error: any) {
      fastify.log.error({ sponsorId, error: error.message }, 'Failed to get sponsor detail');
      return reply.code(500).send({ error: error.message });
    }
  });

  // ── Data Quality Endpoint ─────────────────────────────────────────────────

  // GET /api/admin/data-quality — enrichment coverage, verification breakdown, etc.
  fastify.get('/api/admin/data-quality', async (request, reply) => {
    try {
      const { getDataQualityStats } = await import('./dataQuality');
      const stats = await getDataQualityStats();
      return stats;
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Failed to get data quality stats');
      return reply.code(500).send({ error: error.message });
    }
  });

  // ── Trial Contact Enrichment Endpoints ───────────────────────────────────

  // GET /api/trials/:nctId/contacts — return enriched contacts for a trial
  fastify.get('/api/trials/:nctId/contacts', async (request, reply) => {
    const { nctId } = request.params as { nctId: string };
    if (!nctId) return reply.code(400).send({ error: 'nctId required' });

    try {
      const { getEnrichedContactsForTrial, getEnrichmentJobStatus, getOpportunityScore } = await import('./trialContacts');
      const [contacts, jobStatus, opportunityScore] = await Promise.all([
        getEnrichedContactsForTrial(nctId),
        getEnrichmentJobStatus(nctId),
        getOpportunityScore(nctId),
      ]);

      return {
        nctId,
        contacts,
        enrichmentJob: jobStatus,
        opportunityScore,
        total: contacts.length,
      };
    } catch (error: any) {
      fastify.log.error({ nctId, error: error.message }, 'Failed to get contacts');
      return reply.code(500).send({ error: error.message });
    }
  });

  // POST /api/trials/:nctId/enrich — push enrichment job to BullMQ
  // The worker process (apps/workers) must be running for jobs to execute.
  fastify.post('/api/trials/:nctId/enrich', async (request, reply) => {
    const { nctId } = request.params as { nctId: string };
    if (!nctId) return reply.code(400).send({ error: 'nctId required' });

    try {
      const { Queue } = await import('bullmq');
      const Redis = (await import('ioredis')).default;
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      });
      const queue = new Queue('trial-contact-enrichment', { connection: redis });
      const job = await queue.add(
        'enrich',
        { nctId },
        { jobId: `contact-enrich:${nctId}`, deduplication: { id: nctId } }
      );
      // Don't await redis.quit() — it will close after bullmq is done with it
      void redis.quit();

      return reply.code(202).send({
        status: 'accepted',
        nctId,
        jobId: job.id,
        message: 'Contact enrichment job queued',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      fastify.log.error({ nctId, error: error.message }, 'Failed to enqueue contact enrichment');
      return reply.code(500).send({ error: error.message });
    }
  });

  // GET /api/trials/:nctId/enrichment-status — poll enrichment job status
  fastify.get('/api/trials/:nctId/enrichment-status', async (request, reply) => {
    const { nctId } = request.params as { nctId: string };
    if (!nctId) return reply.code(400).send({ error: 'nctId required' });

    try {
      const { getEnrichmentJobStatus } = await import('./trialContacts');
      const status = await getEnrichmentJobStatus(nctId);
      return { nctId, job: status };
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  await fastify.listen({ port, host });
  console.log(`[API] Server listening on http://${host}:${port}`);

  // Ensure market data exists on startup (auto-trigger quick refresh if needed)
  if (process.env.AUTO_REFRESH_ON_STARTUP !== 'false') {
    setTimeout(async () => {
      try {
        const { ensureMarketData } = await import('./scripts/ensureData');
        await ensureMarketData();
      } catch (error) {
        console.error('[API] Failed to ensure market data on startup:', error);
      }
    }, 2000); // Wait 2 seconds for services to be ready
  }
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
