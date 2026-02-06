//NOTE(self): Create reactions on GitHub issues and comments
import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';

const GITHUB_API = 'https://api.github.com';

export type ReactionContent = '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes';

export async function createIssueReaction(
  owner: string,
  repo: string,
  issue_number: number,
  content: ReactionContent
): Promise<GitHubResult<{ id: number }>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${issue_number}/reactions`,
      {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to create issue reaction' };
    }

    const data = await response.json();
    return { success: true, data: { id: data.id } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function createIssueCommentReaction(
  owner: string,
  repo: string,
  comment_id: number,
  content: ReactionContent
): Promise<GitHubResult<{ id: number }>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${comment_id}/reactions`,
      {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to create comment reaction' };
    }

    const data = await response.json();
    return { success: true, data: { id: data.id } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
