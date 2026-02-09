import { getAuthHeaders, getSession } from '@adapters/atproto/authenticate.js';
import type { AtprotoFeedItem, AtprotoResult } from '@adapters/atproto/types.js';

const BSKY_SERVICE = 'https://bsky.social';

export interface GetTimelineParams {
  limit?: number;
  cursor?: string;
}

export interface GetTimelineResponse {
  feed: AtprotoFeedItem[];
  cursor?: string;
}

export async function getTimeline(
  params: GetTimelineParams = {}
): Promise<AtprotoResult<GetTimelineResponse>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const searchParams = new URLSearchParams();
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.cursor) searchParams.set('cursor', params.cursor);

    const url = `${BSKY_SERVICE}/xrpc/app.bsky.feed.getTimeline?${searchParams}`;
    const response = await fetch(url, { headers: getAuthHeaders() });

    if (!response.ok) {
      let errorMsg = `Failed to get timeline: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return {
      success: true,
      data: {
        feed: data.feed,
        cursor: data.cursor,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function getAuthorFeed(
  actor: string,
  params: GetTimelineParams = {}
): Promise<AtprotoResult<GetTimelineResponse>> {
  const session = getSession();
  const headers = session ? getAuthHeaders() : { 'Content-Type': 'application/json' };

  try {
    const searchParams = new URLSearchParams();
    searchParams.set('actor', actor);
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.cursor) searchParams.set('cursor', params.cursor);

    const url = `${BSKY_SERVICE}/xrpc/app.bsky.feed.getAuthorFeed?${searchParams}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      let errorMsg = `Failed to get author feed: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return {
      success: true,
      data: {
        feed: data.feed,
        cursor: data.cursor,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
