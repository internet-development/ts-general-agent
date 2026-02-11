import { logger } from '@modules/logger.js';
import { ensureValidSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';

// Module-level singleton state
let rateLimitRemaining = 300;
let rateLimitReset = 0;       // Unix epoch seconds
let rateLimitLimit = 300;
let lastRequestTime = 0;

const MIN_SPACING_MS = 5000;
const LOW_BUDGET_THRESHOLD = 20;

function readRateLimitHeaders(response: Response): void {
  const remaining = response.headers.get('ratelimit-remaining');
  const reset = response.headers.get('ratelimit-reset');
  const limit = response.headers.get('ratelimit-limit');

  if (remaining !== null) rateLimitRemaining = parseInt(remaining, 10);
  if (reset !== null) rateLimitReset = parseInt(reset, 10);
  if (limit !== null) rateLimitLimit = parseInt(limit, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function blueskyFetch(url: string | URL | Request, options?: RequestInit): Promise<Response> {
  // Pre-request budget check
  if (rateLimitRemaining < LOW_BUDGET_THRESHOLD) {
    const resetDate = new Date(rateLimitReset * 1000);
    logger.warn('Bluesky rate limit low, returning synthetic 503', {
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

  // Handle 401 Unauthorized — token expired, refresh and retry once
  if (response.status === 401) {
    logger.info('Bluesky 401, attempting token refresh');
    const refreshed = await ensureValidSession();
    if (refreshed) {
      // Rebuild request with fresh auth headers
      const freshHeaders = getAuthHeaders();
      const retryOptions: RequestInit = {
        ...options,
        headers: { ...options?.headers, ...freshHeaders },
      };
      lastRequestTime = Date.now();
      const retryResponse = await fetch(url, retryOptions);
      readRateLimitHeaders(retryResponse);
      if (retryResponse.status === 401) {
        logger.error('Bluesky 401 persists after token refresh');
      }
      return retryResponse;
    }
    logger.error('Bluesky 401 and token refresh failed');
    return response;
  }

  // Handle 429 Too Many Requests
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;

    if (retrySeconds <= 30) {
      logger.warn('Bluesky 429, short retry', { retrySeconds });
      await sleep(retrySeconds * 1000);
      lastRequestTime = Date.now();
      const retryResponse = await fetch(url, options);
      readRateLimitHeaders(retryResponse);
      return retryResponse;
    }

    logger.warn('Bluesky 429, retry-after too long, returning as-is', { retrySeconds });
    return response;
  }

  // Handle 403 with exhausted rate limit
  if (response.status === 403 && rateLimitRemaining === 0) {
    const retryAfter = response.headers.get('retry-after');
    const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;

    if (retrySeconds <= 30) {
      logger.warn('Bluesky 403 rate limit exhausted, short retry', { retrySeconds });
      await sleep(retrySeconds * 1000);
      lastRequestTime = Date.now();
      const retryResponse = await fetch(url, options);
      readRateLimitHeaders(retryResponse);
      return retryResponse;
    }

    logger.warn('Bluesky 403 rate limit exhausted, returning as-is', { retrySeconds });
    return response;
  }

  return response;
}

export function getBlueskyRateLimitStatus(): { remaining: number; limit: number; resetAt: Date } {
  return {
    remaining: rateLimitRemaining,
    limit: rateLimitLimit,
    resetAt: new Date(rateLimitReset * 1000),
  };
}
