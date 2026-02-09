//NOTE(self): List repository collaborators to discover reviewer candidates
//NOTE(self): Cold-start fallback when peer registry is empty — seeds peer discovery

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface GitHubCollaborator {
  login: string;
  id: number;
  permissions: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
}

/**
 * List collaborators for a repository.
 *
 * Returns empty array on 403 — expected for repos we don't own (not an error).
 */
export async function listRepositoryCollaborators(
  owner: string,
  repo: string
): Promise<GitHubResult<GitHubCollaborator[]>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await githubFetch(
      `${GITHUB_API}/repos/${owner}/${repo}/collaborators`,
      {
        method: 'GET',
        headers: getAuthHeaders(),
      }
    );

    //NOTE(self): 403 is expected for repos we don't own — not an error, just no data
    if (response.status === 403) {
      return { success: true, data: [] };
    }

    if (!response.ok) {
      let errorMsg = `Failed to list collaborators: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
