import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubRepository, GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export async function getRepository(
  owner: string,
  repo: string
): Promise<GitHubResult<GitHubRepository>> {
  const auth = getAuth();
  const headers = auth
    ? getAuthHeaders()
    : { 'Accept': 'application/vnd.github.v3+json' };

  try {
    const response = await githubFetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      headers,
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to get repository' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
