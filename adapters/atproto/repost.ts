import { getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';
import { blueskyFetch } from './rate-limit.js';

const BSKY_SERVICE = 'https://bsky.social';

export interface RepostParams {
  uri: string;
  cid: string;
}

export interface RepostResponse {
  uri: string;
  cid: string;
}

export async function repost(
  params: RepostParams
): Promise<AtprotoResult<RepostResponse>> {
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
        collection: 'app.bsky.feed.repost',
        record: {
          $type: 'app.bsky.feed.repost',
          subject: { uri: params.uri, cid: params.cid },
          createdAt: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      let errorMsg = `Failed to repost: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data: { uri: data.uri, cid: data.cid } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function unrepost(repostUri: string): Promise<AtprotoResult<void>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const rkey = repostUri.split('/').pop();
    if (!rkey) {
      return { success: false, error: 'Invalid repost URI' };
    }

    const response = await blueskyFetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.deleteRecord`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.repost',
        rkey,
      }),
    });

    if (!response.ok) {
      let errorMsg = `Failed to unrepost: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
