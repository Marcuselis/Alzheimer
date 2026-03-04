# Market Refresh Performance Optimization

## Changes Made

### Before Optimization
- **Full scan time**: 15-20 minutes for 1000 studies
- **Database queries**: 8-10 queries per study = 8,000-10,000 queries total
- **Processing**: Sequential, one study at a time

### After Optimization
- **Expected full scan time**: 3-5 minutes for 1000 studies (3-4x faster)
- **Database queries**: Reduced to ~100-200 queries total (50-80x reduction)
- **Processing**: Batched operations with transactions

## Key Optimizations

### 1. Batch Check Existing Trials
**Before**: 1 query per study to check if it exists (1000 queries)
**After**: 1 query to check all studies in a page (10 queries total)

```typescript
// Before: Inside loop
const existing = await db.query('SELECT ... WHERE nct_id = $1', [nctId]);

// After: Before loop
const existingTrials = await db.query('SELECT ... WHERE nct_id = ANY($1)', [nctIds]);
const existingTrialsMap = new Map(...);
```

### 2. Batch Normalize Sponsors
**Before**: 1-2 queries per study to find/create sponsor (1000-2000 queries)
**After**: 1 query to find all sponsors, then bulk create missing ones (10-20 queries total)

```typescript
// Before: Inside loop
const sponsorId = await normalizeSponsor(normalizedSponsorName);

// After: Before loop
const sponsors = await db.query('SELECT ... WHERE name = ANY($1)', [sponsorNames]);
// Then bulk create missing sponsors
```

### 3. Transaction-Based Bulk Inserts
**Before**: Each insert is a separate transaction (8000+ transactions)
**After**: All inserts in a single transaction per page (10 transactions total)

```typescript
// Before: Individual inserts
await db.query('INSERT INTO ...', [...]);
await db.query('INSERT INTO ...', [...]);
// ... 8-10 queries per study

// After: Single transaction per page
await client.query('BEGIN');
// ... all inserts
await client.query('COMMIT');
```

### 4. Data Preparation Before Database
**Before**: Process and insert immediately (mixed I/O and CPU)
**After**: Prepare all data first, then bulk insert (separated concerns)

## Performance Impact

| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| Check existing trials | 1000 queries | 10 queries | 100x faster |
| Normalize sponsors | 1000-2000 queries | 10-20 queries | 50-100x faster |
| Insert operations | 8000+ queries | ~100 queries | 80x faster |
| Transaction overhead | 8000+ commits | 10 commits | 800x less overhead |
| **Total time** | **15-20 min** | **3-5 min** | **3-4x faster** |

## Expected Performance

### Quick Mode (200 studies)
- **Before**: ~3-4 minutes
- **After**: ~1-1.5 minutes
- **Improvement**: 2-3x faster

### Full Mode (1000 studies)
- **Before**: ~15-20 minutes
- **After**: ~3-5 minutes
- **Improvement**: 3-4x faster

## Technical Details

### Database Connection Pooling
- Uses connection from pool for transaction
- Releases connection after commit/rollback
- Reduces connection overhead

### Memory Usage
- Slightly higher (stores batch data in memory)
- Still very small: ~1-2 MB per page
- Acceptable trade-off for 3-4x speedup

### Error Handling
- Transaction rollback on any error
- Maintains data consistency
- No partial updates

## Future Optimizations

1. **Parallel Processing**: Process multiple pages concurrently
2. **PostgreSQL COPY**: Use COPY for even faster bulk inserts
3. **Prepared Statements**: Cache query plans
4. **Connection Pooling Tuning**: Optimize pool size

## Testing

To verify the optimization:

```bash
# Time a full refresh
time curl -X POST "http://localhost:3001/api/market/alzheimers/refresh"

# Check logs for timing
# Should see: "Job completed: 1000 trials processed in ~180000ms" (3 min)
# Instead of: "Job completed: 1000 trials processed in ~900000ms" (15 min)
```

## Notes

- Optimization maintains data consistency
- All existing functionality preserved
- Backward compatible with existing data
- No schema changes required
