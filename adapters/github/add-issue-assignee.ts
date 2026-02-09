//NOTE(self): Add assignee(s) to a GitHub issue
//NOTE(self): POST /repos/:owner/:repo/issues/:number/assignees
//NOTE(self): Used for claiming tasks in multi-SOUL coordination
//NOTE(self): Multiple assignees allowed — each SOUL claims a different task in the plan

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubIssue, GitHubResult } from '@adapters/github/types.js';
import { logger } from '@modules/logger.js';

const GITHUB_API = 'https://api.github.com';

export interface AddIssueAssigneeParams {
  owner: string;
  repo: string;
  issue_number: number;
  assignees: string[];
}

export interface ClaimResult {
  claimed: boolean;
  issue: GitHubIssue;
  //NOTE(self): Who currently has the claim (if not us)
  currentAssignees?: string[];
}

export async function addIssueAssignee(
  params: AddIssueAssigneeParams
): Promise<GitHubResult<GitHubIssue>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/assignees`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          assignees: params.assignees,
        }),
      }
    );

    if (!response.ok) {
      let errorMsg = `Failed to add assignee: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

//NOTE(self): Claim a task via assignee API — multiple SOULs can be assigned simultaneously
//NOTE(self): Each SOUL claims a different task (guarded by task.assignee check in plan body).
//NOTE(self): Multiple assignees on the issue is fine — they're working on different tasks.
export async function claimTask(
  params: Omit<AddIssueAssigneeParams, 'assignees'> & { assignee: string }
): Promise<GitHubResult<ClaimResult>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    //NOTE(self): POST to add ourselves as assignee
    const claimResponse = await fetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/assignees`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          assignees: [params.assignee],
        }),
      }
    );

    if (!claimResponse.ok) {
      let errorMsg = `Failed to claim task: ${claimResponse.status}`;
      try { const error = await claimResponse.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const claimedIssue = await claimResponse.json() as GitHubIssue;
    const assignees = claimedIssue.assignees?.map(a => a.login) || [];

    //NOTE(self): We're assigned — claim succeeds. Multiple assignees are expected
    //NOTE(self): (each SOUL works on a different task within the same plan issue).
    return {
      success: true,
      data: {
        claimed: true,
        issue: claimedIssue,
        currentAssignees: assignees,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
