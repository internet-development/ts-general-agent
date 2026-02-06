//NOTE(self): Add assignee(s) to a GitHub issue
//NOTE(self): POST /repos/:owner/:repo/issues/:number/assignees
//NOTE(self): Used for claiming tasks in multi-SOUL coordination
//NOTE(self): Deterministic tiebreak: lexicographically-first login wins races

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
      const error = await response.json();
      return { success: false, error: error.message || `Failed to add assignee: ${response.status}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

//NOTE(self): Claim a task via assignee API with deterministic tiebreak
//NOTE(self): No GET pre-check — POST first, then inspect response assignees.
//NOTE(self): If multiple SOULs race, both see the same assignee list in the POST response.
//NOTE(self): Lexicographically-first login wins. Loser removes itself via DELETE.
//NOTE(self): DESIGN DECISION — Issue-level claiming is intentional:
//NOTE(self): Only one SOUL works on a plan issue at a time. This prevents merge conflicts
//NOTE(self): and keeps diffs clean. SOULs take turns: when SOUL1 finishes and removes itself
//NOTE(self): as assignee, SOUL2 can claim the next task on the next poll cycle.
export async function claimTask(
  params: Omit<AddIssueAssigneeParams, 'assignees'> & { assignee: string }
): Promise<GitHubResult<ClaimResult>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    //NOTE(self): POST to add ourselves as assignee (no pre-check GET)
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
    const assignees = claimedIssue.assignees?.map(a => a.login) || [];

    //NOTE(self): If we're the sole assignee, we win
    if (assignees.length === 1 && assignees[0] === params.assignee) {
      return {
        success: true,
        data: {
          claimed: true,
          issue: claimedIssue,
          currentAssignees: assignees,
        },
      };
    }

    //NOTE(self): Multiple assignees — deterministic tiebreak
    //NOTE(self): Both SOULs see the same list, so sorting picks the same winner
    if (assignees.length > 1) {
      const sortedAssignees = [...assignees].sort();
      const winner = sortedAssignees[0];

      if (winner === params.assignee) {
        //NOTE(self): We won the tiebreak
        logger.info('Won claim tiebreak', {
          assignee: params.assignee,
          allAssignees: assignees,
          issueNumber: params.issue_number,
        });
        return {
          success: true,
          data: {
            claimed: true,
            issue: claimedIssue,
            currentAssignees: assignees,
          },
        };
      } else {
        //NOTE(self): We lost — remove ourselves to clean up
        logger.info('Lost claim tiebreak, removing self', {
          assignee: params.assignee,
          winner,
          allAssignees: assignees,
          issueNumber: params.issue_number,
        });

        await fetch(
          `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/assignees`,
          {
            method: 'DELETE',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              assignees: [params.assignee],
            }),
          }
        );

        return {
          success: true,
          data: {
            claimed: false,
            issue: claimedIssue,
            currentAssignees: [winner],
          },
        };
      }
    }

    //NOTE(self): We're not in the assignee list at all (shouldn't happen after POST)
    return {
      success: true,
      data: {
        claimed: false,
        issue: claimedIssue,
        currentAssignees: assignees,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
