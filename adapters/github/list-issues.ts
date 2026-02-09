import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubIssue, GitHubResult } from '@adapters/github/types.js';

const GITHUB_API = 'https://api.github.com';

export interface ListIssuesParams {
  owner: string;
  repo: string;
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  sort?: 'created' | 'updated' | 'comments';
  direction?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}

export async function listIssues(
  params: ListIssuesParams
): Promise<GitHubResult<GitHubIssue[]>> {
  const auth = getAuth();
  const headers = auth
    ? getAuthHeaders()
    : { 'Accept': 'application/vnd.github.v3+json' };

  try {
    const searchParams = new URLSearchParams();
    if (params.state) searchParams.set('state', params.state);
    if (params.labels?.length) searchParams.set('labels', params.labels.join(','));
    if (params.sort) searchParams.set('sort', params.sort);
    if (params.direction) searchParams.set('direction', params.direction);
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.page) searchParams.set('page', String(params.page));

    const url = `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues?${searchParams}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      let errorMsg = `Failed to list issues: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
