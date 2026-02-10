import type { GitHubAuth } from '@adapters/github/types.js';

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

