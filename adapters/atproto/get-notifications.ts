import { getAuthHeaders, getSession } from '@adapters/atproto/authenticate.js';
import type { AtprotoNotification, AtprotoResult } from '@adapters/atproto/types.js';

const BSKY_SERVICE = 'https://bsky.social';

export interface GetNotificationsParams {
  limit?: number;
  cursor?: string;
}

export interface GetNotificationsResponse {
  notifications: AtprotoNotification[];
  cursor?: string;
  seenAt?: string;
}

export async function getNotifications(
  params: GetNotificationsParams = {}
): Promise<AtprotoResult<GetNotificationsResponse>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const searchParams = new URLSearchParams();
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.cursor) searchParams.set('cursor', params.cursor);

    const url = `${BSKY_SERVICE}/xrpc/app.bsky.notification.listNotifications?${searchParams}`;
    const response = await fetch(url, { headers: getAuthHeaders() });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to get notifications' };
    }

    const data = await response.json();
    return {
      success: true,
      data: {
        notifications: data.notifications,
        cursor: data.cursor,
        seenAt: data.seenAt,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function updateSeenNotifications(): Promise<AtprotoResult<void>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const response = await fetch(
      `${BSKY_SERVICE}/xrpc/app.bsky.notification.updateSeen`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ seenAt: new Date().toISOString() }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to update seen notifications' };
    }

    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
