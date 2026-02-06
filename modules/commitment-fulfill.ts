//NOTE(self): Commitment Fulfillment Module
//NOTE(self): Dispatches by commitment type to actually do the work I promised.
//NOTE(self): create_issue → createMemo(), create_plan → createPlan(), comment_issue → commentOnIssue()

import { logger } from '@modules/logger.js';
import type { Commitment } from '@modules/commitment-queue.js';
import { createMemo } from '@local-tools/self-github-create-issue.js';
import { createPlan, type PlanDefinition } from '@local-tools/self-plan-create.js';
import { commentOnIssue } from '@local-tools/self-github-comment-issue.js';
import { findExistingWorkspace } from '@local-tools/self-github-create-workspace.js';

export interface FulfillmentResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

//NOTE(self): Resolve owner/repo from commitment params or fall back to existing workspace
async function resolveRepo(params: Record<string, unknown>): Promise<{ owner: string; repo: string } | null> {
  const owner = params.owner as string | undefined;
  const repo = params.repo as string | undefined;

  if (owner && repo) {
    return { owner, repo };
  }

  //NOTE(self): Fall back to the existing workspace in the org
  const existingWorkspace = await findExistingWorkspace();
  if (existingWorkspace) {
    return { owner: 'internet-development', repo: existingWorkspace };
  }

  return null;
}

//NOTE(self): Fulfill a create_issue commitment
async function fulfillCreateIssue(commitment: Commitment): Promise<FulfillmentResult> {
  const resolved = await resolveRepo(commitment.params);
  if (!resolved) {
    return { success: false, error: 'no_workspace_context' };
  }

  const count = Math.min(Number(commitment.params.count) || 1, 5);
  const results: Record<string, unknown>[] = [];

  for (let i = 0; i < count; i++) {
    const title = count > 1
      ? `${commitment.params.title || commitment.description} (${i + 1}/${count})`
      : (commitment.params.title as string) || commitment.description;

    const result = await createMemo({
      owner: resolved.owner,
      repo: resolved.repo,
      title,
      body: `Commitment from Bluesky thread.\n\nOriginal reply: "${commitment.sourceReplyText}"`,
    });

    if (!result.success) {
      return { success: false, error: result.error || 'createMemo failed' };
    }

    results.push(result.memo || {});
  }

  return {
    success: true,
    result: { issues: results, count },
  };
}

//NOTE(self): Fulfill a create_plan commitment
async function fulfillCreatePlan(commitment: Commitment): Promise<FulfillmentResult> {
  const resolved = await resolveRepo(commitment.params);
  if (!resolved) {
    return { success: false, error: 'no_workspace_context' };
  }

  const plan: PlanDefinition = {
    title: (commitment.params.title as string) || commitment.description,
    goal: commitment.description,
    context: `Plan created from Bluesky commitment.\n\nOriginal reply: "${commitment.sourceReplyText}"`,
    tasks: [
      {
        title: 'Define scope and requirements',
        description: 'Based on the commitment made, define what needs to be done.',
      },
    ],
  };

  const result = await createPlan({
    owner: resolved.owner,
    repo: resolved.repo,
    plan,
  });

  if (!result.success) {
    return { success: false, error: result.error || 'createPlan failed' };
  }

  return {
    success: true,
    result: { issueNumber: result.issueNumber, issueUrl: result.issueUrl },
  };
}

//NOTE(self): Fulfill a comment_issue commitment
async function fulfillCommentIssue(commitment: Commitment): Promise<FulfillmentResult> {
  const owner = commitment.params.owner as string | undefined;
  const repo = commitment.params.repo as string | undefined;
  const issueNumber = commitment.params.issueNumber as number | undefined;
  const body = (commitment.params.body as string) || commitment.description;

  if (!owner || !repo || !issueNumber) {
    return { success: false, error: 'Missing owner, repo, or issueNumber in params' };
  }

  const success = await commentOnIssue(owner, repo, issueNumber, body);

  if (!success) {
    return { success: false, error: 'commentOnIssue failed' };
  }

  return {
    success: true,
    result: { owner, repo, issueNumber },
  };
}

//NOTE(self): Main dispatch — routes to the right fulfillment strategy
export async function fulfillCommitment(commitment: Commitment): Promise<FulfillmentResult> {
  logger.info('Fulfilling commitment', { id: commitment.id, type: commitment.type });

  try {
    switch (commitment.type) {
      case 'create_issue':
        return await fulfillCreateIssue(commitment);
      case 'create_plan':
        return await fulfillCreatePlan(commitment);
      case 'comment_issue':
        return await fulfillCommentIssue(commitment);
      default:
        return { success: false, error: `Unknown commitment type: ${commitment.type}` };
    }
  } catch (error) {
    logger.error('Commitment fulfillment error', { id: commitment.id, error: String(error) });
    return { success: false, error: String(error) };
  }
}
