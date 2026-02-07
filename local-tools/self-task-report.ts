//NOTE(self): Report task progress and completion via GitHub comments
//NOTE(self): Updates plan body and posts status comments

import { createIssueComment } from '@adapters/github/create-comment-issue.js';
import { removeIssueAssignee } from '@adapters/github/remove-issue-assignee.js';
import { logger } from '@modules/logger.js';
import { getConfig } from '@modules/config.js';
import {
  freshUpdateTaskInPlan,
  fetchFreshPlan,
  type ParsedPlan,
  type ParsedTask,
  type TaskStatus,
} from '@local-tools/self-plan-parse.js';
import { updatePlanStatus } from '@local-tools/self-plan-create.js';
import { getGitHubPhrase } from '@modules/voice-phrases.js';

export interface ReportTaskParams {
  owner: string;
  repo: string;
  issueNumber: number;
  taskNumber: number;
  plan: ParsedPlan;
}

export interface TaskCompletionReport {
  success: boolean;
  summary: string;
  filesChanged?: string[];
  testsRun?: boolean;
  testsPassed?: boolean;
}

//NOTE(self): Report task completion
export async function reportTaskComplete(
  params: ReportTaskParams,
  report: TaskCompletionReport
): Promise<{ success: boolean; error?: string; planComplete?: boolean }> {
  const { owner, repo, issueNumber, taskNumber, plan } = params;
  const config = getConfig();
  const myUsername = config.github.username;

  logger.info('Reporting task completion', { taskNumber, owner, repo, issueNumber });

  //NOTE(self): Find the task
  const task = plan.tasks.find(t => t.number === taskNumber);
  if (!task) {
    return { success: false, error: `Task ${taskNumber} not found` };
  }

  //NOTE(self): Update plan body with completed status (fresh read to avoid clobbering)
  const updateResult = await freshUpdateTaskInPlan(owner, repo, issueNumber, taskNumber, {
    status: 'completed',
    assignee: myUsername,
  });

  if (!updateResult.success) {
    logger.error('Failed to update plan body', { error: updateResult.error });
    return { success: false, error: updateResult.error };
  }

  //NOTE(self): Build completion comment
  const filesSection = report.filesChanged?.length
    ? `\n\n**Files changed:**\n${report.filesChanged.map(f => `- \`${f}\``).join('\n')}`
    : '';

  const testsSection = report.testsRun !== undefined
    ? `\n\n**Tests:** ${report.testsRun ? (report.testsPassed ? '✅ Passed' : '❌ Failed') : 'Not run'}`
    : '';

  const details = `${report.summary}${filesSection}${testsSection}`;
  const comment = getGitHubPhrase('task_complete', {
    number: String(taskNumber), title: task.title, details, username: myUsername,
  });

  const commentResult = await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });

  if (!commentResult.success) {
    logger.warn('Failed to post completion comment', { error: commentResult.error });
  }

  //NOTE(self): Always use live data — other SOULs may have completed tasks since we started
  const freshResult = await fetchFreshPlan(owner, repo, issueNumber);
  const livePlan = freshResult.success && freshResult.plan ? freshResult.plan : plan;

  //NOTE(self): Check if all tasks are complete
  const allComplete = livePlan.tasks.every(t =>
    t.number === taskNumber ? true : t.status === 'completed'
  );

  let planComplete = false;
  if (allComplete) {
    await handlePlanComplete(owner, repo, issueNumber);
    planComplete = true;
  }

  //NOTE(self): Remove assignee (task is done, we're free for next task)
  const removeResult = await removeIssueAssignee({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: [myUsername],
  });

  if (!removeResult.success) {
    logger.warn('Failed to remove assignee after completion', { error: removeResult.error });
  }

  return { success: true, planComplete };
}

//NOTE(self): Report task progress (for long-running tasks)
export async function reportTaskProgress(
  params: ReportTaskParams,
  progressMessage: string
): Promise<{ success: boolean; error?: string }> {
  const { owner, repo, issueNumber, taskNumber } = params;
  const config = getConfig();
  const myUsername = config.github.username;

  const comment = getGitHubPhrase('task_progress', {
    number: String(taskNumber), details: progressMessage, username: myUsername,
  });

  const result = await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true };
}

//NOTE(self): Report task blocked
export async function reportTaskBlocked(
  params: ReportTaskParams,
  blockReason: string
): Promise<{ success: boolean; error?: string }> {
  const { owner, repo, issueNumber, taskNumber, plan } = params;
  const config = getConfig();
  const myUsername = config.github.username;

  logger.info('Reporting task blocked', { taskNumber, blockReason });

  //NOTE(self): Update plan body with blocked status (fresh read to avoid clobbering)
  const blockedUpdateResult = await freshUpdateTaskInPlan(owner, repo, issueNumber, taskNumber, {
    status: 'blocked',
    assignee: myUsername,
  });

  if (!blockedUpdateResult.success) {
    logger.warn('Failed to update plan body for blocked task', { taskNumber, error: blockedUpdateResult.error });
  }

  //NOTE(self): Update plan labels to reflect blocked state
  const blockedStatusResult = await updatePlanStatus(owner, repo, issueNumber, 'blocked');

  if (!blockedStatusResult.success) {
    logger.warn('Failed to update plan labels for blocked task', { taskNumber, error: blockedStatusResult.error });
  }

  //NOTE(self): Post blocking comment
  const task = plan.tasks.find(t => t.number === taskNumber);
  const comment = getGitHubPhrase('task_blocked', {
    number: String(taskNumber), title: task?.title || 'Unknown', details: blockReason, username: myUsername,
  });

  const blockedCommentResult = await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });

  if (!blockedCommentResult.success) {
    logger.warn('Failed to post blocked comment', { error: blockedCommentResult.error });
  }

  //NOTE(self): Release the assignee so another SOUL can potentially help
  const blockedRemoveResult = await removeIssueAssignee({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: [myUsername],
  });

  if (!blockedRemoveResult.success) {
    logger.warn('Failed to remove assignee after blocked', { error: blockedRemoveResult.error });
  }

  return { success: true };
}

//NOTE(self): Handle plan completion
async function handlePlanComplete(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<void> {
  logger.info('All tasks complete - finalizing plan', { owner, repo, issueNumber });

  //NOTE(self): Post completion announcement
  const completionResult = await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: getGitHubPhrase('plan_complete', {}),
  });

  if (!completionResult.success) {
    logger.warn('Failed to post plan completion comment', { error: completionResult.error });
  }

  //NOTE(self): Update labels to complete
  await updatePlanStatus(owner, repo, issueNumber, 'complete');
}

//NOTE(self): Report task failed (unrecoverable error)
export async function reportTaskFailed(
  params: ReportTaskParams,
  errorMessage: string
): Promise<{ success: boolean; error?: string }> {
  const { owner, repo, issueNumber, taskNumber, plan } = params;
  const config = getConfig();
  const myUsername = config.github.username;

  logger.error('Reporting task failed', { taskNumber, error: errorMessage });

  //NOTE(self): Update plan body with blocked status (failed = blocked for now)
  //NOTE(self): Fresh read to avoid clobbering concurrent writes
  const failedUpdateResult = await freshUpdateTaskInPlan(owner, repo, issueNumber, taskNumber, {
    status: 'blocked',
    assignee: null, //NOTE(self): Release assignee
  });

  if (!failedUpdateResult.success) {
    logger.warn('Failed to update plan body for failed task', { taskNumber, error: failedUpdateResult.error });
  }

  //NOTE(self): Post failure comment
  const task = plan.tasks.find(t => t.number === taskNumber);
  const comment = getGitHubPhrase('task_failed', {
    number: String(taskNumber), title: task?.title || 'Unknown', details: errorMessage, username: myUsername,
  });

  const failedCommentResult = await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });

  if (!failedCommentResult.success) {
    logger.warn('Failed to post failure comment', { error: failedCommentResult.error });
  }

  //NOTE(self): Release assignee
  const failedRemoveResult = await removeIssueAssignee({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: [myUsername],
  });

  if (!failedRemoveResult.success) {
    logger.warn('Failed to remove assignee after failure', { error: failedRemoveResult.error });
  }

  return { success: true };
}
