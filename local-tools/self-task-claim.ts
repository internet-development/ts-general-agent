//NOTE(self): Claim a task from a plan via GitHub assignee API
//NOTE(self): Uses first-writer-wins: if someone else claimed first, we gracefully fail

import * as fs from 'fs';
import * as path from 'path';
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
import { getIssueThread } from '@adapters/github/get-issue-thread.js';

//NOTE(self): Claim tracker — prevents duplicate claim comments
//NOTE(self): Key: "owner/repo#issueNumber/task-N", Value: timestamp of claim
//NOTE(self): Persisted to disk so restarts don't lose claim memory
//NOTE(self): Set BEFORE any async work to prevent TOCTOU races between concurrent callers
const claimedTasks: Map<string, number> = new Map();
const CLAIMED_TASKS_PATH = '.memory/claimed_tasks.json';

//NOTE(self): Load claimed tasks from disk on module init
function loadClaimedTasks(): void {
  try {
    if (fs.existsSync(CLAIMED_TASKS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CLAIMED_TASKS_PATH, 'utf8'));
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          claimedTasks.set(key, value as number);
        }
        logger.info('Loaded claimed tasks from disk', { count: claimedTasks.size });
      }
    }
  } catch (err) {
    logger.warn('Failed to load claimed tasks from disk', { error: String(err) });
  }
}

//NOTE(self): Persist claimed tasks to disk after changes
function saveClaimedTasks(): void {
  try {
    const dir = path.dirname(CLAIMED_TASKS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, number> = {};
    for (const [key, value] of claimedTasks) {
      obj[key] = value;
    }
    fs.writeFileSync(CLAIMED_TASKS_PATH, JSON.stringify(obj, null, 2));
  } catch (err) {
    logger.warn('Failed to save claimed tasks to disk', { error: String(err) });
  }
}

//NOTE(self): Load on module init — survives restarts
loadClaimedTasks();

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

  //NOTE(self): Claim dedup — reject if we already claimed this task (persisted across restarts)
  const claimKey = `${owner}/${repo}#${issueNumber}/task-${taskNumber}`;
  if (claimedTasks.has(claimKey)) {
    logger.info('Blocked duplicate claim attempt (persisted guard)', { claimKey });
    return { success: false, claimed: false, error: `Task ${taskNumber} already claimed by us (dedup)` };
  }

  //NOTE(self): LOCK IMMEDIATELY — set before any await to prevent TOCTOU races
  //NOTE(self): Two concurrent callers both checking has() before either sets would both pass
  //NOTE(self): By setting here (synchronously), the second caller is blocked even if the first is mid-await
  claimedTasks.set(claimKey, Date.now());
  saveClaimedTasks();

  //NOTE(self): Find the task in the plan
  const task = plan.tasks.find(t => t.number === taskNumber);
  if (!task) {
    claimedTasks.delete(claimKey);
    saveClaimedTasks();
    return { success: false, claimed: false, error: `Task ${taskNumber} not found in plan` };
  }

  //NOTE(self): Check if task is claimable — pending or blocked (blocked = failed execution, eligible for retry)
  if (task.status !== 'pending' && task.status !== 'blocked') {
    claimedTasks.delete(claimKey);
    saveClaimedTasks();
    return { success: false, claimed: false, error: `Task ${taskNumber} is not claimable (status: ${task.status})` };
  }

  if (task.assignee) {
    claimedTasks.delete(claimKey);
    saveClaimedTasks();
    return { success: false, claimed: false, claimedBy: task.assignee, error: `Task ${taskNumber} already claimed by ${task.assignee}` };
  }

  //NOTE(self): Check dependencies
  const completedTaskIds = new Set(
    plan.tasks.filter(t => t.status === 'completed').map(t => `Task ${t.number}`)
  );
  for (const dep of task.dependencies) {
    if (!completedTaskIds.has(dep)) {
      claimedTasks.delete(claimKey);
      saveClaimedTasks();
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
      claimedTasks.delete(claimKey);
      saveClaimedTasks();
      return { success: false, claimed: false, claimedBy: freshTask.assignee, error: `Task ${taskNumber} already claimed by ${freshTask.assignee}` };
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
    claimedTasks.delete(claimKey);
    saveClaimedTasks();
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

  //NOTE(self): Check existing comments before posting — belt-and-suspenders dedup
  //NOTE(self): Even if the in-memory guard failed (restart, race), we check the actual GitHub state
  let alreadyCommented = false;
  try {
    const threadResult = await getIssueThread({ owner, repo, issue_number: issueNumber });
    if (threadResult.success && threadResult.data) {
      const myComments = threadResult.data.comments.filter(
        c => c.user.login.toLowerCase() === myUsername.toLowerCase()
      );
      alreadyCommented = myComments.some(
        c => c.body && c.body.includes(`Task ${taskNumber}`) && /claim/i.test(c.body)
      );
      if (alreadyCommented) {
        logger.info('Skipping claim comment — duplicate already exists on issue', { claimKey });
      }
    }
  } catch (err) {
    logger.warn('Failed to check existing comments (non-fatal, will post)', { error: String(err) });
  }

  //NOTE(self): Post a comment announcing the claim (only if not already posted)
  if (!alreadyCommented) {
    const claimCommentResult = await createIssueComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: getGitHubPhrase('task_claim', { number: String(taskNumber), title: task.title }),
    });

    if (!claimCommentResult.success) {
      logger.warn('Failed to post claim comment', { error: claimCommentResult.error });
    }
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
