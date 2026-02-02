import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubComment, GitHubResult } from '@adapters/github/types.js';

const GITHUB_API = 'https://api.github.com';

export interface CreatePullRequestCommentParams {
  owner: string;
  repo: string;
  pull_number: number;
  body: string;
}

export async function createPullRequestComment(
  params: CreatePullRequestCommentParams
): Promise<GitHubResult<GitHubComment>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.pull_number}/comments`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ body: params.body }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to create PR comment' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export interface CreatePullRequestReviewCommentParams {
  owner: string;
  repo: string;
  pull_number: number;
  body: string;
  commit_id: string;
  path: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
}

export async function createPullRequestReviewComment(
  params: CreatePullRequestReviewCommentParams
): Promise<GitHubResult<GitHubComment>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/comments`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          body: params.body,
          commit_id: params.commit_id,
          path: params.path,
          line: params.line,
          side: params.side,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to create review comment' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
