import { getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';

const BSKY_SERVICE = 'https://bsky.social';

export async function unfollowUser(followUri: string): Promise<AtprotoResult<void>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const rkey = followUri.split('/').pop();
    if (!rkey) {
      return { success: false, error: 'Invalid follow URI' };
    }

    const response = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.deleteRecord`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.graph.follow',
        rkey,
      }),
    });

    if (!response.ok) {
      let errorMsg = `Failed to unfollow user: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
