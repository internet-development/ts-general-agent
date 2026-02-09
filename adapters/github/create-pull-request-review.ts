//NOTE(self): Create a pull request review (approve, request changes, or comment)
//NOTE(self): This enables multi-SOUL workflows where agents can approve each other's work

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult, GitHubPullRequestReview } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface CreatePullRequestReviewParams {
  owner: string;
  repo: string;
  pull_number: number;
  //NOTE(self): APPROVE, REQUEST_CHANGES, or COMMENT
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  //NOTE(self): Required for REQUEST_CHANGES and COMMENT, optional for APPROVE
  body?: string;
  //NOTE(self): Optional commit SHA to review - defaults to latest
  commit_id?: string;
}

/**
 * Create a pull request review.
 *
 * Events:
 * - APPROVE: Approve the PR (body is optional but encouraged)
 * - REQUEST_CHANGES: Request changes (body is required)
 * - COMMENT: Leave a review comment without approval (body is required)
 */
export async function createPullRequestReview(
  params: CreatePullRequestReviewParams
): Promise<GitHubResult<GitHubPullRequestReview>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  //NOTE(self): Validate body is present when required
  if ((params.event === 'REQUEST_CHANGES' || params.event === 'COMMENT') && !params.body) {
    return {
      success: false,
      error: `Body is required for ${params.event} reviews`
    };
  }

  try {
    const requestBody: Record<string, unknown> = {
      event: params.event,
    };

    if (params.body) {
      requestBody.body = params.body;
    }

    if (params.commit_id) {
      requestBody.commit_id = params.commit_id;
    }

    const response = await githubFetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/reviews`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      let errorMsg = `Failed to create PR review: ${response.status}`;
      try {
        const error = await response.json();
        errorMsg = error.message || errorMsg;
      } catch { /* non-JSON response (e.g. HTML 502) */ }
      //NOTE(self): Provide helpful error messages for common cases
      if (response.status === 422) {
        return { success: false, error: errorMsg || 'Cannot review: PR may be merged, closed, or you may be the author' };
      }
      if (response.status === 403) {
        return { success: false, error: 'Forbidden: You may not have permission to review this PR' };
      }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
