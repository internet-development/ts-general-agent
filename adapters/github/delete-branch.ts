//NOTE(self): Delete a branch from a GitHub repository
//NOTE(self): DELETE /repos/:owner/:repo/git/refs/heads/:branch
//NOTE(self): Used after PR merge to clean up feature branches

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';

const GITHUB_API = 'https://api.github.com';

export async function deleteBranch(
  owner: string,
  repo: string,
  branchName: string
): Promise<GitHubResult<void>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branchName}`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok) {
      //NOTE(self): 422 = branch doesn't exist (already deleted), treat as success
      if (response.status === 422) {
        return { success: true, data: undefined };
      }
      let errorMessage = `Failed to delete branch: ${response.status}`;
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
