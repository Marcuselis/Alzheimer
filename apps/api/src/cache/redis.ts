import { createClient } from 'redis';

const client = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

client.on('error', (err) => console.error('[Redis] Error:', err));
client.on('connect', () => console.log('[Redis] Connected'));

let isConnected = false;

export async function getRedis() {
  if (!isConnected) {
    await client.connect();
    isConnected = true;
  }
  return client;
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const redis = await getRedis();
    const value = await redis.get(key);
    if (value) {
      // Track cache hit
      const { cacheHits } = await import('../metrics');
      const keyPrefix = key.split(':')[0];
      cacheHits.inc({ key_prefix: keyPrefix });
      return JSON.parse(value);
    }
    // Track cache miss
    const { cacheMisses } = await import('../metrics');
    const keyPrefix = key.split(':')[0];
    cacheMisses.inc({ key_prefix: keyPrefix });
    return null;
  } catch (error) {
    console.error(`[Redis] Get error for ${key}:`, error);
    return null;
  }
}

export async function setCache(key: string, value: any, ttlSeconds: number = 300) {
  try {
    const redis = await getRedis();
    await redis.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    console.error(`[Redis] Set error for ${key}:`, error);
  }
}

export async function deleteCache(key: string) {
  try {
    const redis = await getRedis();
    await redis.del(key);
  } catch (error) {
    console.error(`[Redis] Delete error for ${key}:`, error);
  }
}
