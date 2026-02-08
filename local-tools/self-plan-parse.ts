//NOTE(self): Parse plan markdown from GitHub issues into structured data
//NOTE(self): Plans follow a specific markdown format with tasks, status, assignees, etc.

import { logger } from '@modules/logger.js';
import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import { updateIssue } from '@adapters/github/update-issue.js';

const GITHUB_API = 'https://api.github.com';

//NOTE(self): Task status state machine: pending → claimed → in_progress → completed
//NOTE(self): blocked → pending (after unblock)
export type TaskStatus = 'pending' | 'claimed' | 'in_progress' | 'completed' | 'blocked';

export interface ParsedTask {
  id: string;
  number: number;
  title: string;
  status: TaskStatus;
  assignee: string | null;
  estimate: string | null;
  dependencies: string[];
  files: string[];
  description: string;
  //NOTE(self): Raw markdown section for this task
  rawMarkdown: string;
}

export interface ParsedPlan {
  title: string;
  goal: string;
  context: string;
  tasks: ParsedTask[];
  verification: string[];
  labels: string[];
  //NOTE(self): Plan-level status derived from task states
  status: 'active' | 'complete' | 'blocked';
  //NOTE(self): Raw issue body for updates
  rawBody: string;
}

//NOTE(self): Parse a plan issue body into structured data
export function parsePlan(issueBody: string, issueTitle: string): ParsedPlan | null {
  if (!issueBody) {
    logger.warn('Cannot parse empty plan body');
    return null;
  }

  //NOTE(self): Check if this is a plan issue (starts with # [PLAN])
  if (!issueTitle.startsWith('[PLAN]') && !issueBody.includes('# [PLAN]')) {
    logger.debug('Issue is not a plan (no [PLAN] marker)');
    return null;
  }

  const lines = issueBody.split('\n');
  const plan: ParsedPlan = {
    title: issueTitle.replace('[PLAN]', '').trim(),
    goal: '',
    context: '',
    tasks: [],
    verification: [],
    labels: [],
    status: 'active',
    rawBody: issueBody,
  };

  let currentSection: 'goal' | 'context' | 'tasks' | 'verification' | 'none' = 'none';
  let currentTask: ParsedTask | null = null;
  let currentTaskContent: string[] = [];
  let taskNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    //NOTE(self): Section headers
    if (trimmed.startsWith('## Goal')) {
      currentSection = 'goal';
      continue;
    }
    if (trimmed.startsWith('## Context')) {
      currentSection = 'context';
      continue;
    }
    if (trimmed.startsWith('## Tasks')) {
      currentSection = 'tasks';
      continue;
    }
    if (trimmed.startsWith('## Verification')) {
      currentSection = 'verification';
      //NOTE(self): Flush current task if any
      if (currentTask) {
        currentTask.description = currentTaskContent.join('\n').trim();
        currentTask.rawMarkdown = formatTaskMarkdown(currentTask);
        plan.tasks.push(currentTask);
        currentTask = null;
        currentTaskContent = [];
      }
      continue;
    }

    //NOTE(self): Parse content based on current section
    switch (currentSection) {
      case 'goal':
        if (trimmed) plan.goal += (plan.goal ? ' ' : '') + trimmed;
        break;

      case 'context':
        if (trimmed) plan.context += (plan.context ? '\n' : '') + trimmed;
        break;

      case 'tasks':
        //NOTE(self): New task starts with ### Task N:
        const taskMatch = trimmed.match(/^### Task (\d+):\s*(.+)$/);
        if (taskMatch) {
          //NOTE(self): Flush previous task
          if (currentTask) {
            currentTask.description = currentTaskContent.join('\n').trim();
            currentTask.rawMarkdown = formatTaskMarkdown(currentTask);
            plan.tasks.push(currentTask);
          }

          taskNumber = parseInt(taskMatch[1], 10);
          currentTask = {
            id: `task-${taskNumber}`,
            number: taskNumber,
            title: taskMatch[2],
            status: 'pending',
            assignee: null,
            estimate: null,
            dependencies: [],
            files: [],
            description: '',
            rawMarkdown: '',
          };
          currentTaskContent = [];
          continue;
        }

        //NOTE(self): Task metadata lines
        if (currentTask) {
          const statusMatch = trimmed.match(/^\*\*Status:\*\*\s*(.+)$/);
          if (statusMatch) {
            const status = statusMatch[1].toLowerCase().trim() as TaskStatus;
            if (['pending', 'claimed', 'in_progress', 'completed', 'blocked'].includes(status)) {
              currentTask.status = status;
            }
            continue;
          }

          const assigneeMatch = trimmed.match(/^\*\*Assignee:\*\*\s*@?(.+)$/);
          if (assigneeMatch) {
            const assignee = assigneeMatch[1].trim();
            currentTask.assignee = assignee && assignee !== '(empty if unclaimed)' ? assignee : null;
            continue;
          }

          const estimateMatch = trimmed.match(/^\*\*Estimate:\*\*\s*(.+)$/);
          if (estimateMatch) {
            currentTask.estimate = estimateMatch[1].trim();
            continue;
          }

          const depsMatch = trimmed.match(/^\*\*Dependencies:\*\*\s*(.+)$/);
          if (depsMatch) {
            const deps = depsMatch[1].trim();
            if (deps.toLowerCase() !== 'none') {
              currentTask.dependencies = deps.split(',').map(d => d.trim()).filter(Boolean);
            }
            continue;
          }

          //NOTE(self): Files section
          if (trimmed === '**Files:**') {
            continue;
          }
          if (trimmed.startsWith('- `') && currentTask.files !== undefined) {
            const fileMatch = trimmed.match(/^- `([^`]+)`/);
            if (fileMatch) {
              currentTask.files.push(fileMatch[1]);
            }
            continue;
          }

          //NOTE(self): Description section
          if (trimmed === '**Description:**') {
            continue;
          }

          //NOTE(self): Task separator
          if (trimmed === '---') {
            continue;
          }

          //NOTE(self): Add to description content
          currentTaskContent.push(line);
        }
        break;

      case 'verification':
        //NOTE(self): Parse checkbox items
        const checkMatch = trimmed.match(/^- \[([ x])\]\s*(.+)$/);
        if (checkMatch) {
          const checked = checkMatch[1] === 'x';
          plan.verification.push(`${checked ? '✓' : '○'} ${checkMatch[2]}`);
        }
        break;
    }
  }

  //NOTE(self): Flush final task
  if (currentTask) {
    currentTask.description = currentTaskContent.join('\n').trim();
    currentTask.rawMarkdown = formatTaskMarkdown(currentTask);
    plan.tasks.push(currentTask);
  }

  //NOTE(self): Derive plan status from tasks
  if (plan.tasks.length === 0) {
    plan.status = 'active';
  } else if (plan.tasks.every(t => t.status === 'completed')) {
    plan.status = 'complete';
  } else if (plan.tasks.some(t => t.status === 'blocked')) {
    plan.status = 'blocked';
  } else {
    plan.status = 'active';
  }

  logger.debug('Parsed plan', {
    title: plan.title,
    taskCount: plan.tasks.length,
    status: plan.status,
  });

  return plan;
}

//NOTE(self): Format a task back to markdown (for updating issue body)
function formatTaskMarkdown(task: ParsedTask): string {
  const lines: string[] = [];
  lines.push(`### Task ${task.number}: ${task.title}`);
  lines.push(`**Status:** ${task.status}`);
  lines.push(`**Assignee:** ${task.assignee ? `@${task.assignee}` : '(empty if unclaimed)'}`);
  if (task.estimate) {
    lines.push(`**Estimate:** ${task.estimate}`);
  }
  lines.push(`**Dependencies:** ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'none'}`);
  if (task.files.length > 0) {
    lines.push('**Files:**');
    for (const file of task.files) {
      lines.push(`- \`${file}\``);
    }
  }
  lines.push('');
  lines.push('**Description:**');
  lines.push(task.description);
  return lines.join('\n');
}

//NOTE(self): Get claimable tasks (pending, no assignee, dependencies met)
export function getClaimableTasks(plan: ParsedPlan): ParsedTask[] {
  const completedTaskIds = new Set(
    plan.tasks
      .filter(t => t.status === 'completed')
      .map(t => `Task ${t.number}`)
  );

  return plan.tasks.filter(task => {
    //NOTE(self): Must be pending or blocked (blocked = failed execution, eligible for retry)
    if (task.status !== 'pending' && task.status !== 'blocked') return false;
    if (task.assignee) return false;

    //NOTE(self): All dependencies must be completed
    for (const dep of task.dependencies) {
      if (!completedTaskIds.has(dep)) return false;
    }

    return true;
  });
}

//NOTE(self): Update a task's status in the plan body and return new body
export function updateTaskInPlanBody(
  planBody: string,
  taskNumber: number,
  updates: {
    status?: TaskStatus;
    assignee?: string | null;
  }
): string {
  const lines = planBody.split('\n');
  const result: string[] = [];
  let inTargetTask = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    //NOTE(self): Check if we're entering the target task
    const taskMatch = trimmed.match(/^### Task (\d+):/);
    if (taskMatch) {
      inTargetTask = parseInt(taskMatch[1], 10) === taskNumber;
    }

    //NOTE(self): Check if we're exiting the task section
    if (inTargetTask && (trimmed.startsWith('## ') || (trimmed === '---' && i + 1 < lines.length && lines[i + 1].trim().startsWith('### Task')))) {
      inTargetTask = false;
    }

    //NOTE(self): Update status line if in target task
    if (inTargetTask && updates.status !== undefined) {
      const statusMatch = trimmed.match(/^\*\*Status:\*\*/);
      if (statusMatch) {
        result.push(`**Status:** ${updates.status}`);
        continue;
      }
    }

    //NOTE(self): Update assignee line if in target task
    if (inTargetTask && updates.assignee !== undefined) {
      const assigneeMatch = trimmed.match(/^\*\*Assignee:\*\*/);
      if (assigneeMatch) {
        result.push(`**Assignee:** ${updates.assignee ? `@${updates.assignee}` : '(empty if unclaimed)'}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

//NOTE(self): Check if a task's dependencies are all completed
export function areDependenciesMet(task: ParsedTask, plan: ParsedPlan): boolean {
  if (task.dependencies.length === 0) return true;

  const completedTaskIds = new Set(
    plan.tasks
      .filter(t => t.status === 'completed')
      .map(t => `Task ${t.number}`)
  );

  return task.dependencies.every(dep => completedTaskIds.has(dep));
}

//NOTE(self): Fetch the latest plan body from GitHub and re-parse it
//NOTE(self): Used to avoid stale plan data in claim/report flows
export async function fetchFreshPlan(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{ success: boolean; plan?: ParsedPlan; error?: string }> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}`,
      { headers: getAuthHeaders() }
    );

    if (!response.ok) {
      //NOTE(self): Safe JSON parse — GitHub may return HTML for 502/503
      let errorMessage = `Failed to fetch issue: ${response.status}`;
      try {
        const error = await response.json();
        errorMessage = error.message || errorMessage;
      } catch { /* non-JSON error response */ }
      return { success: false, error: errorMessage };
    }

    const issue = await response.json();
    const plan = parsePlan(issue.body || '', issue.title || '');
    if (!plan) {
      return { success: false, error: 'Failed to parse plan from fresh issue body' };
    }

    return { success: true, plan };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

//NOTE(self): Read-modify-write helper that fetches the LATEST issue body before writing
//NOTE(self): Minimizes the race window from minutes (stale plan.rawBody) to ~200ms (one round-trip)
export async function freshUpdateTaskInPlan(
  owner: string,
  repo: string,
  issueNumber: number,
  taskNumber: number,
  updates: { status?: TaskStatus; assignee?: string | null }
): Promise<{ success: boolean; error?: string }> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  try {
    //NOTE(self): GET the latest body right before writing
    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}`,
      { headers: getAuthHeaders() }
    );

    if (!response.ok) {
      //NOTE(self): Safe JSON parse — GitHub may return HTML for 502/503
      let errorMessage = `Failed to fetch issue: ${response.status}`;
      try {
        const error = await response.json();
        errorMessage = error.message || errorMessage;
      } catch { /* non-JSON error response */ }
      return { success: false, error: errorMessage };
    }

    const issue = await response.json();
    const freshBody = issue.body || '';

    //NOTE(self): Apply the update to the fresh body
    const newBody = updateTaskInPlanBody(freshBody, taskNumber, updates);

    //NOTE(self): PATCH with the fresh result
    const updateResult = await updateIssue({
      owner,
      repo,
      issue_number: issueNumber,
      body: newBody,
    });

    if (!updateResult.success) {
      return { success: false, error: updateResult.error };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
