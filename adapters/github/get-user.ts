import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubUser, GitHubResult } from '@adapters/github/types.js';

const GITHUB_API = 'https://api.github.com';

export async function getUser(username: string): Promise<GitHubResult<GitHubUser>> {
  const auth = getAuth();
  const headers = auth
    ? getAuthHeaders()
    : { 'Accept': 'application/vnd.github.v3+json' };

  try {
    const response = await fetch(`${GITHUB_API}/users/${username}`, { headers });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to get user' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function getAuthenticatedUser(): Promise<GitHubResult<GitHubUser>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(`${GITHUB_API}/user`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to get authenticated user' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
