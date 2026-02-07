import { getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';

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

    const response = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.deleteRecord`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        rkey,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to delete post' };
    }

    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
