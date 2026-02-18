//NOTE(self): Delete a comment from a GitHub issue
//NOTE(self): DELETE /repos/:owner/:repo/issues/comments/:comment_id
//NOTE(self): Used by github-comment-cleanup to prune duplicate comments

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export async function deleteIssueComment(
  owner: string,
  repo: string,
  commentId: number
): Promise<GitHubResult<void>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await githubFetch(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${commentId}`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok) {
      //NOTE(self): 404 = comment doesn't exist (already deleted), treat as success
      if (response.status === 404) {
        return { success: true, data: undefined };
      }
      let errorMessage = `Failed to delete issue comment: ${response.status}`;
      try {
        const error = await response.json();
        errorMessage = error.message || errorMessage;
      } catch { /* non-JSON response */ }
      return { success: false, error: errorMessage };
    }

    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
