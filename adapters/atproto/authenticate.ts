import type { AtprotoSession, AtprotoResult } from '@adapters/atproto/types.js';
import { blueskyFetch } from './rate-limit.js';

const BSKY_SERVICE = 'https://bsky.social';

let currentSession: AtprotoSession | null = null;

export async function authenticate(
  identifier: string,
  password: string
): Promise<AtprotoResult<AtprotoSession>> {
  try {
    const response = await blueskyFetch(`${BSKY_SERVICE}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });

    if (!response.ok) {
      let errorMsg = `Authentication failed: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    currentSession = {
      did: data.did,
      handle: data.handle,
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
    };

    return { success: true, data: currentSession };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function refreshSession(): Promise<AtprotoResult<AtprotoSession>> {
  if (!currentSession) {
    return { success: false, error: 'No active session to refresh' };
  }

  try {
    const response = await blueskyFetch(`${BSKY_SERVICE}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentSession.refreshJwt}`,
      },
    });

    if (!response.ok) {
      let errorMsg = `Session refresh failed: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    currentSession = {
      did: data.did,
      handle: data.handle,
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
    };

    return { success: true, data: currentSession };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function getSession(): AtprotoSession | null {
  return currentSession;
}

export function getAuthHeaders(): Record<string, string> {
  if (!currentSession) {
    throw new Error('Not authenticated');
  }
  return {
    'Authorization': `Bearer ${currentSession.accessJwt}`,
    'Content-Type': 'application/json',
  };
}

// NOTE(self): Check if token is expired (JWT exp claim)
export function isTokenExpired(): boolean {
  if (!currentSession) return true;

  try {
    // NOTE(self): JWT is base64url encoded, second part is payload
    const payload = currentSession.accessJwt.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const exp = decoded.exp * 1000; // NOTE(self): exp is in seconds, convert to ms
    const now = Date.now();
    const buffer = 60000; // NOTE(self): Refresh 1 minute before expiry
    return now >= (exp - buffer);
  } catch {
    return true; // NOTE(self): If we can't decode, assume expired
  }
}

// NOTE(self): Ensure we have a valid session, refreshing if needed
export async function ensureValidSession(): Promise<boolean> {
  if (!currentSession) return false;

  if (isTokenExpired()) {
    const result = await refreshSession();
    return result.success;
  }

  return true;
}

export function clearSession(): void {
  currentSession = null;
}
