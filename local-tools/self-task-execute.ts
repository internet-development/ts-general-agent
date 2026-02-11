//NOTE(self): Execute a claimed task via Claude Code
//NOTE(self): Extends the self-improve-run.ts pattern for task execution

import * as path from 'path';
import * as fs from 'fs';
import { spawn, execSync } from 'child_process';
import { logger } from '@modules/logger.js';
import { runClaudeCode } from '@local-tools/self-improve-run.js';
import type { ParsedTask, ParsedPlan } from '@local-tools/self-plan-parse.js';
import { renderSkill } from '@modules/skills.js';
import { cloneRepository } from '@adapters/github/clone-repository.js';
import { createPullRequest as createPullRequestAPI } from '@adapters/github/create-pull-request.js';
import { requestPullRequestReviewers } from '@adapters/github/request-pull-request-reviewers.js';
import { listRepositoryCollaborators } from '@adapters/github/list-repository-collaborators.js';
import { getAuth } from '@adapters/github/authenticate.js';
import { runGitCommand } from '@local-tools/self-task-verify.js';
import { createSlug } from '@common/strings.js';
import { getPeerUsernames, registerPeer } from '@modules/peer-awareness.js';

//NOTE(self): Generate a consistent branch name for a task
//NOTE(self): Shared by scheduler.ts and executor.ts to avoid divergent naming
export function getTaskBranchName(taskNumber: number, taskTitle: string): string {
  const prefix = `task-${taskNumber}-`;
  const maxSlugLen = 50 - prefix.length;
  const fullSlug = createSlug(taskTitle);
  const slug = fullSlug.length > maxSlugLen
    ? fullSlug.slice(0, maxSlugLen).replace(/-[^-]*$/, '') // truncate at word boundary
    : fullSlug;
  return `${prefix}${slug}`;
}

//NOTE(self): Generate candidate branch names for a task (current + legacy naming schemes)
//NOTE(self): Used by orphaned branch recovery to find branches created with old naming logic
export function getTaskBranchCandidates(taskNumber: number, taskTitle: string): string[] {
  const current = getTaskBranchName(taskNumber, taskTitle);

  //NOTE(self): Legacy naming: .slice(0, 40) with no word-boundary truncation
  const legacySlug = taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const legacy = `task-${taskNumber}-${legacySlug}`;

  //NOTE(self): Deduplicate (short titles produce identical results)
  const candidates = [current];
  if (legacy !== current) candidates.push(legacy);
  return candidates;
}

export interface TaskExecutionParams {
  owner: string;
  repo: string;
  task: ParsedTask;
  plan: ParsedPlan;
  workspacePath: string;
  memoryPath: string;
}

export interface TaskExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  //NOTE(self): Whether the task was blocked (couldn't complete)
  blocked?: boolean;
  blockReason?: string;
}

