import { getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';
import { blueskyFetch } from './rate-limit.js';

const BSKY_SERVICE = 'https://bsky.social';

export async function deletePost(postUri: string): Promise<AtprotoResult<void>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const rkey = postUri.split('/').pop();
    if (!rkey) {
      return { success: false, error: 'Invalid post URI' };
    }

    const response = await blueskyFetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.deleteRecord`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        rkey,
      }),
    });

    if (!response.ok) {
      let errorMsg = `Failed to delete post: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
