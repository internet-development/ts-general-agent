import { getAuthHeaders, getSession } from '@adapters/atproto/authenticate.js';
import type { AtprotoFollower, AtprotoResult } from '@adapters/atproto/types.js';
import { blueskyFetch } from './rate-limit.js';

const BSKY_SERVICE = 'https://bsky.social';

export interface GetFollowsParams {
  actor: string;
  limit?: number;
  cursor?: string;
}

export interface GetFollowsResponse {
  follows: AtprotoFollower[];
  cursor?: string;
}

export async function getFollows(
  params: GetFollowsParams
): Promise<AtprotoResult<GetFollowsResponse>> {
  const session = getSession();
  const headers = session ? getAuthHeaders() : { 'Content-Type': 'application/json' };

  try {
    const searchParams = new URLSearchParams();
    searchParams.set('actor', params.actor);
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.cursor) searchParams.set('cursor', params.cursor);

    const url = `${BSKY_SERVICE}/xrpc/app.bsky.graph.getFollows?${searchParams}`;
    const response = await blueskyFetch(url, { headers });

    if (!response.ok) {
      let errorMsg = `Failed to get follows: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return {
      success: true,
      data: {
        follows: data.follows,
        cursor: data.cursor,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
