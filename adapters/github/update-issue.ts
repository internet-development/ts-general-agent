//NOTE(self): Update an existing GitHub issue
//NOTE(self): PATCH /repos/:owner/:repo/issues/:number
//NOTE(self): Can update body, state, labels, title, etc.

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubIssue, GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface UpdateIssueParams {
  owner: string;
  repo: string;
  issue_number: number;
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  labels?: string[];
  assignees?: string[];
}

export async function updateIssue(
  params: UpdateIssueParams
): Promise<GitHubResult<GitHubIssue>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  //NOTE(self): Build the update payload - only include provided fields
  const payload: Record<string, unknown> = {};
  if (params.title !== undefined) payload.title = params.title;
  if (params.body !== undefined) payload.body = params.body;
  if (params.state !== undefined) payload.state = params.state;
  if (params.labels !== undefined) payload.labels = params.labels;
  if (params.assignees !== undefined) payload.assignees = params.assignees;

  try {
    const response = await githubFetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`,
      {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      let errorMsg = `Failed to update issue: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
