import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubIssue, GitHubResult } from '@adapters/github/types.js';

const GITHUB_API = 'https://api.github.com';

export interface CreateIssueParams {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export async function createIssue(
  params: CreateIssueParams
): Promise<GitHubResult<GitHubIssue>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  //NOTE(self): Issues must always have an assignee — default to the authenticated user
  const assignees = params.assignees && params.assignees.length > 0
    ? params.assignees
    : [auth.username];

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          labels: params.labels,
          assignees,
        }),
      }
    );

    if (!response.ok) {
      let errorMsg = `Failed to create issue: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
