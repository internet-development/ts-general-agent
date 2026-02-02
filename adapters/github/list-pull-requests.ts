import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubPullRequest, GitHubResult } from '@adapters/github/types.js';

const GITHUB_API = 'https://api.github.com';

export interface ListPullRequestsParams {
  owner: string;
  repo: string;
  state?: 'open' | 'closed' | 'all';
  head?: string;
  base?: string;
  sort?: 'created' | 'updated' | 'popularity' | 'long-running';
  direction?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}

export async function listPullRequests(
  params: ListPullRequestsParams
): Promise<GitHubResult<GitHubPullRequest[]>> {
  const auth = getAuth();
  const headers = auth
    ? getAuthHeaders()
    : { 'Accept': 'application/vnd.github.v3+json' };

  try {
    const searchParams = new URLSearchParams();
    if (params.state) searchParams.set('state', params.state);
    if (params.head) searchParams.set('head', params.head);
    if (params.base) searchParams.set('base', params.base);
    if (params.sort) searchParams.set('sort', params.sort);
    if (params.direction) searchParams.set('direction', params.direction);
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.page) searchParams.set('page', String(params.page));

    const url = `${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls?${searchParams}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to list pull requests' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
