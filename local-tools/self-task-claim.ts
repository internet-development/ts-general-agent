//NOTE(self): Claim a task from a plan via GitHub assignee API
//NOTE(self): Uses first-writer-wins: if someone else claimed first, we gracefully fail

import { claimTask } from '@adapters/github/add-issue-assignee.js';
import { releaseTask } from '@adapters/github/remove-issue-assignee.js';
import { createIssueComment } from '@adapters/github/create-comment-issue.js';
import { logger } from '@modules/logger.js';
import { getConfig } from '@modules/config.js';
import {
  parsePlan,
  getClaimableTasks,
  freshUpdateTaskInPlan,
  type ParsedPlan,
  type ParsedTask,
} from '@local-tools/self-plan-parse.js';
import { getGitHubPhrase } from '@modules/self-voice-phrases.js';

export interface ClaimTaskParams {
  owner: string;
  repo: string;
  issueNumber: number;
  taskNumber: number;
  plan: ParsedPlan;
}

export interface ClaimTaskResult {
  success: boolean;
  claimed: boolean;
  //NOTE(self): Who has the claim if not us
  claimedBy?: string;
  error?: string;
}

//NOTE(self): Attempt to claim a task
export async function claimTaskFromPlan(params: ClaimTaskParams): Promise<ClaimTaskResult> {
  const { owner, repo, issueNumber, taskNumber, plan } = params;
  const config = getConfig();
  const myUsername = config.github.username;

  logger.info('Attempting to claim task', { owner, repo, issueNumber, taskNumber, myUsername });

  //NOTE(self): Find the task in the plan
  const task = plan.tasks.find(t => t.number === taskNumber);
  if (!task) {
    return { success: false, claimed: false, error: `Task ${taskNumber} not found in plan` };
  }

  //NOTE(self): Check if task is claimable — pending or blocked (blocked = failed execution, eligible for retry)
  if (task.status !== 'pending' && task.status !== 'blocked') {
    return { success: false, claimed: false, error: `Task ${taskNumber} is not claimable (status: ${task.status})` };
  }

  if (task.assignee) {
    return { success: false, claimed: false, claimedBy: task.assignee, error: `Task ${taskNumber} already claimed by ${task.assignee}` };
  }

  //NOTE(self): Check dependencies
  const completedTaskIds = new Set(
    plan.tasks.filter(t => t.status === 'completed').map(t => `Task ${t.number}`)
  );
  for (const dep of task.dependencies) {
    if (!completedTaskIds.has(dep)) {
      return { success: false, claimed: false, error: `Task ${taskNumber} has unmet dependency: ${dep}` };
    }
  }

  //NOTE(self): Attempt to claim via GitHub assignee API (atomic operation)
  const claimResult = await claimTask({
    owner,
    repo,
    issue_number: issueNumber,
    assignee: myUsername,
  });

  if (!claimResult.success) {
    return { success: false, claimed: false, error: claimResult.error };
  }

  //NOTE(self): We got the claim! Update the plan body to reflect this
  //NOTE(self): Task-level safety is already provided by task.assignee check above
  //NOTE(self): and freshUpdateTaskInPlan below (atomic read-modify-write)
  //NOTE(self): Use freshUpdateTaskInPlan to avoid clobbering concurrent writes
  const updateResult = await freshUpdateTaskInPlan(owner, repo, issueNumber, taskNumber, {
    status: 'claimed',
    assignee: myUsername,
  });

  if (!updateResult.success) {
    logger.warn('Claimed task but failed to update plan body', { error: updateResult.error });
    //NOTE(self): Still count as claimed since we have the assignee
  }

  //NOTE(self): Post a comment announcing the claim
  const claimCommentResult = await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: getGitHubPhrase('task_claim', { number: String(taskNumber), title: task.title }),
  });

  if (!claimCommentResult.success) {
    logger.warn('Failed to post claim comment', { error: claimCommentResult.error });
  }

  logger.info('Successfully claimed task', { taskNumber, myUsername });
  return { success: true, claimed: true };
}

//NOTE(self): Release a task claim (if we can't complete it)
export async function releaseTaskClaim(params: ClaimTaskParams): Promise<{ success: boolean; error?: string }> {
  const { owner, repo, issueNumber, taskNumber, plan } = params;
  const config = getConfig();
  const myUsername = config.github.username;

  logger.info('Releasing task claim', { owner, repo, issueNumber, taskNumber });

  //NOTE(self): Remove ourselves as assignee
  const releaseResult = await releaseTask(owner, repo, issueNumber, myUsername);
  if (!releaseResult.success) {
    return { success: false, error: releaseResult.error };
  }

  //NOTE(self): Update the plan body (fresh read to avoid clobbering)
  const planUpdateResult = await freshUpdateTaskInPlan(owner, repo, issueNumber, taskNumber, {
    status: 'pending',
    assignee: null,
  });
  if (!planUpdateResult.success) {
    logger.warn('Failed to update plan body on task release', { owner, repo, issueNumber, taskNumber, error: planUpdateResult.error });
  }

  //NOTE(self): Post a comment
  const releaseCommentResult = await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: getGitHubPhrase('task_release', { number: String(taskNumber) }),
  });

  if (!releaseCommentResult.success) {
    logger.warn('Failed to post release comment', { error: releaseCommentResult.error });
  }

  return { success: true };
}

//NOTE(self): Get the next claimable task from a plan
export function getNextClaimableTask(plan: ParsedPlan): ParsedTask | null {
  const claimable = getClaimableTasks(plan);
  if (claimable.length === 0) return null;

  //NOTE(self): Return the first claimable task (lowest number)
  return claimable.sort((a, b) => a.number - b.number)[0];
}

//NOTE(self): Mark a task as in_progress (after claiming)
//NOTE(self): Uses freshUpdateTaskInPlan to avoid clobbering concurrent writes
export async function markTaskInProgress(
  owner: string,
  repo: string,
  issueNumber: number,
  taskNumber: number,
  _planBody?: string //NOTE(self): Kept for API compat, no longer used (fresh read instead)
): Promise<{ success: boolean; newBody: string; error?: string }> {
  const config = getConfig();
  const myUsername = config.github.username;

  const result = await freshUpdateTaskInPlan(owner, repo, issueNumber, taskNumber, {
    status: 'in_progress',
    assignee: myUsername,
  });

  if (!result.success) {
    return { success: false, newBody: '', error: result.error };
  }

  return { success: true, newBody: '' };
}
