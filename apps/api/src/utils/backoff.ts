/**
 * Sleep utility for rate limiting and backoff
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter
 */
export async function exponentialBackoff(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000
): Promise<void> {
  const delay = Math.min(
    baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
    maxDelayMs
  );
  await sleep(delay);
}
