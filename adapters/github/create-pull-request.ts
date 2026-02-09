import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubPullRequest, GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface CreatePullRequestParams {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
  maintainer_can_modify?: boolean;
}

export async function createPullRequest(
  params: CreatePullRequestParams
): Promise<GitHubResult<GitHubPullRequest>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await githubFetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          head: params.head,
          base: params.base,
          draft: params.draft,
          maintainer_can_modify: params.maintainer_can_modify,
        }),
      }
    );

    if (!response.ok) {
      let errorMsg = `Failed to create pull request: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
