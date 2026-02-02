import { getAuthHeaders, getSession } from '@adapters/atproto/authenticate.js';
import type { AtprotoFollower, AtprotoResult } from '@adapters/atproto/types.js';

const BSKY_SERVICE = 'https://bsky.social';

export interface GetFollowersParams {
  actor: string;
  limit?: number;
  cursor?: string;
}

export interface GetFollowersResponse {
  followers: AtprotoFollower[];
  cursor?: string;
}

export async function getFollowers(
  params: GetFollowersParams
): Promise<AtprotoResult<GetFollowersResponse>> {
  const session = getSession();
  const headers = session ? getAuthHeaders() : { 'Content-Type': 'application/json' };

  try {
    const searchParams = new URLSearchParams();
    searchParams.set('actor', params.actor);
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.cursor) searchParams.set('cursor', params.cursor);

    const url = `${BSKY_SERVICE}/xrpc/app.bsky.graph.getFollowers?${searchParams}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to get followers' };
    }

    const data = await response.json();
    return {
      success: true,
      data: {
        followers: data.followers,
        cursor: data.cursor,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