//NOTE(self): Build the task execution prompt for Claude Code
export function buildTaskPrompt(params: {
  plan: ParsedPlan;
  task: ParsedTask;
  repoFullName: string;
}): string {
  const { plan, task, repoFullName } = params;

  const filesSection = task.files.length > 0
    ? `**Files to modify:**\n${task.files.map(f => `- \`${f}\``).join('\n')}`
    : '**Files:** Determine based on task description';

  const dependenciesSection = task.dependencies.length > 0
    ? `**Completed dependencies:** ${task.dependencies.join(', ')}`
    : '';

  return renderSkill('AGENT-TASK-EXECUTION', {
    repoFullName,
    planTitle: plan.title,
    planGoal: plan.goal,
    taskNumber: String(task.number),
    taskTitle: task.title,
    filesSection,
    dependenciesSection,
    taskDescription: task.description,
  });
}

//NOTE(self): Execute a task via Claude Code
export async function executeTask(params: TaskExecutionParams): Promise<TaskExecutionResult> {
  const { owner, repo, task, plan, workspacePath, memoryPath } = params;

  logger.info('Executing task via Claude Code', {
    taskNumber: task.number,
    taskTitle: task.title,
    workspacePath,
  });

  //NOTE(self): Verify workspace exists
  if (!fs.existsSync(workspacePath)) {
    return {
      success: false,
      blocked: true,
      blockReason: `Workspace not found: ${workspacePath}`,
      error: `Workspace directory does not exist: ${workspacePath}`,
    };
  }

  //NOTE(self): Build the prompt
  const prompt = buildTaskPrompt({
    plan,
    task,
    repoFullName: `${owner}/${repo}`,
  });

  //NOTE(self): Execute via Claude Code
  const result = await runClaudeCode(prompt, workspacePath, memoryPath);

  if (!result.success) {
    //NOTE(self): Check if this is a blocking issue
    const errorLower = (result.error || '').toLowerCase();
    const isBlocked = errorLower.includes('blocked') ||
      errorLower.includes('cannot proceed') ||
      errorLower.includes('dependency') ||
      errorLower.includes('missing');

    return {
      success: false,
      error: result.error,
      blocked: isBlocked,
      blockReason: isBlocked ? result.error : undefined,
    };
  }

  logger.info('Task execution complete', {
    taskNumber: task.number,
    outputLength: result.output?.length || 0,
  });

  return {
    success: true,
    output: result.output,
  };
}

//NOTE(self): Configure git identity in a workspace so commits are attributed to the SOUL
//NOTE(self): Uses the SOUL's GitHub username + noreply email — local config only, never touches global
//NOTE(self): Also writes .claude/settings.json to suppress Co-Authored-By trailers
function configureGitIdentity(workspacePath: string): void {
  const auth = getAuth();
  if (!auth) return;

  const { username } = auth;
  const email = `${username}@users.noreply.github.com`;

  try {
    execSync(`git config user.name "${username}"`, { cwd: workspacePath, timeout: 5000 });
    execSync(`git config user.email "${email}"`, { cwd: workspacePath, timeout: 5000 });
    logger.info('Configured git identity for workspace', { username, email, workspacePath });
  } catch (err) {
    logger.warn('Failed to configure git identity (non-fatal)', { username, error: String(err) });
  }

  //NOTE(self): Suppress Claude Code co-author attribution — commits should only show the PAT user
  try {
    const claudeDir = path.join(workspacePath, '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    const settingsPath = path.join(claudeDir, 'settings.json');
    const settings = { attribution: { commit: '', pr: '' } };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    logger.debug('Wrote .claude/settings.json to suppress co-author attribution', { workspacePath });
  } catch (err) {
    logger.warn('Failed to write .claude/settings.json (non-fatal)', { error: String(err) });
  }
}

//NOTE(self): Fresh clone the workspace repository (rm + clone every time for clean state)
//NOTE(self): Uses cloneRepository adapter for authenticated HTTPS clones (supports private repos + push)
export async function ensureWorkspace(
  owner: string,
  repo: string,
  baseDir: string
): Promise<{ success: boolean; path: string; error?: string }> {
  const workspacePath = path.join(baseDir, `${owner}-${repo}`);

  //NOTE(self): Always start fresh — remove existing workspace if present
  if (fs.existsSync(workspacePath)) {
    logger.info('Removing existing workspace for fresh clone', { workspacePath });
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }

  //NOTE(self): Ensure parent directory exists
  const parentDir = path.dirname(workspacePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  //NOTE(self): Clone via authenticated adapter (embeds token in HTTPS URL for push support)
  logger.info('Cloning workspace repository', { owner, repo, workspacePath });

  const result = await cloneRepository({ owner, repo, targetDir: workspacePath });

  if (!result.success) {
    return { success: false, path: '', error: result.error };
  }

  //NOTE(self): Configure git identity so commits are attributed to the SOUL, not the host machine
  configureGitIdentity(workspacePath);

  //NOTE(self): Install dependencies if package.json exists — without this, test runners
  //NOTE(self): (vitest, jest, etc.) aren't in node_modules/.bin and npm test fails with
  //NOTE(self): "command not found". This caused issue #29 to loop ~20 times.
  const packageJsonPath = path.join(workspacePath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      logger.info('Installing workspace dependencies', { workspacePath });
      execSync('npm install --ignore-scripts 2>&1', {
        cwd: workspacePath,
        timeout: 120_000, // 2 min cap
        encoding: 'utf-8',
        env: { ...process.env, CI: 'true' },
      });
      logger.info('Workspace dependencies installed');
    } catch (err) {
      //NOTE(self): Non-fatal — workspace may not need dependencies, or npm may not be available
      logger.warn('Failed to install workspace dependencies (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { success: true, path: workspacePath };
}

//NOTE(self): Create a feature branch in the workspace
export async function createBranch(
  workspacePath: string,
  branchName: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const git = spawn('git', ['checkout', '-b', branchName], {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    git.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    git.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: `Git checkout -b failed: ${stderr}` });
        return;
      }
      logger.info('Created feature branch', { branchName, workspacePath });
      resolve({ success: true });
    });

    git.on('error', (err) => {
      resolve({ success: false, error: `Git branch error: ${err.message}` });
    });
  });
}

//NOTE(self): Detect the default branch from a cloned workspace
function getDefaultBranch(workspacePath: string): string {
  try {
    const result = execSync(
      'git symbolic-ref refs/remotes/origin/HEAD',
      { cwd: workspacePath, encoding: 'utf-8', timeout: 5000 }
    ).trim();
    //NOTE(self): Returns e.g. "refs/remotes/origin/main" — extract branch name
    return result.replace('refs/remotes/origin/', '') || 'main';
  } catch {
    return 'main';
  }
}

//NOTE(self): Create a pull request using the GitHub REST API via PAT
//NOTE(self): Replaces the previous gh CLI approach — PAT is always available, gh CLI may not be
export async function createPullRequest(
  owner: string,
  repo: string,
  branchName: string,
  title: string,
  body: string,
  workspacePath: string
): Promise<{ success: boolean; prUrl?: string; prNumber?: number; error?: string }> {
  const baseBranch = getDefaultBranch(workspacePath);

  logger.info('Creating pull request via GitHub API', { owner, repo, branchName, baseBranch });

  const result = await createPullRequestAPI({
    owner,
    repo,
    title,
    body,
    head: branchName,
    base: baseBranch,
  });

  if (!result.success) {
    return { success: false, error: `PR creation failed: ${result.error}` };
  }

  const prUrl = result.data.html_url;
  if (!prUrl) {
    return { success: false, error: 'PR creation succeeded but no URL returned' };
  }

  const prNumber = result.data.number;
  logger.info('Created pull request', { prUrl, prNumber, branchName });
  return { success: true, prUrl, prNumber };
}

//NOTE(self): Request reviewers for a PR after creation
//NOTE(self): Central function used by all 3 callers (scheduler executeClaimedTask, recoverOrphanedBranches, executor)
//NOTE(self): Non-fatal — failures are logged but never block PR creation or task completion
export async function requestReviewersForPR(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<{ requested: string[]; skipped: string[]; error?: string }> {
  const auth = getAuth();
  const selfUsername = auth?.username;

  //NOTE(self): Get candidates from peer registry first
  let candidates = getPeerUsernames().filter(u => u !== selfUsername);

  //NOTE(self): Cold-start fallback: discover collaborators when peer registry is empty
  if (candidates.length === 0) {
    const collabResult = await listRepositoryCollaborators(owner, repo);
    if (collabResult.success && collabResult.data.length > 0) {
      //NOTE(self): Filter to push-access users, exclude self
      const pushCollaborators = collabResult.data
        .filter(c => c.permissions.push && c.login !== selfUsername);

      //NOTE(self): Register discovered collaborators as peers (seeds registry for future PRs)
      for (const collab of pushCollaborators) {
        registerPeer(collab.login, 'workspace', `${owner}/${repo}`);
      }

      candidates = pushCollaborators.map(c => c.login);
      if (candidates.length > 0) {
        logger.info('Discovered collaborators as reviewer candidates', {
          owner, repo, candidates,
        });
      }
    }
  }

  if (candidates.length === 0) {
    logger.info('No reviewer candidates found', { owner, repo, pullNumber });
    return { requested: [], skipped: [] };
  }

  //NOTE(self): Cap at 3 reviewers
  const reviewers = candidates.slice(0, 3);
  const skipped = candidates.slice(3);

  const result = await requestPullRequestReviewers({
    owner,
    repo,
    pull_number: pullNumber,
    reviewers,
  });

  if (!result.success) {
    logger.warn('Failed to request reviewers (non-fatal)', {
      owner, repo, pullNumber, reviewers, error: result.error,
    });
    return { requested: [], skipped: [], error: result.error };
  }

  const actuallyRequested = result.data.requested_reviewers.map(r => r.login);
  logger.info('Requested reviewers for PR', {
    owner, repo, pullNumber, requested: actuallyRequested,
  });

  return { requested: actuallyRequested, skipped };
}

//NOTE(self): Push changes after task completion (branch-aware)
export async function pushChanges(
  workspacePath: string,
  branchName?: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = branchName
      ? ['push', '-u', 'origin', branchName]
      : ['push'];

    const git = spawn('git', args, {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    git.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    git.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: `Git push failed: ${stderr}` });
        return;
      }
      resolve({ success: true });
    });

    git.on('error', (err) => {
      resolve({ success: false, error: `Git push error: ${err.message}` });
    });
  });
}

//NOTE(self): Check if a task branch exists on remote (orphaned = pushed but no PR)
export async function checkRemoteBranchExists(
  workspacePath: string,
  branchName: string
): Promise<boolean> {
  const result = await runGitCommand(
    ['ls-remote', '--heads', 'origin', branchName],
    workspacePath
  );
  return result.success && result.stdout.length > 0;
}

//NOTE(self): Find a remote branch by task number prefix when name-based candidates don't match
//NOTE(self): Handles the case where plan task titles were edited after branches were created
export async function findRemoteBranchByTaskNumber(
  workspacePath: string,
  taskNumber: number
): Promise<string | null> {
  const result = await runGitCommand(
    ['ls-remote', '--heads', 'origin'],
    workspacePath
  );
  if (!result.success) return null;

  const prefix = `task-${taskNumber}-`;
  const matches: string[] = [];

  for (const line of result.stdout.split('\n')) {
    //NOTE(self): ls-remote output format: "<sha>\trefs/heads/<branch>"
    const match = line.match(/refs\/heads\/(.+)$/);
    if (match && match[1].startsWith(prefix)) {
      matches.push(match[1]);
    }
  }

  //NOTE(self): Only return if exactly one match — ambiguity means we can't be sure
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    logger.info('Multiple branches match task number prefix, skipping ambiguous match', {
      taskNumber,
      prefix,
      matches,
    });
  }
  return null;
}

//NOTE(self): Recover an orphaned branch — fetch it, check it out, return workspace ready for PR creation
//NOTE(self): Used when a task branch was pushed but PR creation failed (task left in blocked state)
export async function recoverOrphanedBranch(
  owner: string,
  repo: string,
  branchName: string,
  baseDir: string
): Promise<{ success: boolean; workspacePath: string; error?: string }> {
  //NOTE(self): Clone the repo fresh
  const workspacePath = path.join(baseDir, `${owner}-${repo}`);

  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }

  const parentDir = path.dirname(workspacePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const cloneResult = await cloneRepository({ owner, repo, targetDir: workspacePath });
  if (!cloneResult.success) {
    return { success: false, workspacePath: '', error: `Clone failed: ${cloneResult.error}` };
  }

  //NOTE(self): Configure git identity so commits are attributed to the SOUL, not the host machine
  configureGitIdentity(workspacePath);

  //NOTE(self): Fetch the orphaned branch
  const fetchResult = await runGitCommand(
    ['fetch', 'origin', branchName],
    workspacePath
  );
  if (!fetchResult.success) {
    return { success: false, workspacePath, error: `Fetch branch failed: ${fetchResult.stderr}` };
  }

  //NOTE(self): Check out the branch (tracking remote)
  const checkoutResult = await runGitCommand(
    ['checkout', '-b', branchName, `origin/${branchName}`],
    workspacePath
  );
  if (!checkoutResult.success) {
    return { success: false, workspacePath, error: `Checkout failed: ${checkoutResult.stderr}` };
  }

  logger.info('Recovered orphaned branch', { owner, repo, branchName, workspacePath });
  return { success: true, workspacePath };
}
