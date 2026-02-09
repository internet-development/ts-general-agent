//NOTE(self): List reviews on a pull request
//NOTE(self): Used by workspace discovery to check if agent already reviewed a PR

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubPullRequestReview, GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface ListPullRequestReviewsParams {
  owner: string;
  repo: string;
  pull_number: number;
  per_page?: number;
}

export async function listPullRequestReviews(
  params: ListPullRequestReviewsParams
): Promise<GitHubResult<GitHubPullRequestReview[]>> {
  const auth = getAuth();
  const headers = auth
    ? getAuthHeaders()
    : { 'Accept': 'application/vnd.github.v3+json' };

  try {
    const searchParams = new URLSearchParams();
    if (params.per_page) searchParams.set('per_page', String(params.per_page));

    const url = `${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/reviews?${searchParams}`;
    const response = await githubFetch(url, { headers });

    if (!response.ok) {
      let errorMsg = `Failed to list pull request reviews: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
