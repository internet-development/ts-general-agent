import { getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';

const BSKY_SERVICE = 'https://bsky.social';

export interface FollowUserParams {
  did: string;
}

export interface FollowUserResponse {
  uri: string;
  cid: string;
}

export async function followUser(
  params: FollowUserParams
): Promise<AtprotoResult<FollowUserResponse>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const response = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.graph.follow',
        record: {
          $type: 'app.bsky.graph.follow',
          subject: params.did,
          createdAt: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      let errorMsg = `Failed to follow user: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data: { uri: data.uri, cid: data.cid } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
