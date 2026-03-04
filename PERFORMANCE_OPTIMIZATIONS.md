# Performance Optimizations for Fast First-Time Loads

This document describes the optimizations implemented to ensure the app loads fast on first use and displays data correctly.

## Changes Made

### 1. Quick Mode for Market Refresh

**Problem**: Full market refresh processes 1000 studies, taking 15+ minutes, which is too slow for first-time users.

**Solution**: Added a "quick mode" that processes 200 studies initially (~2-3 minutes) for fast initial load.

**Implementation**:
- Added `quickMode` parameter to `refreshMarket()` function
- Quick mode limits `maxRank` to 200 instead of 1000
- API endpoints support `?quick=true` query parameter
- Frontend has separate "Quick Refresh" and "Full Refresh" buttons

**Files Modified**:
- `apps/workers/src/jobs/refreshMarket.ts` - Added quickMode support
- `apps/workers/src/workers/marketRefreshWorker.ts` - Passes quickMode to refresh
- `apps/api/src/queue/queue.ts` - Supports quickMode in job data
- `apps/api/src/index.ts` - API endpoints support quick parameter
- `apps/web/src/app/market-scan/page.tsx` - UI for quick vs full refresh

### 2. Synchronous Materialized View Refresh

**Problem**: Materialized views were refreshed asynchronously, so data wasn't immediately available after refresh completed.

**Solution**: Made materialized view refresh synchronous so data is immediately available.

**Implementation**:
- Changed `refreshMarketRollups()` from async fire-and-forget to awaited
- Rollups now complete before refresh job finishes
- Data is immediately queryable after refresh

**Files Modified**:
- `apps/workers/src/jobs/refreshMarket.ts` - Made rollups synchronous

### 3. Auto-Refresh on Startup

**Problem**: If no data exists, users had to manually trigger refresh, leading to empty screens.

**Solution**: API automatically checks for data on startup and triggers quick refresh if needed.

**Implementation**:
- Created `apps/api/src/scripts/ensureData.ts`
- Checks if market data exists on API startup
- Auto-triggers quick refresh if no data found
- Runs 2 seconds after API starts (to allow services to initialize)

**Files Modified**:
- `apps/api/src/scripts/ensureData.ts` - New file for auto-refresh logic
- `apps/api/src/index.ts` - Calls ensureData on startup

### 4. Cache Warming

**Problem**: First API requests after refresh were slow due to cache misses.

**Solution**: Pre-populate cache with common endpoints after data refresh.

**Implementation**:
- Created `apps/api/src/cache/warmCache.ts`
- Warms market summary and sponsors list endpoints
- Called automatically when data exists in ensureData
- Ensures fast response times for first user requests

**Files Modified**:
- `apps/api/src/cache/warmCache.ts` - New file for cache warming
- `apps/api/src/scripts/ensureData.ts` - Calls warmCache when data exists

### 5. Improved Frontend Loading States

**Problem**: Users didn't know what was happening during refresh or if data was loading.

**Solution**: Better loading states and user feedback.

**Implementation**:
- Added separate "Quick Refresh" and "Full Refresh" buttons
- Shows refresh progress with trial count
- Displays estimated time remaining
- Shows initialization message when no data exists

**Files Modified**:
- `apps/web/src/app/market-scan/page.tsx` - Improved UI
- `apps/web/src/app/dashboard/page.tsx` - Added initialization message

## Usage

### Quick Refresh (Recommended for First Load)

```bash
# Via API
curl -X POST "http://localhost:3001/api/market/alzheimers/refresh?quick=true"

# Or via UI
Click "Quick Refresh" button (processes 200 studies, ~2-3 min)
```

### Full Refresh (For Complete Data)

```bash
# Via API
curl -X POST "http://localhost:3001/api/market/alzheimers/refresh"

# Or via UI
Click "Full Refresh" button (processes 1000 studies, ~15+ min)
```

### Auto-Refresh on Startup

The API automatically checks for data on startup. To disable:

```bash
AUTO_REFRESH_ON_STARTUP=false pnpm dev:api
```

## Performance Improvements

- **First Load Time**: Reduced from 15+ minutes to 2-3 minutes (quick mode)
- **Data Availability**: Immediate after refresh (synchronous rollups)
- **Cache Hit Rate**: Improved with cache warming
- **User Experience**: Better feedback and loading states

## Next Steps

1. **Progressive Loading**: After quick refresh completes, automatically trigger full refresh in background
2. **Incremental Updates**: Only fetch studies updated since last refresh
3. **Background Jobs**: Run full refresh on schedule (e.g., daily)
4. **Cache Invalidation**: Automatically invalidate cache when refresh completes

## Testing

To test the optimizations:

1. **Fresh Start**: Stop all services, clear database, restart
   ```bash
   docker-compose down -v
   docker-compose up -d
   pnpm dev
   ```
   - Should auto-trigger quick refresh
   - App should be usable in 2-3 minutes

2. **Quick Refresh**: Click "Quick Refresh" button
   - Should complete in 2-3 minutes
   - Data should be immediately available

3. **Full Refresh**: Click "Full Refresh" button
   - Should complete in 15+ minutes
   - All 1000 studies processed

4. **Cache Warming**: After refresh, check API logs
   - Should see "[CacheWarm] Cache warmed successfully"
   - First requests should be fast
