//NOTE(self): Remove assignee(s) from a GitHub issue
//NOTE(self): DELETE /repos/:owner/:repo/issues/:number/assignees
//NOTE(self): Used for releasing/unclaiming tasks in multi-SOUL coordination

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubIssue, GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface RemoveIssueAssigneeParams {
  owner: string;
  repo: string;
  issue_number: number;
  assignees: string[];
}

export async function removeIssueAssignee(
  params: RemoveIssueAssigneeParams
): Promise<GitHubResult<GitHubIssue>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    //NOTE(self): Guard — never remove the last assignee from an issue
    //NOTE(self): Fetch current assignees first, then check if removal would leave zero
    const issueResponse = await githubFetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`,
      { headers: getAuthHeaders() }
    );

    if (issueResponse.ok) {
      const issueData = await issueResponse.json();
      const currentAssignees: string[] = (issueData.assignees || []).map((a: { login: string }) => a.login.toLowerCase());
      const removing = new Set(params.assignees.map(a => a.toLowerCase()));
      const remaining = currentAssignees.filter(a => !removing.has(a));

      if (remaining.length === 0 && currentAssignees.length > 0) {
        //NOTE(self): Would remove the last assignee — skip the removal
        return { success: true, data: issueData };
      }
    }

    const response = await githubFetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/assignees`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          assignees: params.assignees,
        }),
      }
    );

    if (!response.ok) {
      let errorMsg = `Failed to remove assignee: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

//NOTE(self): Convenience function to release a task claim
export async function releaseTask(
  owner: string,
  repo: string,
  issue_number: number,
  assignee: string
): Promise<GitHubResult<GitHubIssue>> {
  return removeIssueAssignee({
    owner,
    repo,
    issue_number,
    assignees: [assignee],
  });
}
