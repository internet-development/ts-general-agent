import type { GitHubAuth } from '@adapters/github/types.js';
import { logger } from '@modules/logger.js';

const GITHUB_API = 'https://api.github.com';

let currentAuth: GitHubAuth | null = null;

export function setAuth(username: string, token: string): void {
  currentAuth = { username, token };
}

export function getAuth(): GitHubAuth | null {
  return currentAuth;
}

export function getAuthHeaders(): Record<string, string> {
  if (!currentAuth) {
    throw new Error('GitHub not authenticated');
  }
  return {
    'Authorization': `Bearer ${currentAuth.token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function clearAuth(): void {
  currentAuth = null;
}

export async function verifyAuth(): Promise<boolean> {
  if (!currentAuth) return false;

  try {
    const response = await fetch(`${GITHUB_API}/user`, {
      headers: getAuthHeaders(),
    });
    return response.ok;
  } catch (e) {
    logger.debug('GitHub auth verification failed', { error: String(e) });
    return false;
  }
}
