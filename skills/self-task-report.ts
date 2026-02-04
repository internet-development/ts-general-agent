//NOTE(self): Report task progress and completion via GitHub comments
//NOTE(self): Updates plan body and posts status comments

import { createIssueComment } from '@adapters/github/create-comment-issue.js';
import { updateIssue } from '@adapters/github/update-issue.js';
import { removeIssueAssignee } from '@adapters/github/remove-issue-assignee.js';
import { logger } from '@modules/logger.js';
import { getConfig } from '@modules/config.js';
import {
  updateTaskInPlanBody,
  type ParsedPlan,
  type ParsedTask,
  type TaskStatus,
} from '@skills/self-plan-parse.js';
import { updatePlanStatus, closePlan } from '@skills/self-plan-create.js';

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
): Promise<{ success: boolean; error?: string }> {
  const { owner, repo, issueNumber, taskNumber, plan } = params;
  const config = getConfig();
  const myUsername = config.github.username;

  logger.info('Reporting task completion', { taskNumber, owner, repo, issueNumber });

  //NOTE(self): Find the task
  const task = plan.tasks.find(t => t.number === taskNumber);
  if (!task) {
    return { success: false, error: `Task ${taskNumber} not found` };
  }

  //NOTE(self): Update plan body with completed status
  const newBody = updateTaskInPlanBody(plan.rawBody, taskNumber, {
    status: 'completed',
    assignee: myUsername,
  });

  const updateResult = await updateIssue({
    owner,
    repo,
    issue_number: issueNumber,
    body: newBody,
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

  const comment = `✅ **Task ${taskNumber} Complete: ${task.title}**

${report.summary}${filesSection}${testsSection}

---
*Completed by @${myUsername}*`;

  await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });

  //NOTE(self): Check if all tasks are complete
  const updatedPlan = { ...plan, rawBody: newBody };
  const allComplete = plan.tasks.every(t =>
    t.number === taskNumber ? true : t.status === 'completed'
  );

  if (allComplete) {
    await handlePlanComplete(owner, repo, issueNumber);
  }

  //NOTE(self): Remove assignee (task is done, we're free for next task)
  await removeIssueAssignee({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: [myUsername],
  });

  return { success: true };
}

//NOTE(self): Report task progress (for long-running tasks)
export async function reportTaskProgress(
  params: ReportTaskParams,
  progressMessage: string
): Promise<{ success: boolean; error?: string }> {
  const { owner, repo, issueNumber, taskNumber } = params;
  const config = getConfig();
  const myUsername = config.github.username;

  const comment = `🔄 **Task ${taskNumber} Progress**

${progressMessage}

---
*Progress update by @${myUsername}*`;

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

  //NOTE(self): Update plan body with blocked status
  const newBody = updateTaskInPlanBody(plan.rawBody, taskNumber, {
    status: 'blocked',
    assignee: myUsername,
  });

  await updateIssue({
    owner,
    repo,
    issue_number: issueNumber,
    body: newBody,
  });

  //NOTE(self): Update plan labels to reflect blocked state
  await updatePlanStatus(owner, repo, issueNumber, 'blocked');

  //NOTE(self): Post blocking comment
  const task = plan.tasks.find(t => t.number === taskNumber);
  const comment = `🚫 **Task ${taskNumber} Blocked: ${task?.title || 'Unknown'}**

**Reason:**
${blockReason}

This task cannot proceed until the blocking issue is resolved. Another SOUL may need to help.

---
*Blocked by @${myUsername}*`;

  await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });

  //NOTE(self): Release the assignee so another SOUL can potentially help
  await removeIssueAssignee({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: [myUsername],
  });

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
  await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `🎉 **Plan Complete!**

All tasks have been completed. The plan is now ready for final verification.

Please review:
- [ ] All changes are correct
- [ ] Tests pass
- [ ] Integration works as expected

Once verified, this issue can be closed.`,
  });

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
  const newBody = updateTaskInPlanBody(plan.rawBody, taskNumber, {
    status: 'blocked',
    assignee: null, //NOTE(self): Release assignee
  });

  await updateIssue({
    owner,
    repo,
    issue_number: issueNumber,
    body: newBody,
  });

  //NOTE(self): Post failure comment
  const task = plan.tasks.find(t => t.number === taskNumber);
  const comment = `❌ **Task ${taskNumber} Failed: ${task?.title || 'Unknown'}**

**Error:**
\`\`\`
${errorMessage}
\`\`\`

This task encountered an error and could not be completed. Manual intervention may be required.

---
*Failed attempt by @${myUsername}*`;

  await createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });

  //NOTE(self): Release assignee
  await removeIssueAssignee({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: [myUsername],
  });

  return { success: true };
}
