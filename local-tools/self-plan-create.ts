//NOTE(self): Create structured plan issues from a plan definition
//NOTE(self): Plans are GitHub issues with specific markdown format

import { createIssue } from '@adapters/github/create-issue.js';
import { updateIssue } from '@adapters/github/update-issue.js';
import { logger } from '@modules/logger.js';
import type { TaskStatus, ParsedTask } from '@local-tools/self-plan-parse.js';

export interface TaskDefinition {
  title: string;
  estimate?: string;
  dependencies?: string[];
  files?: string[];
  description: string;
}

export interface PlanDefinition {
  title: string;
  goal: string;
  context: string;
  tasks: TaskDefinition[];
  verification?: string[];
}

export interface CreatePlanParams {
  owner: string;
  repo: string;
  plan: PlanDefinition;
}

export interface CreatePlanResult {
  success: boolean;
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}

//NOTE(self): Generate markdown body for a plan issue
export function generatePlanMarkdown(plan: PlanDefinition): string {
  const lines: string[] = [];

  //NOTE(self): Header with plan marker
  lines.push(`# [PLAN] ${plan.title}`);
  lines.push('');

  //NOTE(self): Goal section
  lines.push('## Goal');
  lines.push(plan.goal);
  lines.push('');

  //NOTE(self): Context section
  lines.push('## Context');
  lines.push(plan.context);
  lines.push('');

  //NOTE(self): Tasks section
  lines.push('## Tasks');
  lines.push('');

  for (let i = 0; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];
    const taskNum = i + 1;

    lines.push(`### Task ${taskNum}: ${task.title}`);
    lines.push('**Status:** pending');
    lines.push('**Assignee:** (empty if unclaimed)');
    if (task.estimate) {
      lines.push(`**Estimate:** ${task.estimate}`);
    }
    lines.push(`**Dependencies:** ${task.dependencies?.length ? task.dependencies.join(', ') : 'none'}`);

    if (task.files && task.files.length > 0) {
      lines.push('**Files:**');
      for (const file of task.files) {
        lines.push(`- \`${file}\``);
      }
    }

    lines.push('');
    lines.push('**Description:**');
    lines.push(task.description);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  //NOTE(self): Verification section
  lines.push('## Verification');
  const verificationItems = plan.verification || [
    'All tasks completed',
    'Tests pass',
    'Integration works',
  ];
  for (const item of verificationItems) {
    lines.push(`- [ ] ${item}`);
  }

  return lines.join('\n');
}

//NOTE(self): Check if docs tasks (LIL-INTDEV-AGENTS.md, SCENARIOS.md) are present in plan tasks
//NOTE(self): For workspace repos, these are required as early tasks (Scenario 10 quality loop)
function hasDocsTasks(tasks: TaskDefinition[]): { hasAgentsMd: boolean; hasScenariosMd: boolean } {
  const hasAgentsMd = tasks.some(t =>
    t.title.toLowerCase().includes('lil-intdev-agents') ||
    t.description.toLowerCase().includes('lil-intdev-agents.md')
  );
  const hasScenariosMd = tasks.some(t =>
    t.title.toLowerCase().includes('scenarios') ||
    t.description.toLowerCase().includes('scenarios.md')
  );
  return { hasAgentsMd, hasScenariosMd };
}

