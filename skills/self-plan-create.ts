//NOTE(self): Create structured plan issues from a plan definition
//NOTE(self): Plans are GitHub issues with specific markdown format

import { createIssue } from '@adapters/github/create-issue.js';
import { updateIssue } from '@adapters/github/update-issue.js';
import { logger } from '@modules/logger.js';
import type { TaskStatus, ParsedTask } from '@skills/self-plan-parse.js';

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

//NOTE(self): Create a new plan issue
export async function createPlan(params: CreatePlanParams): Promise<CreatePlanResult> {
  const { owner, repo, plan } = params;

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
