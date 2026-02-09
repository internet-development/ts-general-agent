import { logger } from '@modules/logger.js';

// Module-level singleton state
let rateLimitRemaining = 5000;
let rateLimitReset = 0;       // Unix epoch seconds
let rateLimitLimit = 5000;
let lastRequestTime = 0;

const MIN_SPACING_MS = 5000;
const LOW_BUDGET_THRESHOLD = 100;

function readRateLimitHeaders(response: Response): void {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  const limit = response.headers.get('x-ratelimit-limit');

  if (remaining !== null) rateLimitRemaining = parseInt(remaining, 10);
  if (reset !== null) rateLimitReset = parseInt(reset, 10);
  if (limit !== null) rateLimitLimit = parseInt(limit, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function githubFetch(url: string | URL | Request, options?: RequestInit): Promise<Response> {
  // Pre-request budget check
  if (rateLimitRemaining < LOW_BUDGET_THRESHOLD) {
    const resetDate = new Date(rateLimitReset * 1000);
    logger.warn('GitHub rate limit low, returning synthetic 503', {
      remaining: rateLimitRemaining,
      resetAt: resetDate.toISOString(),
    });
    return new Response(JSON.stringify({ message: 'Rate limit budget low, skipping request' }), {
      status: 503,
      statusText: 'Service Unavailable (rate limit budget low)',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Minimum spacing between requests
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (lastRequestTime > 0 && elapsed < MIN_SPACING_MS) {
    await sleep(MIN_SPACING_MS - elapsed);
  }
  lastRequestTime = Date.now();

  const response = await fetch(url, options);

  // Read rate limit headers from every response
  readRateLimitHeaders(response);

  // Handle 429 Too Many Requests
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;

    if (retrySeconds <= 30) {
      logger.warn('GitHub 429, short retry', { retrySeconds });
      await sleep(retrySeconds * 1000);
      lastRequestTime = Date.now();
      const retryResponse = await fetch(url, options);
      readRateLimitHeaders(retryResponse);
      return retryResponse;
    }

    logger.warn('GitHub 429, retry-after too long, returning as-is', { retrySeconds });
    return response;
  }

  // Handle 403 with exhausted rate limit
  if (response.status === 403 && rateLimitRemaining === 0) {
    const retryAfter = response.headers.get('retry-after');
    const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;

    if (retrySeconds <= 30) {
      logger.warn('GitHub 403 rate limit exhausted, short retry', { retrySeconds });
      await sleep(retrySeconds * 1000);
      lastRequestTime = Date.now();
      const retryResponse = await fetch(url, options);
      readRateLimitHeaders(retryResponse);
      return retryResponse;
    }

    logger.warn('GitHub 403 rate limit exhausted, returning as-is', { retrySeconds });
    return response;
  }

  return response;
}

export function getGitHubRateLimitStatus(): { remaining: number; limit: number; resetAt: Date } {
  return {
    remaining: rateLimitRemaining,
    limit: rateLimitLimit,
    resetAt: new Date(rateLimitReset * 1000),
  };
}
