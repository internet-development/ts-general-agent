//NOTE(self): Commitment Fulfillment Module
//NOTE(self): Dispatches by commitment type to actually do the work I promised.
//NOTE(self): create_issue → createMemo(), create_plan → createPlan(), comment_issue → commentOnIssue()

import { logger } from '@modules/logger.js';
import type { Commitment } from '@modules/commitment-queue.js';
import { isRepoCooledDown } from '@modules/commitment-queue.js';
import { createMemo } from '@local-tools/self-github-create-issue.js';
import { createPlan, type PlanDefinition } from '@local-tools/self-plan-create.js';
import { commentOnIssue } from '@local-tools/self-github-comment-issue.js';
import { findExistingWorkspace } from '@local-tools/self-github-create-workspace.js';
import { listIssues } from '@adapters/github/list-issues.js';
import * as atproto from '@adapters/atproto/index.js';
import { outboundQueue } from '@modules/outbound-queue.js';

export interface FulfillmentResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

//NOTE(self): Resolve owner/repo from commitment params or fall back to existing workspace
//NOTE(self): Defense-in-depth — handles "owner/repo" format in params.repo, prefers params.repoName
async function resolveRepo(params: Record<string, unknown>): Promise<{ owner: string; repo: string } | null> {
  let owner = params.owner as string | undefined;
  let repo = (params.repoName as string | undefined) || (params.repo as string | undefined);

  //NOTE(self): If repo contains a slash, it's "owner/repo" format — split it
  if (repo && repo.includes('/')) {
    const parts = repo.split('/');
    owner = owner || parts[0];
    repo = parts[1];
  }

  if (owner && repo) {
    return { owner, repo };
  }

  //NOTE(self): Fall back to the existing workspace in the org
  //NOTE(self): Use the provided owner if available, otherwise fall back to the default org
  const searchOrg = owner || 'internet-development';
  const existingWorkspace = await findExistingWorkspace(searchOrg);
  if (existingWorkspace) {
    return { owner: searchOrg, repo: existingWorkspace };
  }

  return null;
}

