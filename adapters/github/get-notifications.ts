//NOTE(self): Fetch GitHub notifications for the authenticated user
//NOTE(self): Filters to actionable notifications (mentions, issue comments, PR comments)

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';
import { logger } from '@modules/logger.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface GitHubNotification {
  id: string;
  reason: 'mention' | 'author' | 'comment' | 'review_requested' | 'assign' | 'subscribed' | 'manual' | 'state_change' | 'ci_activity' | string;
  unread: boolean;
  updated_at: string;
  last_read_at: string | null;
  subject: {
    title: string;
    url: string; //NOTE(self): API URL to the issue/PR
    latest_comment_url: string | null;
    type: 'Issue' | 'PullRequest' | 'Discussion' | string;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
    html_url: string;
  };
  url: string; //NOTE(self): API URL to this notification
}

export interface GetNotificationsParams {
  all?: boolean; //NOTE(self): Include read notifications
  participating?: boolean; //NOTE(self): Only where user is directly participating
  since?: string; //NOTE(self): ISO 8601 timestamp
  per_page?: number;
}

//NOTE(self): Fetch GitHub notifications for the authenticated user
//NOTE(self): Paginates through ALL available pages — a human checks all their notifications, not just the first page
//NOTE(self): Without pagination, mention notifications can be permanently lost when seenAt advances past unfetched pages
export async function getNotifications(
  params: GetNotificationsParams = {}
): Promise<GitHubResult<GitHubNotification[]>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const searchParams = new URLSearchParams();
    if (params.all) searchParams.set('all', 'true');
    if (params.participating) searchParams.set('participating', 'true');
    if (params.since) searchParams.set('since', params.since);
    const perPage = params.per_page || 50;
    searchParams.set('per_page', String(perPage));

    const url = `${GITHUB_API}/notifications?${searchParams}`;
    const response = await githubFetch(url, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to fetch notifications' };
    }

    let data: GitHubNotification[] = await response.json();

    //NOTE(self): Paginate if first page was full — fetch ALL remaining pages
    //NOTE(self): A human reads all their notifications; so do we. Missing one means missing a mention.
    if (data.length >= perPage) {
      let nextUrl = parseLinkNext(response.headers.get('link'));
      while (nextUrl) {
        const pageResponse = await githubFetch(nextUrl, { headers: getAuthHeaders() });
        if (!pageResponse.ok) break;
        const pageData: GitHubNotification[] = await pageResponse.json();
        data = data.concat(pageData);
        nextUrl = parseLinkNext(pageResponse.headers.get('link'));
      }
    }

    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

//NOTE(self): Parse Link header for rel="next" URL (GitHub pagination)
function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

//NOTE(self): Mark a notification as read
export async function markNotificationRead(
  threadId: string
): Promise<GitHubResult<void>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await githubFetch(`${GITHUB_API}/notifications/threads/${threadId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });

    if (!response.ok && response.status !== 205) {
      const error = await response.json().catch(() => ({}));
      return { success: false, error: (error as { message?: string }).message || 'Failed to mark notification read' };
    }

    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

//NOTE(self): Extract issue/PR number from a GitHub API URL
//NOTE(self): e.g., https://api.github.com/repos/owner/repo/issues/123 -> 123
export function extractNumberFromApiUrl(apiUrl: string): number | null {
  const match = apiUrl.match(/\/(?:issues|pulls)\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

//NOTE(self): Filter notifications to actionable ones (mentions, comments on own issues)
export function filterActionableNotifications(
  notifications: GitHubNotification[],
  agentUsername: string
): GitHubNotification[] {
  return notifications.filter((n) => {
    //NOTE(self): Always include mentions
    if (n.reason === 'mention') return true;

    //NOTE(self): Include comments where we're the author (replies to our issues/PRs)
    if (n.reason === 'author' || n.reason === 'comment') return true;

    //NOTE(self): Include review requests
    if (n.reason === 'review_requested') return true;

    //NOTE(self): Skip subscribed/manual (too noisy)
    return false;
  });
}
