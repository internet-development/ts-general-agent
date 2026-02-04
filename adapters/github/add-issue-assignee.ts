//NOTE(self): Add assignee(s) to a GitHub issue
//NOTE(self): POST /repos/:owner/:repo/issues/:number/assignees
//NOTE(self): Used for claiming tasks in multi-SOUL coordination
//NOTE(self): First-writer-wins: if assignee already set, claim fails

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubIssue, GitHubResult } from '@adapters/github/types.js';

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
      const error = await response.json();
      return { success: false, error: error.message || `Failed to add assignee: ${response.status}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

//NOTE(self): Atomic claim attempt - checks current assignees first
//NOTE(self): Returns whether we successfully claimed (first-writer-wins)
export async function claimTask(
  params: Omit<AddIssueAssigneeParams, 'assignees'> & { assignee: string }
): Promise<GitHubResult<ClaimResult>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    //NOTE(self): First, fetch current issue state
    const issueResponse = await fetch(
      `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`,
      {
        method: 'GET',
        headers: getAuthHeaders(),
      }
    );

    if (!issueResponse.ok) {
      const error = await issueResponse.json();
      return { success: false, error: error.message || `Failed to fetch issue: ${issueResponse.status}` };
    }

    const issueData = await issueResponse.json() as GitHubIssue;

    //NOTE(self): Check if already assigned (first-writer-wins)
    if (issueData.assignees && issueData.assignees.length > 0) {
      return {
        success: true,
        data: {
          claimed: false,
          issue: issueData,
          currentAssignees: issueData.assignees.map(a => a.login),
        },
      };
    }

    //NOTE(self): Attempt to claim by adding ourselves as assignee
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
      const error = await claimResponse.json();
      return { success: false, error: error.message || `Failed to claim task: ${claimResponse.status}` };
    }

    const claimedIssue = await claimResponse.json() as GitHubIssue;

    //NOTE(self): Verify we actually got the claim (race condition check)
    const ourClaim = claimedIssue.assignees?.some(a => a.login === params.assignee);

    return {
      success: true,
      data: {
        claimed: ourClaim ?? false,
        issue: claimedIssue,
        currentAssignees: claimedIssue.assignees?.map(a => a.login),
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
