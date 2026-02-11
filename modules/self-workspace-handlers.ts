import * as path from 'path';
import { logger } from '@modules/logger.js';
import { getRepoRoot } from '@modules/sandbox.js';
import type { ToolCall, ToolResult } from '@modules/tools.js';
import * as github from '@adapters/github/index.js';
import { createWorkspace, findExistingWorkspace, getWorkspaceUrl } from '@local-tools/self-github-create-workspace.js';
import { createMemo } from '@local-tools/self-github-create-issue.js';
import { watchWorkspace, getWatchedWorkspaceForRepo, createFinishedSentinel } from '@modules/self-github-workspace-discovery.js';
import { createPlan, type PlanDefinition } from '@local-tools/self-plan-create.js';
import { claimTaskFromPlan, markTaskInProgress } from '@local-tools/self-task-claim.js';
import { executeTask, ensureWorkspace, pushChanges, createBranch, createPullRequest, requestReviewersForPR, getTaskBranchName } from '@local-tools/self-task-execute.js';
import { reportTaskComplete, reportTaskFailed, reportTaskBlocked } from '@local-tools/self-task-report.js';
import { verifyGitChanges, runTestsIfPresent, verifyPushSuccess, verifyBranch } from '@local-tools/self-task-verify.js';
import { parsePlan } from '@local-tools/self-plan-parse.js';
import { listIssues } from '@adapters/github/list-issues.js';
import { announceIfWorthy } from '@modules/self-announcement.js';
import { recordExperience } from '@local-tools/self-capture-experiences.js';

export async function handleWorkspaceCreate(call: ToolCall, responseThreadUri: string | null): Promise<ToolResult> {
  const { name, description, org } = call.input as {
    name: string;
    description?: string;
    org?: string;
  };

  const result = await createWorkspace({ name, description, org });

  if (result.success && result.workspace) {
    const [wsOwner, wsRepo] = result.workspace.fullName.split('/');
    watchWorkspace(wsOwner, wsRepo, result.workspace.url, responseThreadUri || undefined);
    logger.info('Workspace created and auto-watched', { fullName: result.workspace.fullName, url: result.workspace.url, threadUri: responseThreadUri });

    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        workspace: result.workspace,
      }),
    };
  }

  if (!result.success && result.existingWorkspace) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: false,
        existingWorkspace: result.existingWorkspace,
        message: 'A workspace already exists for this org',
      }),
    };
  }

  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleWorkspaceFind(call: ToolCall): Promise<ToolResult> {
  const { org } = call.input as { org?: string };

  const workspaceName = await findExistingWorkspace(org);

  if (workspaceName) {
    const workspaceUrl = await getWorkspaceUrl(org);
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        found: true,
        name: workspaceName,
        url: workspaceUrl,
      }),
    };
  }

  return {
    tool_use_id: call.id,
    content: JSON.stringify({ found: false }),
  };
}

export async function handleCreateMemo(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, title, body, labels } = call.input as {
    owner: string;
    repo: string;
    title: string;
    body?: string;
    labels?: string[];
  };

  const result = await createMemo({ owner, repo, title, body, labels });

  if (result.success && result.memo) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        memo: result.memo,
      }),
    };
  }

  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handlePlanCreate(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, title, goal, context, tasks, verification } = call.input as {
    owner: string;
    repo: string;
    title: string;
    goal: string;
    context: string;
    tasks: Array<{
      title: string;
      estimate?: string;
      dependencies?: string[];
      files?: string[];
      description: string;
    }>;
    verification?: string[];
  };

  const existingPlanCheck = await listIssues({
    owner,
    repo,
    state: 'open',
    labels: ['plan'],
    per_page: 1,
  });
  if (existingPlanCheck.success && existingPlanCheck.data.length > 0) {
    const existing = existingPlanCheck.data[0];
    logger.info('Plan already exists, returning existing instead of creating duplicate', {
      owner, repo, existingIssue: existing.number,
    });
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        issueNumber: existing.number,
        issueUrl: existing.html_url,
        deduplicated: true,
      }),
    };
  }

  const planDefinition: PlanDefinition = {
    title,
    goal,
    context,
    tasks,
    verification,
  };

  const result = await createPlan({ owner, repo, plan: planDefinition });

  if (result.success) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        issueNumber: result.issueNumber,
        issueUrl: result.issueUrl,
      }),
    };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handlePlanClaimTask(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, issue_number, task_number } = call.input as {
    owner: string;
    repo: string;
    issue_number: number;
    task_number: number;
  };

  const issuesResult = await listIssues({ owner, repo, state: 'all' });
  if (!issuesResult.success) {
    return { tool_use_id: call.id, content: `Error fetching issue: ${issuesResult.error}`, is_error: true };
  }

  const issue = issuesResult.data.find(i => i.number === issue_number);
  if (!issue) {
    return { tool_use_id: call.id, content: `Error: Issue #${issue_number} not found`, is_error: true };
  }

  const plan = parsePlan(issue.body || '', issue.title);
  if (!plan) {
    return { tool_use_id: call.id, content: 'Error: Issue is not a valid plan', is_error: true };
  }

  const claimResult = await claimTaskFromPlan({
    owner,
    repo,
    issueNumber: issue_number,
    taskNumber: task_number,
    plan,
  });

  if (!claimResult.success) {
    return { tool_use_id: call.id, content: `Error: ${claimResult.error}`, is_error: true };
  }

  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      success: true,
      claimed: claimResult.claimed,
      claimedBy: claimResult.claimedBy,
    }),
  };
}

