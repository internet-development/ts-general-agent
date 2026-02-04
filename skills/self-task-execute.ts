//NOTE(self): Execute a claimed task via Claude Code
//NOTE(self): Extends the self-improve-run.ts pattern for task execution

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { logger } from '@modules/logger.js';
import { runClaudeCode } from '@skills/self-improve-run.js';
import type { ParsedTask, ParsedPlan } from '@skills/self-plan-parse.js';

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

  return `You are executing a task from a collaborative multi-SOUL plan.

**Repository:** ${repoFullName}
**Plan:** ${plan.title}
**Goal:** ${plan.goal}

---

## Your Task: Task ${task.number} - ${task.title}

${filesSection}

${dependenciesSection}

**Description:**
${task.description}

---

## Constraints

1. **Stay focused on THIS task only** - Do not work on other tasks
2. **Commit your changes** with message: \`task(${task.number}): ${task.title}\`
3. **If blocked**, explain clearly what's preventing completion
4. **Test your changes** if tests exist
5. **Keep changes minimal** - only what's needed for this task

## Process

1. Read and understand the task description
2. Explore the codebase to understand context
3. Make the necessary changes
4. Test if possible
5. Commit with the specified message format
6. Report what was done

Proceed.`;
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

//NOTE(self): Clone or update the workspace repository
export async function ensureWorkspace(
  owner: string,
  repo: string,
  baseDir: string
): Promise<{ success: boolean; path: string; error?: string }> {
  const workspacePath = path.join(baseDir, `${owner}-${repo}`);

  //NOTE(self): Check if already cloned
  if (fs.existsSync(path.join(workspacePath, '.git'))) {
    logger.debug('Workspace already exists, pulling latest', { workspacePath });

    //NOTE(self): Pull latest changes
    return new Promise((resolve) => {
      const git = spawn('git', ['pull', '--rebase'], {
        cwd: workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      git.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      git.on('close', (code) => {
        if (code !== 0) {
          logger.warn('Git pull failed', { code, stderr });
          //NOTE(self): Continue anyway - we have the repo
        }
        resolve({ success: true, path: workspacePath });
      });

      git.on('error', (err) => {
        logger.warn('Git pull error', { error: err.message });
        resolve({ success: true, path: workspacePath }); //NOTE(self): Continue anyway
      });
    });
  }

  //NOTE(self): Clone the repository
  logger.info('Cloning workspace repository', { owner, repo, workspacePath });

  const cloneUrl = `https://github.com/${owner}/${repo}.git`;

  return new Promise((resolve) => {
    //NOTE(self): Ensure parent directory exists
    const parentDir = path.dirname(workspacePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const git = spawn('git', ['clone', cloneUrl, workspacePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    git.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    git.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, path: '', error: `Git clone failed: ${stderr}` });
        return;
      }
      resolve({ success: true, path: workspacePath });
    });

    git.on('error', (err) => {
      resolve({ success: false, path: '', error: `Git clone error: ${err.message}` });
    });
  });
}

//NOTE(self): Push changes after task completion
export async function pushChanges(workspacePath: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const git = spawn('git', ['push'], {
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
