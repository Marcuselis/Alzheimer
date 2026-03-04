import { getCache, setCache, deleteCache } from './redis';

export interface CacheOptions {
  ttlSeconds?: number;
  keyPrefix?: string;
}

/**
 * Read-through cache pattern: try cache first, fallback to loader, then cache result
 */
export async function getOrSetJson<T>(
  key: string,
  loaderFn: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const { ttlSeconds = 600, keyPrefix = '' } = options;
  const fullKey = keyPrefix ? `${keyPrefix}:${key}` : key;
  
  // Try cache first
  const cached = await getCache<T>(fullKey);
  if (cached !== null) {
    return cached;
  }
  
  // Load from DB/source
  const value = await loaderFn();
  
  // Cache it
  await setCache(fullKey, value, ttlSeconds);
  
  return value;
}

/**
 * Invalidate cache by exact key
 */
export async function invalidateCache(key: string) {
  await deleteCache(key);
}

/**
 * Build cache key from parts
 */
export function buildCacheKey(parts: string[]): string {
  return parts.filter(Boolean).join(':');
}

/**
 * Invalidate cache pattern (for multiple keys)
 * Note: For production, implement Redis SCAN for pattern matching
 */
export async function invalidateCachePattern(pattern: string) {
  // For now, just delete exact key
  // In production, use Redis SCAN to find matching keys
  await deleteCache(pattern);
}
