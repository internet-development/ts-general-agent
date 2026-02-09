//NOTE(self): GitHub API for creating repositories from template repos

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubRepository, GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface CreateRepoFromTemplateParams {
  templateOwner: string;
  templateRepo: string;
  name: string;
  owner?: string; // org or user to create under, defaults to authenticated user
  description?: string;
  private?: boolean;
  includeAllBranches?: boolean;
}

export async function createRepositoryFromTemplate(
  params: CreateRepoFromTemplateParams
): Promise<GitHubResult<GitHubRepository>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await githubFetch(
      `${GITHUB_API}/repos/${params.templateOwner}/${params.templateRepo}/generate`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: params.name,
          owner: params.owner,
          description: params.description,
          private: params.private ?? false,
          include_all_branches: params.includeAllBranches ?? false,
        }),
      }
    );

    if (!response.ok) {
      let errorMsg = `Failed to create repository from template: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