//NOTE(self): Fulfill a create_issue commitment
//NOTE(self): For multi-issue commitments (count > 1), tracks which sub-items succeeded
//NOTE(self): so that on retry, already-created issues are skipped (prevents duplicates)
async function fulfillCreateIssue(commitment: Commitment): Promise<FulfillmentResult> {
  const resolved = await resolveRepo(commitment.params);
  if (!resolved) {
    return { success: false, error: 'no_workspace_context' };
  }

  const count = Math.min(Number(commitment.params.count) || 1, 5);
  const results: Record<string, unknown>[] = [];
  //NOTE(self): Track which sub-items completed in previous attempts (stored in commitment.result)
  const previouslyCreated = new Set<number>();
  if (commitment.result && Array.isArray((commitment.result as any).issues)) {
    for (let i = 0; i < (commitment.result as any).issues.length; i++) {
      previouslyCreated.add(i);
    }
  }

  for (let i = 0; i < count; i++) {
    //NOTE(self): Skip sub-items that already succeeded in a previous attempt
    if (previouslyCreated.has(i)) {
      results.push((commitment.result as any).issues[i] || {});
      continue;
    }

    const title = count > 1
      ? `${commitment.params.title || commitment.description} (${i + 1}/${count})`
      : (commitment.params.title as string) || commitment.description;

    //NOTE(self): Build a meaningful issue body from the commitment context
    //NOTE(self): params.description contains the RICH issue body content written by the agent
    //NOTE(self): commitment.description may just be the title if c.title was set during enqueue
    //NOTE(self): Always prefer params.description (full content) over commitment.description (may be title-only)
    const richDescription = commitment.params.description as string | undefined;
    const richContent = commitment.params.content as string | undefined;
    const issueBody = richDescription || richContent || commitment.description;

    const sourceLabel = commitment.source === 'space'
      ? '*Created from agent space conversation.*'
      : '*Created from Bluesky thread commitment.*';
    const body = [
      issueBody,
      '',
      '---',
      '',
      `> ${commitment.sourceReplyText}`,
      '',
      sourceLabel,
    ].join('\n');

    const result = await createMemo({
      owner: resolved.owner,
      repo: resolved.repo,
      title,
      body,
    });

    if (!result.success) {
      //NOTE(self): Partial success — save what we created so far in the result
      //NOTE(self): On retry, previously created sub-items will be skipped
      return { success: false, error: result.error || 'createMemo failed', result: { issues: results, count } };
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

  //NOTE(self): Dedup guard — check if a plan issue already exists in the repo (open OR recently closed)
  //NOTE(self): Multiple SOULs can extract "create plan" from the same thread; only one should create it
  //NOTE(self): Checking 'all' states with recency filter prevents re-creating completed plans
  const existingPlans = await listIssues({
    owner: resolved.owner,
    repo: resolved.repo,
    state: 'all',
    labels: ['plan'],
    per_page: 5,
  });

  if (existingPlans.success && existingPlans.data.length > 0) {
    //NOTE(self): Accept any open plan, or any closed plan from the last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const existing = existingPlans.data.find(
      (issue) => issue.state === 'open' || (issue.closed_at && new Date(issue.closed_at).getTime() > sevenDaysAgo)
    );
    if (existing) {
      logger.info('Plan already exists, skipping duplicate creation', {
        owner: resolved.owner,
        repo: resolved.repo,
        existingIssue: existing.number,
        state: existing.state,
      });
      return {
        success: true,
        result: { issueNumber: existing.number, issueUrl: existing.html_url, deduplicated: true },
      };
    }
  }

  const plan: PlanDefinition = {
    title: (commitment.params.title as string) || commitment.description,
    goal: commitment.description,
    context: commitment.source === 'space'
      ? `Plan created from agent space conversation.\n\nOriginal message: "${commitment.sourceReplyText}"`
      : `Plan created from Bluesky commitment.\n\nOriginal reply: "${commitment.sourceReplyText}"`,
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
  //NOTE(self): Issue number from params (set at enqueue), or fall back to parsing from description
  let issueNumber = commitment.params.issueNumber as number | undefined;
  if (!issueNumber) {
    const issueNumMatch = (commitment.description || '').match(/#(\d+)/);
    if (issueNumMatch) issueNumber = parseInt(issueNumMatch[1], 10);
  }
  const body = (commitment.params.body as string) || (commitment.params.description as string) || commitment.description;

  if (!owner || !repo || !issueNumber) {
    return { success: false, error: `Missing owner (${owner}), repo (${repo}), or issueNumber (${issueNumber}) in params` };
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

//NOTE(self): Fulfill a post_bluesky commitment — create a Bluesky post via outbound queue
async function fulfillPostBluesky(commitment: Commitment): Promise<FulfillmentResult> {
  const text = (commitment.params.text as string) || commitment.description;

  //NOTE(self): Route through outbound queue for dedup
  const queueCheck = await outboundQueue.enqueue('post', text);
  if (!queueCheck.allowed) {
    return { success: false, error: `Outbound queue blocked: ${queueCheck.reason}` };
  }

  const result = await atproto.createPost({ text });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    result: { uri: result.data.uri, cid: result.data.cid },
  };
}

//NOTE(self): Main dispatch — routes to the right fulfillment strategy
export async function fulfillCommitment(commitment: Commitment): Promise<FulfillmentResult> {
  logger.info('Fulfilling commitment', { id: commitment.id, type: commitment.type });

  try {
    //NOTE(self): Check repo cooldown before dispatching — skip if repo has too many recent failures
    if (commitment.type === 'create_issue' || commitment.type === 'create_plan' || commitment.type === 'comment_issue') {
      const owner = commitment.params?.owner as string | undefined;
      const repo = (commitment.params?.repoName as string | undefined) || (commitment.params?.repo as string | undefined);
      if (owner && repo) {
        const repoName = repo.includes('/') ? repo.split('/')[1] : repo;
        if (isRepoCooledDown(owner, repoName)) {
          logger.warn('Commitment skipped — repo is cooled down', { owner, repo: repoName, type: commitment.type });
          return { success: false, error: `Repo ${owner}/${repoName} is cooled down due to repeated failures` };
        }
      }
    }

    switch (commitment.type) {
      case 'create_issue':
        return await fulfillCreateIssue(commitment);
      case 'create_plan':
        return await fulfillCreatePlan(commitment);
      case 'comment_issue':
        return await fulfillCommentIssue(commitment);
      case 'post_bluesky':
        return await fulfillPostBluesky(commitment);
      default:
        return { success: false, error: `Unknown commitment type: ${commitment.type}` };
    }
  } catch (error) {
    logger.error('Commitment fulfillment error', { id: commitment.id, error: String(error) });
    return { success: false, error: String(error) };
  }
}
