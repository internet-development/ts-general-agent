import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';

const GITHUB_API = 'https://api.github.com';

export interface MergePullRequestParams {
  owner: string;
  repo: string;
  pull_number: number;
  commit_title?: string;
  commit_message?: string;
  merge_method?: 'merge' | 'squash' | 'rebase';
}

export interface MergePullRequestResponse {
  sha: string;
  merged: boolean;
  message: string;
}

export async function mergePullRequest(
  params: MergePullRequestParams
): Promise<GitHubResult<MergePullRequestResponse>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/merge`,
      {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          commit_title: params.commit_title,
          commit_message: params.commit_message,
          merge_method: params.merge_method || 'squash',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to merge pull request' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
