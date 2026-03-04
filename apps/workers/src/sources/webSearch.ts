import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

async function getCache<T>(key: string): Promise<T | null> {
  try {
    const value = await redis.get(key);
    if (value) {
      return JSON.parse(value);
    }
    return null;
  } catch (error) {
    console.error(`[Redis] Get error for ${key}:`, error);
    return null;
  }
}

async function setCache(key: string, value: any, ttlSeconds: number = 300) {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    console.error(`[Redis] Set error for ${key}:`, error);
  }
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
}

// Rate limiting: max 1 request/sec
let lastRequestTime = 0;
const RATE_LIMIT_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function exponentialBackoff(attempt: number, baseDelayMs: number = 1000, maxDelayMs: number = 30000): Promise<void> {
  const delay = Math.min(
    baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
    maxDelayMs
  );
  await sleep(delay);
}

/**
 * Search web using DuckDuckGo HTML endpoint (best-effort, may break)
 * Returns top search results with title, url, snippet
 */
export async function searchWeb(query: string, limit: number = 10): Promise<WebSearchResult[]> {
  // Check cache first
  const cacheKey = `websearch:${createHash('sha1').update(query).digest('hex')}`;
  const cached = await getCache<WebSearchResult[]>(cacheKey);
  if (cached !== null) {
    return cached.slice(0, limit);
  }

  // Rate limiting
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - timeSinceLastRequest);
  }
  lastRequestTime = Date.now();

  let attempt = 0;
  const maxRetries = 3;
  let results: WebSearchResult[] = [];

  while (attempt < maxRetries) {
    try {
      // DuckDuckGo HTML search endpoint (NOT JS)
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 15000,
      } as any);

      if (!response.ok) {
        throw new Error(`DuckDuckGo returned status ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Parse DuckDuckGo HTML results
      // DuckDuckGo results are in .result class
      $('.result').each((_, element) => {
        if (results.length >= limit) return false; // Stop iterating

        const $result = $(element);
        const $title = $result.find('.result__a');
        const $snippet = $result.find('.result__snippet');

        const url = $title.attr('href') || '';
        const title = $title.text().trim() || '';
        const snippet = $snippet.text().trim() || '';

        if (url && title) {
          // Filter out obvious junk
          if (url.includes('/jobs/') || url.includes('/job/')) {
            return; // Skip job postings
          }

          results.push({
            url: url.startsWith('http') ? url : `https:${url}`,
            title,
            snippet,
          });
        }
      });

      // If we got results, cache and return
      if (results.length > 0) {
        // Cache for 7 days
        await setCache(cacheKey, results, 7 * 24 * 60 * 60);
        return results.slice(0, limit);
      }

      // If no results, try alternative parsing (DuckDuckGo may have changed structure)
      // Try parsing links directly
      $('a.result__a').each((_, element) => {
        if (results.length >= limit) return false;

        const $link = $(element);
        const url = $link.attr('href') || '';
        const title = $link.text().trim() || '';
        const snippet = $link.closest('.result').find('.result__snippet').text().trim() || '';

        if (url && title && !url.includes('/jobs/')) {
          results.push({
            url: url.startsWith('http') ? url : `https:${url}`,
            title,
            snippet,
          });
        }
      });

      if (results.length > 0) {
        await setCache(cacheKey, results, 7 * 24 * 60 * 60);
        return results.slice(0, limit);
      }

      // If still no results, return empty array but don't cache failure
      console.warn(`[WebSearch] No results found for query: ${query}`);
      return [];

    } catch (error: any) {
      attempt++;
      if (attempt >= maxRetries) {
        console.error(`[WebSearch] Failed after ${maxRetries} attempts for query: ${query}`, error.message);
        
        // Return cached results if available (even if stale)
        const staleCache = await getCache<WebSearchResult[]>(cacheKey);
        if (staleCache && staleCache.length > 0) {
          console.log(`[WebSearch] Returning stale cached results for: ${query}`);
          return staleCache.slice(0, limit);
        }
        
        return [];
      }
      
      await exponentialBackoff(attempt, 1000, 10000);
    }
  }

  return [];
}
