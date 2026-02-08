//NOTE(self): Request reviewers on a pull request
//NOTE(self): Enables PR visibility — without reviewer requests, PRs get zero attention

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';

const GITHUB_API = 'https://api.github.com';

export interface RequestReviewersParams {
  owner: string;
  repo: string;
  pull_number: number;
  reviewers: string[];
}

export interface RequestReviewersResponse {
  //NOTE(self): GitHub returns the updated PR object but we only need confirmation
  requested_reviewers: Array<{ login: string; id: number }>;
}

/**
 * Request reviewers on a pull request.
 *
 * Handles 422 gracefully — user may be the PR author or lack access.
 */
export async function requestPullRequestReviewers(
  params: RequestReviewersParams
): Promise<GitHubResult<RequestReviewersResponse>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  if (params.reviewers.length === 0) {
    return { success: false, error: 'No reviewers specified' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/requested_reviewers`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          reviewers: params.reviewers,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      //NOTE(self): 422 = user is PR author, not a collaborator, or otherwise ineligible
      if (response.status === 422) {
        return {
          success: false,
          error: error.message || 'Cannot request reviewers: users may be the PR author or lack access'
        };
      }
      if (response.status === 403) {
        return {
          success: false,
          error: 'Forbidden: insufficient permissions to request reviewers'
        };
      }
      return { success: false, error: error.message || 'Failed to request reviewers' };
    }

    const data = await response.json();
    return {
      success: true,
      data: {
        requested_reviewers: data.requested_reviewers || [],
      }
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
