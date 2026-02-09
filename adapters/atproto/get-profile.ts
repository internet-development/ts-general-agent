import { getAuthHeaders, getSession } from '@adapters/atproto/authenticate.js';
import type { AtprotoProfile, AtprotoResult } from '@adapters/atproto/types.js';

const BSKY_SERVICE = 'https://bsky.social';

export async function getProfile(
  actor: string
): Promise<AtprotoResult<AtprotoProfile>> {
  const session = getSession();
  const headers = session ? getAuthHeaders() : { 'Content-Type': 'application/json' };

  try {
    const response = await fetch(
      `${BSKY_SERVICE}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`,
      { headers }
    );

    if (!response.ok) {
      let errorMsg = `Failed to get profile: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return {
      success: true,
      data: {
        did: data.did,
        handle: data.handle,
        displayName: data.displayName,
        description: data.description,
        avatar: data.avatar,
        followersCount: data.followersCount || 0,
        followsCount: data.followsCount || 0,
        postsCount: data.postsCount || 0,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function getMyProfile(): Promise<AtprotoResult<AtprotoProfile>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }
  return getProfile(session.did);
}
