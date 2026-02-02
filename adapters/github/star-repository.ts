import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';

const GITHUB_API = 'https://api.github.com';

export async function starRepository(
  owner: string,
  repo: string
): Promise<GitHubResult<void>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/user/starred/${owner}/${repo}`,
      {
        method: 'PUT',
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok && response.status !== 204) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to star repository' };
    }

    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function unstarRepository(
  owner: string,
  repo: string
): Promise<GitHubResult<void>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/user/starred/${owner}/${repo}`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok && response.status !== 204) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to unstar repository' };
    }

    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
