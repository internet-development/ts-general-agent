//NOTE(self): Execute a claimed task via Claude Code
//NOTE(self): Extends the self-improve-run.ts pattern for task execution

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { logger } from '@modules/logger.js';
import { runClaudeCode } from '@local-tools/self-improve-run.js';
import type { ParsedTask, ParsedPlan } from '@local-tools/self-plan-parse.js';
import { renderSkill } from '@modules/skills.js';
import { cloneRepository } from '@adapters/github/clone-repository.js';

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

//NOTE(self): Create a pull request using gh CLI
export async function createPullRequest(
  owner: string,
  repo: string,
  branchName: string,
  title: string,
  body: string,
  workspacePath: string
): Promise<{ success: boolean; prUrl?: string; error?: string }> {
  return new Promise((resolve) => {
    const gh = spawn('gh', [
      'pr', 'create',
      '--repo', `${owner}/${repo}`,
      '--head', branchName,
      '--title', title,
      '--body', body,
    ], {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    gh.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    gh.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    gh.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: `gh pr create failed: ${stderr}` });
        return;
      }
      const prUrl = stdout.trim();
      logger.info('Created pull request', { prUrl, branchName });
      resolve({ success: true, prUrl });
    });

    gh.on('error', (err) => {
      resolve({ success: false, error: `gh pr create error: ${err.message}` });
    });
  });
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
