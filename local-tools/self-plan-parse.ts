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

//NOTE(self): Split a dependency string into individual dependency items
//NOTE(self): Only commas are reliable separators in the first pass.
//NOTE(self): Semicolons are ambiguous — "Task 3; Task 4" vs "Wire parser into page; ensure weights work"
//NOTE(self): Semicolon splitting is deferred to the second pass (title resolution) where we have context.
function splitDependencies(deps: string): string[] {
  return deps.split(',');
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
              //NOTE(self): Normalize dependency strings to canonical "Task N" format
              //NOTE(self): Handles: "Task 2", "task 2", "Task-2", "2", "task-2", etc.
              //NOTE(self): Split by comma first, then by semicolon as fallback
              //NOTE(self): (LLMs sometimes use ; as separator, but also as mid-sentence punctuation)
              currentTask.dependencies = splitDependencies(deps).map(d => {
                const trimmedDep = d.trim();
                if (!trimmedDep) return '';
                //NOTE(self): Extract task number ONLY if the string looks like a task reference
                //NOTE(self): "Task 3", "task-3", "3" → "Task 3"
                //NOTE(self): But NOT "v1 query parser" (spurious digit in title text)
                const taskRefMatch = trimmedDep.match(/^(?:task[\s\-]*)(\d+)$/i);
                if (taskRefMatch) {
                  return `Task ${taskRefMatch[1]}`;
                }
                //NOTE(self): Pure number
                if (/^\d+$/.test(trimmedDep)) {
                  return `Task ${trimmedDep}`;
                }
                //NOTE(self): Title-based dependency — keep raw for second-pass resolution
                return trimmedDep;
              }).filter(Boolean);
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

  //NOTE(self): Second pass — resolve title-based dependencies to "Task N" format
  //NOTE(self): LLMs sometimes write dependencies as full task titles instead of "Task 3"
  //NOTE(self): e.g. "Implement strict v1 query parser" → match against task 3's title → "Task 3"
  function resolveTitleDep(dep: string, titleMap: Map<string, number>): number | null {
    const depLower = dep.toLowerCase().trim();

    //NOTE(self): Try exact match against task titles (case-insensitive)
    const exactMatch = titleMap.get(depLower);
    if (exactMatch !== undefined) return exactMatch;

    //NOTE(self): Try substring match — dep text may be a subset or superset of a title
    //NOTE(self): Use the longest matching title to avoid false positives
    let bestMatch: { number: number; length: number } | null = null;
    for (const [title, num] of titleMap) {
      if (depLower.includes(title) || title.includes(depLower)) {
        if (!bestMatch || title.length > bestMatch.length) {
          bestMatch = { number: num, length: title.length };
        }
      }
    }
    return bestMatch ? bestMatch.number : null;
  }

  if (plan.tasks.length > 0) {
    //NOTE(self): Build a map of normalized task titles → task numbers
    const titleToNumber = new Map<string, number>();
    for (const task of plan.tasks) {
      titleToNumber.set(task.title.toLowerCase().trim(), task.number);
    }

    for (const task of plan.tasks) {
      const resolved: string[] = [];
      for (const dep of task.dependencies) {
        //NOTE(self): Already in canonical format
        if (/^Task \d+$/.test(dep)) {
          resolved.push(dep);
          continue;
        }

        const match = resolveTitleDep(dep, titleToNumber);
        if (match !== null) {
          resolved.push(`Task ${match}`);
          continue;
        }

        //NOTE(self): No match — try splitting by semicolon (deferred from first pass)
        //NOTE(self): "Wire parser into page; ensure weights work" might be two deps or one
        if (dep.includes(';')) {
          const fragments = dep.split(';').map(f => f.trim()).filter(Boolean);
          let allResolved = true;
          const fragmentResults: string[] = [];
          for (const frag of fragments) {
            const fragMatch = resolveTitleDep(frag, titleToNumber);
            if (fragMatch !== null) {
              fragmentResults.push(`Task ${fragMatch}`);
            } else {
              allResolved = false;
              break;
            }
          }
          if (allResolved && fragmentResults.length > 0) {
            resolved.push(...fragmentResults);
            continue;
          }
          //NOTE(self): Semicolons weren't separators — try the whole string as a substring
        }

        //NOTE(self): Unresolvable — log and keep raw string (will block the task)
        logger.warn('Could not resolve title-based dependency to task number', { task: task.number, dependency: dep });
        resolved.push(dep);
      }
      task.dependencies = resolved;
    }
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