//NOTE(self): Auto-inject documentation tasks for workspace repos if missing (Scenario 10)
//NOTE(self): The workspace-decision skill instructs the LLM to include these, but this is a safety net
function ensureDocsTasks(plan: PlanDefinition, repo: string): PlanDefinition {
  if (!repo.startsWith('www-lil-intdev-')) return plan;

  const { hasAgentsMd, hasScenariosMd } = hasDocsTasks(plan.tasks);
  const docsToInject: TaskDefinition[] = [];

  if (!hasAgentsMd) {
    docsToInject.push({
      title: 'Create LIL-INTDEV-AGENTS.md',
      estimate: '5-10 min',
      dependencies: [],
      files: ['LIL-INTDEV-AGENTS.md'],
      description: 'Create the workspace documentation file. Model after AGENTS.md in the main repo but scoped to this project. Document architecture, roles, file structure, and constraints. This is written by the SOULs FOR the SOULs.',
    });
    logger.warn('Auto-injected LIL-INTDEV-AGENTS.md task into workspace plan (Scenario 10 enforcement)', { repo });
  }

  if (!hasScenariosMd) {
    docsToInject.push({
      title: 'Create SCENARIOS.md',
      estimate: '5-10 min',
      dependencies: [],
      files: ['SCENARIOS.md'],
      description: 'Define acceptance criteria as concrete scenarios. Each scenario follows the pattern "A human could do X and see Y." These are used to verify the project actually works and drive the iterative quality loop.',
    });
    logger.warn('Auto-injected SCENARIOS.md task into workspace plan (Scenario 10 enforcement)', { repo });
  }

  if (docsToInject.length > 0) {
    //NOTE(self): Prepend docs tasks so they're Task 1 and Task 2
    return { ...plan, tasks: [...docsToInject, ...plan.tasks] };
  }

  return plan;
}

//NOTE(self): Create a new plan issue
export async function createPlan(params: CreatePlanParams): Promise<CreatePlanResult> {
  const { owner, repo } = params;
  //NOTE(self): Auto-inject docs tasks for workspace repos (Scenario 10)
  const plan = ensureDocsTasks(params.plan, repo);

  const body = generatePlanMarkdown(plan);
  const title = `[PLAN] ${plan.title}`;

  logger.info('Creating plan issue', { owner, repo, title, taskCount: plan.tasks.length });

  const result = await createIssue({
    owner,
    repo,
    title,
    body,
    labels: ['plan', 'plan:active'],
  });

  if (!result.success) {
    logger.error('Failed to create plan issue', { error: result.error });
    return { success: false, error: result.error };
  }

  logger.info('Plan issue created', {
    number: result.data.number,
    url: result.data.html_url,
  });

  return {
    success: true,
    issueNumber: result.data.number,
    issueUrl: result.data.html_url,
  };
}

//NOTE(self): Update plan issue body with new content
export async function updatePlanBody(
  owner: string,
  repo: string,
  issueNumber: number,
  newBody: string
): Promise<{ success: boolean; error?: string }> {
  const result = await updateIssue({
    owner,
    repo,
    issue_number: issueNumber,
    body: newBody,
  });

  if (!result.success) {
    logger.error('Failed to update plan body', { error: result.error });
    return { success: false, error: result.error };
  }

  return { success: true };
}

//NOTE(self): Update plan labels to reflect status
export async function updatePlanStatus(
  owner: string,
  repo: string,
  issueNumber: number,
  status: 'active' | 'complete' | 'blocked'
): Promise<{ success: boolean; error?: string }> {
  //NOTE(self): Map status to labels
  const labelMap: Record<string, string> = {
    'active': 'plan:active',
    'complete': 'plan:complete',
    'blocked': 'plan:blocked',
  };

  const result = await updateIssue({
    owner,
    repo,
    issue_number: issueNumber,
    labels: ['plan', labelMap[status]],
  });

  if (!result.success) {
    logger.error('Failed to update plan status', { error: result.error });
    return { success: false, error: result.error };
  }

  return { success: true };
}

//NOTE(self): Close a completed plan
export async function closePlan(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{ success: boolean; error?: string }> {
  const result = await updateIssue({
    owner,
    repo,
    issue_number: issueNumber,
    state: 'closed',
    labels: ['plan', 'plan:complete'],
  });

  if (!result.success) {
    logger.error('Failed to close plan', { error: result.error });
    return { success: false, error: result.error };
  }

  logger.info('Plan closed', { owner, repo, issueNumber });
  return { success: true };
}
