import { getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';
import { blueskyFetch } from './rate-limit.js';

const BSKY_SERVICE = 'https://bsky.social';

export interface LikePostParams {
  uri: string;
  cid: string;
}

export interface LikePostResponse {
  uri: string;
  cid: string;
}

export async function likePost(
  params: LikePostParams
): Promise<AtprotoResult<LikePostResponse>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const response = await blueskyFetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.like',
        record: {
          $type: 'app.bsky.feed.like',
          subject: { uri: params.uri, cid: params.cid },
          createdAt: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      let errorMsg = `Failed to like post: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data: { uri: data.uri, cid: data.cid } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

