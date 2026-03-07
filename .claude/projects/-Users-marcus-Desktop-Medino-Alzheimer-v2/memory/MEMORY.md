# Alzheimer_v2 Project Memory

## Architecture
- **Web**: Next.js (apps/web, port 3000) — reads trials from `apps/web/data/generated/trials.json`
- **API**: Fastify (apps/api, port 3001) — PostgreSQL DB for enriched/computed data
- **Workers**: BullMQ workers (apps/workers) — Redis queue, runs enrichment jobs
- **DB**: PostgreSQL, migrations in `apps/api/src/db/migrations/`
- **Web→API**: via `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`)

## Trial Data
- `apps/web/data/generated/trials.json` — flat JSON, keys: nct_id, title, sponsor, phase, status, enrollment, locations, interventions, conditions, geo, principal_investigators
- `principal_investigators`: pipe-separated, comma-delimited "Name, Title, Dept, Institution"
- 580 total trials, ~286 with PI data

## Investigator Intelligence Layer (Phase 2 complete)
- Migration 010: people adds canonical_person_id, orcid, influence_score, trial_count, alias_names; new table trial_opportunity_scores
- `personResolution.ts` — 5-pass deduplication: exact → ORCID → email → last+initial+org → Jaccard token similarity
- `opportunityScoring.ts` — 0-100 score: phase(35) + status(30) + sponsor_tier(20) + investigator(10) + recency(5)
- `autoEnrichTrialContacts.ts` — daily cron (20 trials/batch, Phase 2/3 priority), fires 30s after startup
- `/investigators/[personId]` page — profile with trials, sponsors, contact sidebar, influence bar
- Fastify: GET /api/investigators, GET /api/investigators/:personId
- Contacts API now also returns opportunityScore
- Contact names in trial detail link to /investigators/[personId]

## Contact Enrichment Pipeline (Phase 1 complete)
**DB migrations:** 008_trial_contacts.sql, 009_contact_verification.sql
**Tables:** people, organizations, contact_methods (with verification_status), trial_people, enrichment_jobs, contact_sources

**Files:**
- `apps/workers/src/enrich/orgNormalization.ts` — curated registry of institutions → domain
- `apps/workers/src/enrich/emailVerification.ts` — MX + SMTP + catch-all detection
- `apps/workers/src/enrich/trialContactEnrichment.ts` — full pipeline (extract → normalize → search → verify → score → persist)
- `apps/workers/src/workers/trialContactWorker.ts` — BullMQ worker (queue: "trial-contact-enrichment")
- `apps/api/src/trialContacts.ts` — read-only DB queries for API
- Fastify endpoints: GET/POST /api/trials/:nctId/contacts, /enrich, /enrichment-status
- Next.js proxy routes: apps/web/src/app/api/trials/[nctId]/contacts|enrich|enrichment-status
- Trial detail page: apps/web/src/app/trials/[nctId]/page.tsx
- Market-scan: NCT ID now links to /trials/:nctId (internal page)

**Email verification_status values:** published, verified, inferred, catch_all, rejected, unknown
- published = scraped verbatim from official page (highest trust)
- verified = SMTP confirmed + not catch-all
- catch_all = domain accepts all addresses (SMTP unreliable)
- Many European university domains (ki.se, uu.se, etc.) are catch-all — hardcoded in KNOWN_CATCH_ALL_DOMAINS

## Key Packages
- Workers: bullmq, pg, node-fetch, cheerio, ioredis, zod
- Web: Next.js 14, swr, tailwind-like CSS vars (var(--brand-teal), var(--text-primary) etc.)
- No test runner currently in web package

## Preferences / Conventions
- CSS: inline styles using CSS variables (no Tailwind classes)
- No emojis unless explicitly asked
- Keep solutions simple — no over-engineering
