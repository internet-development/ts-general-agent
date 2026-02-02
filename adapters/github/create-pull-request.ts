import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubPullRequest, GitHubResult } from '@adapters/github/types.js';

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
    const response = await fetch(
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
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to create pull request' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
