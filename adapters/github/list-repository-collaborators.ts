//NOTE(self): List repository collaborators to discover reviewer candidates
//NOTE(self): Cold-start fallback when peer registry is empty — seeds peer discovery

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';

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
    const response = await fetch(
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
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to list collaborators' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
