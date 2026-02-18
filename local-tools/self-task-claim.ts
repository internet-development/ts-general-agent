//NOTE(self): Claim a task from a plan via GitHub assignee API
//NOTE(self): Uses first-writer-wins: if someone else claimed first, we gracefully fail

import { claimTask } from '@adapters/github/add-issue-assignee.js';
import { createIssueComment } from '@adapters/github/create-comment-issue.js';
import { logger } from '@modules/logger.js';
import { getConfig } from '@modules/config.js';
import {
  freshUpdateTaskInPlan,
  fetchFreshPlan,
  type ParsedPlan,
} from '@local-tools/self-plan-parse.js';
import { getGitHubPhrase } from '@modules/voice-phrases.js';

//NOTE(self): In-memory claim tracker — prevents duplicate claim comments
//NOTE(self): Key: "owner/repo#issueNumber/task-N", Value: timestamp of claim
//NOTE(self): Concurrent planAwarenessCheck calls can both reach claimTaskFromPlan
//NOTE(self): before either updates the plan body; this guard prevents double-posting
const claimedTasks: Map<string, number> = new Map();

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

  //NOTE(self): In-memory claim dedup — reject if we already claimed this task recently
  const claimKey = `${owner}/${repo}#${issueNumber}/task-${taskNumber}`;
  if (claimedTasks.has(claimKey)) {
    logger.info('Blocked duplicate claim attempt (in-memory guard)', { claimKey });
    return { success: false, claimed: false, error: `Task ${taskNumber} already claimed by us (dedup)` };
  }

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

  //NOTE(self): Fresh plan check — re-read the plan body from GitHub to verify task is still unclaimed
  //NOTE(self): The plan passed in may be stale if another concurrent path already claimed this task
  const freshResult = await fetchFreshPlan(owner, repo, issueNumber);
  if (freshResult.success && freshResult.plan) {
    const freshTask = freshResult.plan.tasks.find(t => t.number === taskNumber);
    if (freshTask?.assignee) {
      logger.info('Task already claimed (fresh plan check)', { taskNumber, assignee: freshTask.assignee });
      return { success: false, claimed: false, claimedBy: freshTask.assignee, error: `Task ${taskNumber} already claimed by ${freshTask.assignee}` };
    }
  }

  //NOTE(self): Mark in-memory BEFORE any API calls to prevent concurrent claim attempts
  claimedTasks.set(claimKey, Date.now());

  //NOTE(self): Attempt to claim via GitHub assignee API (atomic operation)
  const claimResult = await claimTask({
    owner,
    repo,
    issue_number: issueNumber,
    assignee: myUsername,
  });

  if (!claimResult.success) {
    claimedTasks.delete(claimKey);
    return { success: false, claimed: false, error: claimResult.error };
  }

  //NOTE(self): We got the claim! Update the plan body to reflect this
  //NOTE(self): Use freshUpdateTaskInPlan to avoid clobbering concurrent writes
  const updateResult = await freshUpdateTaskInPlan(owner, repo, issueNumber, taskNumber, {
    status: 'claimed',
    assignee: myUsername,
  });

  if (!updateResult.success) {
    logger.warn('Claimed task but failed to update plan body', { error: updateResult.error });
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
