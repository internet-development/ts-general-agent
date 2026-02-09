import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubComment, GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface CreateIssueCommentParams {
  owner: string;
  repo: string;
  issue_number: number;
  body: string;
}

export async function createIssueComment(
  params: CreateIssueCommentParams
): Promise<GitHubResult<GitHubComment>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await githubFetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ body: params.body }),
      }
    );

    if (!response.ok) {
      let errorMsg = `Failed to create comment: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
