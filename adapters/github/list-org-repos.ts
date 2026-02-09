import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubRepository, GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface ListOrgReposParams {
  org: string;
  type?: 'all' | 'public' | 'private' | 'forks' | 'sources' | 'member';
  sort?: 'created' | 'updated' | 'pushed' | 'full_name';
  direction?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}

export async function listOrgRepos(
  params: ListOrgReposParams
): Promise<GitHubResult<GitHubRepository[]>> {
  const auth = getAuth();
  const headers = auth
    ? getAuthHeaders()
    : { 'Accept': 'application/vnd.github.v3+json' };

  try {
    const searchParams = new URLSearchParams();
    if (params.type) searchParams.set('type', params.type);
    if (params.sort) searchParams.set('sort', params.sort);
    if (params.direction) searchParams.set('direction', params.direction);
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.page) searchParams.set('page', String(params.page));

    const url = `${GITHUB_API}/orgs/${params.org}/repos?${searchParams}`;
    const response = await githubFetch(url, { headers });

    if (!response.ok) {
      let errorMsg = `Failed to list org repos: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export interface ListUserOrgsParams {
  username?: string; // If not provided, lists orgs for authenticated user
  per_page?: number;
  page?: number;
}

export interface GitHubOrg {
  login: string;
  id: number;
  url: string;
  avatar_url: string;
  description: string | null;
}

export async function listUserOrgs(
  params: ListUserOrgsParams = {}
): Promise<GitHubResult<GitHubOrg[]>> {
  const auth = getAuth();
  if (!auth && !params.username) {
    return { success: false, error: 'GitHub not authenticated and no username provided' };
  }

  const headers = auth
    ? getAuthHeaders()
    : { 'Accept': 'application/vnd.github.v3+json' };

  try {
    const searchParams = new URLSearchParams();
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.page) searchParams.set('page', String(params.page));

    // Use /user/orgs for authenticated user, /users/:username/orgs otherwise
    const endpoint = params.username
      ? `${GITHUB_API}/users/${params.username}/orgs`
      : `${GITHUB_API}/user/orgs`;

    const url = `${endpoint}?${searchParams}`;
    const response = await githubFetch(url, { headers });

    if (!response.ok) {
      let errorMsg = `Failed to list orgs: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