export async function handlePlanExecuteTask(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, issue_number, task_number } = call.input as {
    owner: string;
    repo: string;
    issue_number: number;
    task_number: number;
  };

  const issuesResult = await listIssues({ owner, repo, state: 'all' });
  if (!issuesResult.success) {
    return { tool_use_id: call.id, content: `Error fetching issue: ${issuesResult.error}`, is_error: true };
  }

  const issue = issuesResult.data.find(i => i.number === issue_number);
  if (!issue) {
    return { tool_use_id: call.id, content: `Error: Issue #${issue_number} not found`, is_error: true };
  }

  const plan = parsePlan(issue.body || '', issue.title);
  if (!plan) {
    return { tool_use_id: call.id, content: 'Error: Issue is not a valid plan', is_error: true };
  }

  const task = plan.tasks.find(t => t.number === task_number);
  if (!task) {
    return { tool_use_id: call.id, content: `Error: Task ${task_number} not found in plan`, is_error: true };
  }

  const repoRoot = getRepoRoot();
  const workreposDir = path.join(repoRoot, '.workrepos');
  const workspaceResult = await ensureWorkspace(owner, repo, workreposDir);

  if (!workspaceResult.success) {
    return { tool_use_id: call.id, content: `Error setting up workspace: ${workspaceResult.error}`, is_error: true };
  }

  const taskBranchName = getTaskBranchName(task_number, task.title);
  const branchResult = await createBranch(workspaceResult.path, taskBranchName);

  if (!branchResult.success) {
    return { tool_use_id: call.id, content: `Error creating branch: ${branchResult.error}`, is_error: true };
  }

  await markTaskInProgress(owner, repo, issue_number, task_number, plan.rawBody);

  const memoryPath = path.join(repoRoot, '.memory');
  const executionResult = await executeTask({
    owner,
    repo,
    task,
    plan,
    workspacePath: workspaceResult.path,
    memoryPath,
  });

  if (!executionResult.success) {
    if (executionResult.blocked) {
      await reportTaskBlocked(
        { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
        executionResult.blockReason || executionResult.error || 'Unknown'
      );
    } else {
      await reportTaskFailed(
        { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
        executionResult.error || 'Unknown error'
      );
    }
    return { tool_use_id: call.id, content: `Error: ${executionResult.error}`, is_error: true };
  }

  //NOTE(self): PRE-GATE — Verify Claude Code didn't switch branches or merge other branches
  const branchCheck = await verifyBranch(workspaceResult.path, taskBranchName);
  if (!branchCheck.success) {
    await reportTaskFailed(
      { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
      `Branch hygiene failure: ${branchCheck.error}`
    );
    return { tool_use_id: call.id, content: `Error: Branch hygiene failure: ${branchCheck.error}`, is_error: true };
  }

  //NOTE(self): GATE 1 — Verify Claude Code actually produced git changes
  const verification = await verifyGitChanges(workspaceResult.path);
  if (!verification.hasCommits || !verification.hasChanges) {
    await reportTaskFailed(
      { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
      `Claude Code exited successfully but no git changes were produced. Commits: ${verification.commitCount}, Files changed: ${verification.filesChanged.length}`
    );
    return { tool_use_id: call.id, content: 'Error: Task execution produced no git changes', is_error: true };
  }

  //NOTE(self): GATE 2 — Run tests if they exist
  const testResult = await runTestsIfPresent(workspaceResult.path);
  if (testResult.testsExist && testResult.testsRun && !testResult.testsPassed) {
    await reportTaskFailed(
      { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
      `Tests failed after task execution.\n\n${testResult.output}`
    );
    return { tool_use_id: call.id, content: `Error: Tests failed after task execution. ${testResult.output}`, is_error: true };
  }

  //NOTE(self): GATE 3 — Push feature branch (must succeed)
  const taskPushResult = await pushChanges(workspaceResult.path, taskBranchName);
  if (!taskPushResult.success) {
    await reportTaskFailed(
      { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
      `Failed to push branch '${taskBranchName}': ${taskPushResult.error}`
    );
    return { tool_use_id: call.id, content: `Error: Push failed: ${taskPushResult.error}`, is_error: true };
  }

  //NOTE(self): GATE 4 — Verify branch exists on remote
  const pushVerification = await verifyPushSuccess(workspaceResult.path, taskBranchName);
  if (!pushVerification.success) {
    await reportTaskFailed(
      { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
      `Push appeared to succeed but branch not found on remote: ${pushVerification.error}`
    );
    return { tool_use_id: call.id, content: `Error: Push verification failed: ${pushVerification.error}`, is_error: true };
  }

  //NOTE(self): Create pull request (must succeed — no silent failures)
  const prTitle = `task(${task_number}): ${task.title}`;
  const prBody = [
    `## Task ${task_number} from plan #${issue_number}`,
    '',
    `**Plan:** ${plan.title}`,
    `**Goal:** ${plan.goal}`,
    '',
    '### Changes',
    `${verification.diffStat}`,
    '',
    `**Files changed (${verification.filesChanged.length}):**`,
    ...verification.filesChanged.map(f => `- \`${f}\``),
    '',
    `**Tests:** ${testResult.testsExist ? (testResult.testsPassed ? 'Passed' : 'No tests ran') : 'None found'}`,
    '',
    '---',
    `Part of #${issue_number}`,
  ].join('\n');
  const prResult = await createPullRequest(
    owner, repo, taskBranchName, prTitle, prBody, workspaceResult.path
  );

  if (!prResult.success) {
    await reportTaskFailed(
      { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
      `Branch pushed but PR creation failed: ${prResult.error}`
    );
    return { tool_use_id: call.id, content: `Error: PR creation failed: ${prResult.error}`, is_error: true };
  }

  const taskPrUrl = prResult.prUrl;

  if (prResult.prNumber) {
    await requestReviewersForPR(owner, repo, prResult.prNumber);
  }

  const taskSummary = `Task completed. PR: ${taskPrUrl}\n\n${verification.diffStat}\nFiles: ${verification.filesChanged.join(', ')}`;

  const completionReport = await reportTaskComplete(
    { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
    {
      success: true,
      summary: taskSummary,
      filesChanged: verification.filesChanged,
      testsRun: testResult.testsRun,
      testsPassed: testResult.testsPassed,
    }
  );

  recordExperience(
    'helped_someone',
    `Completed task "${task.title}" in collaborative plan "${plan.title}" — PR: ${taskPrUrl}`,
    { source: 'github', url: `https://github.com/${owner}/${repo}/issues/${issue_number}` }
  );

  const workspace = getWatchedWorkspaceForRepo(owner, repo);
  await announceIfWorthy(
    { url: taskPrUrl!, title: `task(${task_number}): ${task.title}`, repo: `${owner}/${repo}` },
    'pr',
    workspace?.discoveredInThread
  );

  if (completionReport.planComplete) {
    logger.info('Plan complete via LLM tool path', { owner, repo, issueNumber: issue_number });
    try {
      await github.createIssueComment({
        owner,
        repo,
        issue_number,
        body: `## Quality Loop — Iteration Complete\n\nAll tasks in this plan are now complete. Before closing, the quality loop requires:\n\n- [ ] Re-read \`LIL-INTDEV-AGENTS.md\` and ensure it reflects the current architecture\n- [ ] Re-read \`SCENARIOS.md\` and simulate each scenario against the codebase\n- [ ] Fix any gaps found during simulation\n- [ ] Update both docs to reflect the current state\n\nIf everything checks out, this iteration is done. If gaps are found, file new issues to address them.`,
      });
      logger.info('Posted quality loop review comment on completed plan (executor path)', { issue_number });
    } catch (docReviewError) {
      logger.warn('Failed to post quality loop comment (non-fatal)', { error: String(docReviewError) });
    }

    const planUrl = `https://github.com/${owner}/${repo}/issues/${issue_number}`;
    await announceIfWorthy(
      { url: planUrl, title: `Plan complete: ${plan.title}`, repo: `${owner}/${repo}` },
      'issue',
      workspace?.discoveredInThread
    );
    recordExperience(
      'helped_someone',
      `All tasks complete in plan "${plan.title}" — project delivered!`,
      { source: 'github', url: planUrl }
    );
  }

  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      success: true,
      output: executionResult.output?.slice(0, 1000),
      prUrl: taskPrUrl,
      filesChanged: verification.filesChanged,
      testsRun: testResult.testsRun,
      testsPassed: testResult.testsPassed,
      planComplete: completionReport.planComplete || false,
    }),
  };
}

export async function handleWorkspaceFinish(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, summary } = call.input as { owner: string; repo: string; summary: string };
  const sentinelNumber = await createFinishedSentinel(owner, repo, summary);
  if (sentinelNumber) {
    return { tool_use_id: call.id, content: JSON.stringify({ success: true, issueNumber: sentinelNumber }) };
  }
  return { tool_use_id: call.id, content: JSON.stringify({ success: false, error: 'Failed to create sentinel' }), is_error: true };
}
