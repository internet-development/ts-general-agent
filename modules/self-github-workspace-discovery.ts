//NOTE(self): Workspace Discovery Module
//NOTE(self): Poll watched workspaces for plan issues, claimable tasks, and reviewable PRs
//NOTE(self): Workspaces are discovered via Bluesky threads (not hardcoded)

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';
import { listIssues } from '@adapters/github/list-issues.js';
import { getRepository } from '@adapters/github/get-repository.js';
import { listPullRequests } from '@adapters/github/list-pull-requests.js';
import { listPullRequestReviews } from '@adapters/github/list-pull-request-reviews.js';
import { updateIssue } from '@adapters/github/update-issue.js';
import { mergePullRequest } from '@adapters/github/merge-pull-request.js';
import { deleteBranch } from '@adapters/github/delete-branch.js';
import type { GitHubPullRequest } from '@adapters/github/types.js';
import { parsePlan, getClaimableTasks, freshUpdateTaskInPlan, fetchFreshPlan, type ParsedPlan, type ParsedTask } from '@local-tools/self-plan-parse.js';
import { handlePlanComplete } from '@local-tools/self-task-report.js';
import { removeIssueAssignee } from '@adapters/github/remove-issue-assignee.js';
import { registerPeer, isPeerByBlueskyHandle, isPeer } from '@modules/self-peer-awareness.js';
import { createIssueComment } from '@adapters/github/create-comment-issue.js';
import { createIssue } from '@adapters/github/create-issue.js';
import { getIssueThread } from '@adapters/github/get-issue-thread.js';
import { getConfig } from '@modules/config.js';
import { getConversation } from '@modules/self-github-engagement.js';

//NOTE(self): Path to watched workspaces state
const WATCHED_WORKSPACES_PATH = '.memory/watched_workspaces.json';

//NOTE(self): A workspace we're watching for plans
export interface WatchedWorkspace {
  owner: string;
  repo: string;
  url: string;
  //NOTE(self): When we first saw this workspace (via Bluesky thread)
  discoveredAt: string;
  //NOTE(self): Bluesky thread where we discovered it
  discoveredInThread?: string;
  //NOTE(self): When we last polled for plans
  lastPolled: string | null;
  //NOTE(self): Active plan issue numbers
  activePlanIssues: number[];
  //NOTE(self): When we last attempted to synthesize a plan from open issues
  lastPlanSynthesisAttempt?: string;
  //NOTE(self): When we last ran a workspace health check (completion assessment)
  lastHealthCheckAttempt?: string;
  //NOTE(self): If set, workspace has a "LIL INTDEV FINISHED" sentinel issue — no new work until closed
  finishedIssueNumber?: number;
}

//NOTE(self): A discovered plan with claimable tasks
export interface DiscoveredPlan {
  workspace: WatchedWorkspace;
  issueNumber: number;
  issueUrl: string;
  plan: ParsedPlan;
  claimableTasks: ParsedTask[];
}

//NOTE(self): Summary stats from plan polling — used for terminal display
export interface PlanPollResult {
  claimablePlans: DiscoveredPlan[];
  //NOTE(self): All plan issue numbers grouped by workspace key (owner/repo) — used for duplicate plan consolidation
  allPlansByWorkspace: Record<string, { owner: string; repo: string; issueNumbers: number[] }>;
  summary: {
    plansFound: number;
    totalTasks: number;
    completed: number;
    inProgress: number;
    claimed: number;
    blocked: number;
    pending: number;
    claimable: number;
    //NOTE(self): Why pending tasks aren't claimable (for diagnostics)
    pendingBlockedByDeps: number;
    pendingHasAssignee: number;
  };
}

interface WorkspaceDiscoveryState {
  //NOTE(self): Workspaces we're watching (discovered via Bluesky)
  workspaces: Record<string, WatchedWorkspace>;
  //NOTE(self): Last time we ran a full poll cycle
  lastFullPoll: string | null;
}

let discoveryState: WorkspaceDiscoveryState | null = null;

function getDefaultState(): WorkspaceDiscoveryState {
  return {
    workspaces: {},
    lastFullPoll: null,
  };
}

function loadState(): WorkspaceDiscoveryState {
  if (discoveryState !== null) return discoveryState;

  try {
    if (existsSync(WATCHED_WORKSPACES_PATH)) {
      const data = JSON.parse(readFileSync(WATCHED_WORKSPACES_PATH, 'utf-8'));
      discoveryState = {
        workspaces: data.workspaces || {},
        lastFullPoll: data.lastFullPoll || null,
      };
      logger.debug('Loaded workspace discovery state', {
        workspaceCount: Object.keys(discoveryState.workspaces).length,
      });
    } else {
      discoveryState = getDefaultState();
    }
  } catch (err) {
    logger.error('Failed to load workspace discovery state', { error: String(err) });
    discoveryState = getDefaultState();
  }
  return discoveryState;
}

function saveState(): void {
  if (!discoveryState) return;

  try {
    const dir = dirname(WATCHED_WORKSPACES_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = WATCHED_WORKSPACES_PATH + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(discoveryState, null, 2));
    renameSync(tmpPath, WATCHED_WORKSPACES_PATH);
  } catch (err) {
    logger.error('Failed to save workspace discovery state', { error: String(err) });
  }
}

//NOTE(self): Generate unique key for a workspace
function getWorkspaceKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

//NOTE(self): Add a workspace to watch list (called when URL seen in Bluesky thread)
export function watchWorkspace(
  owner: string,
  repo: string,
  url: string,
  threadUri?: string
): void {
  const state = loadState();
  const key = getWorkspaceKey(owner, repo);

  if (state.workspaces[key]) {
    //NOTE(self): If threadUri provided and workspace is missing it, update it
    //NOTE(self): This happens when workspace_create is called from a thread context
    //NOTE(self): but the workspace was previously watched without thread info
    if (threadUri && !state.workspaces[key].discoveredInThread) {
      state.workspaces[key].discoveredInThread = threadUri;
      saveState();
      logger.info('Updated workspace with thread URI', { key, threadUri });
    } else {
      logger.debug('Workspace already being watched', { key });
    }
    return;
  }

  state.workspaces[key] = {
    owner,
    repo,
    url,
    discoveredAt: new Date().toISOString(),
    discoveredInThread: threadUri,
    lastPolled: null,
    activePlanIssues: [],
  };

  saveState();
  logger.info('Added workspace to watch list', { owner, repo, url, threadUri });
}

//NOTE(self): Remove a workspace from watch list
export function unwatchWorkspace(owner: string, repo: string): void {
  const state = loadState();
  const key = getWorkspaceKey(owner, repo);

  if (!state.workspaces[key]) {
    return;
  }

  delete state.workspaces[key];
  saveState();
  logger.info('Removed workspace from watch list', { owner, repo });
}

//NOTE(self): Get all watched workspaces
export function getWatchedWorkspaces(): WatchedWorkspace[] {
  const state = loadState();
  return Object.values(state.workspaces);
}

//NOTE(self): Look up a watched workspace by owner/repo
//NOTE(self): Used by executor.ts to get discoveredInThread for announcements
export function getWatchedWorkspaceForRepo(owner: string, repo: string): WatchedWorkspace | null {
  const state = loadState();
  return state.workspaces[getWorkspaceKey(owner, repo)] || null;
}

//NOTE(self): Check if a workspace is being watched
export function isWatchingWorkspace(owner: string, repo: string): boolean {
  const state = loadState();
  return !!state.workspaces[getWorkspaceKey(owner, repo)];
}

//NOTE(self): Check if a Bluesky thread has workspace context
//NOTE(self): True if: (a) this thread directly discovered a workspace, OR
//NOTE(self): (b) the poster is the owner and any workspace exists, OR
//NOTE(self): (c) the poster is a known peer SOUL and workspaces exist
//NOTE(self): Rationale: if the owner or a peer is talking to SOULs and a project exists,
//NOTE(self): the conversation is about the project — don't apply casual exit pressure
export function threadHasWorkspaceContext(
  threadRootUri: string,
  posterDid?: string,
  posterBlueskyHandle?: string
): boolean {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);

  if (workspaces.length === 0) return false;

  //NOTE(self): Direct match — this thread discovered a workspace
  if (workspaces.some(ws => ws.discoveredInThread === threadRootUri)) {
    return true;
  }

  //NOTE(self): Owner heuristic — if the owner is posting and workspaces exist,
  //NOTE(self): treat it as a project thread (owner doesn't casually chat with SOULs)
  if (posterDid) {
    const config = getConfig();
    if (posterDid === config.owner.blueskyDid) {
      return true;
    }
  }

  //NOTE(self): Peer heuristic — if a known peer SOUL is posting and workspaces exist,
  //NOTE(self): they're likely coordinating on the project
  if (posterBlueskyHandle && isPeerByBlueskyHandle(posterBlueskyHandle)) {
    return true;
  }

  return false;
}

//NOTE(self): Parse a GitHub URL to extract owner/repo
export function parseGitHubWorkspaceUrl(url: string): { owner: string; repo: string } | null {
  //NOTE(self): Match patterns like:
  //NOTE(self): https://github.com/owner/repo
  //NOTE(self): https://github.com/owner/repo/...
  const match = url.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2],
  };
}

//NOTE(self): Poll all watched workspaces for plan issues
export async function pollWorkspacesForPlans(): Promise<PlanPollResult> {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  const claimablePlans: DiscoveredPlan[] = [];
  const allPlansByWorkspace: Record<string, { owner: string; repo: string; issueNumbers: number[] }> = {};
  const summary = { plansFound: 0, totalTasks: 0, completed: 0, inProgress: 0, claimed: 0, blocked: 0, pending: 0, claimable: 0, pendingBlockedByDeps: 0, pendingHasAssignee: 0 };

  if (workspaces.length === 0) {
    logger.debug('No workspaces to poll');
    return { claimablePlans, allPlansByWorkspace, summary };
  }

  logger.info('Polling workspaces for plans', { workspaceCount: workspaces.length });

  for (const workspace of workspaces) {
    try {
      //NOTE(self): Skip finished workspaces — sentinel issue blocks all new work
      if (workspace.finishedIssueNumber) {
        logger.debug('Skipping finished workspace', { workspace: getWorkspaceKey(workspace.owner, workspace.repo), finishedIssue: workspace.finishedIssueNumber });
        continue;
      }

      //NOTE(self): Fetch open issues with 'plan' label
      //NOTE(self): per_page: 30 to match other polling functions — active workspaces can have many plans
      const issuesResult = await listIssues({
        owner: workspace.owner,
        repo: workspace.repo,
        state: 'open',
        labels: ['plan'],
        per_page: 30,
      });

      if (!issuesResult.success) {
        logger.warn('Failed to fetch issues for workspace', {
          workspace: getWorkspaceKey(workspace.owner, workspace.repo),
          error: issuesResult.error,
        });
        continue;
      }

      //NOTE(self): Parse each issue as a plan
      for (const issue of issuesResult.data) {
        const plan = parsePlan(issue.body || '', issue.title);
        if (!plan) continue;

        //NOTE(self): Accumulate task stats across all plans
        summary.plansFound++;
        for (const task of plan.tasks) {
          summary.totalTasks++;
          if (task.status === 'completed') summary.completed++;
          else if (task.status === 'in_progress') summary.inProgress++;
          else if (task.status === 'claimed') summary.claimed++;
          else if (task.status === 'blocked') summary.blocked++;
          else summary.pending++;
        }

        //NOTE(self): Compute claimable diagnostics — why are pending tasks not claimable?
        const completedIds = new Set(plan.tasks.filter(t => t.status === 'completed').map(t => `Task ${t.number}`));
        for (const task of plan.tasks) {
          if (task.status !== 'pending') continue;
          if (task.assignee) {
            summary.pendingHasAssignee++;
          } else if (task.dependencies.some(dep => !completedIds.has(dep))) {
            summary.pendingBlockedByDeps++;
          }
        }

        //NOTE(self): Register plan assignees as peers
        //NOTE(self): Anyone assigned to tasks in a plan we're watching is likely a peer SOUL
        const config = getConfig();
        const ourUsername = config.github.username.toLowerCase();
        const planContext = `${workspace.owner}/${workspace.repo}#${issue.number}`;
        for (const task of plan.tasks) {
          if (task.assignee && task.assignee.toLowerCase() !== ourUsername) {
            registerPeer(task.assignee, 'plan', planContext);
          }
        }

        //NOTE(self): Find claimable tasks
        const claimableTasks = getClaimableTasks(plan);
        summary.claimable += claimableTasks.length;

        if (claimableTasks.length > 0) {
          claimablePlans.push({
            workspace,
            issueNumber: issue.number,
            issueUrl: issue.html_url,
            plan,
            claimableTasks,
          });

          logger.info('Found plan with claimable tasks', {
            workspace: getWorkspaceKey(workspace.owner, workspace.repo),
            issueNumber: issue.number,
            claimableCount: claimableTasks.length,
          });
        }
      }

      //NOTE(self): Track all plan issue numbers for this workspace (used for duplicate plan consolidation)
      const workspaceKey = getWorkspaceKey(workspace.owner, workspace.repo);
      const planIssueNumbers = issuesResult.data
        .filter(i => parsePlan(i.body || '', i.title))
        .map(i => i.number);
      if (planIssueNumbers.length > 0) {
        allPlansByWorkspace[workspaceKey] = { owner: workspace.owner, repo: workspace.repo, issueNumbers: planIssueNumbers };
      }

      //NOTE(self): Update last polled time
      workspace.lastPolled = new Date().toISOString();
      workspace.activePlanIssues = planIssueNumbers;

    } catch (err) {
      logger.error('Error polling workspace', {
        workspace: getWorkspaceKey(workspace.owner, workspace.repo),
        error: String(err),
      });
    }
  }

  //NOTE(self): Update last full poll time
  state.lastFullPoll = new Date().toISOString();
  saveState();

  return { claimablePlans, allPlansByWorkspace, summary };
}

//NOTE(self): A non-plan issue discovered in a watched workspace
export interface DiscoveredIssue {
  workspace: WatchedWorkspace;
  issue: import('@adapters/github/types.js').GitHubIssue;
}

//NOTE(self): Poll watched workspaces for ALL open issues (not just plan-labeled)
//NOTE(self): Filters out PRs, plan issues, and issues assigned to someone else
export async function pollWorkspacesForOpenIssues(): Promise<DiscoveredIssue[]> {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  const results: DiscoveredIssue[] = [];

  if (workspaces.length === 0) {
    return [];
  }

  const config = getConfig();
  const agentUsername = config.github.username.toLowerCase();

  logger.debug('Polling workspaces for open issues', { workspaceCount: workspaces.length });

  for (const workspace of workspaces) {
    try {
      //NOTE(self): Skip finished workspaces — sentinel issue blocks all new work
      if (workspace.finishedIssueNumber) {
        logger.debug('Skipping finished workspace for open issues', { workspace: getWorkspaceKey(workspace.owner, workspace.repo), finishedIssue: workspace.finishedIssueNumber });
        continue;
      }

      //NOTE(self): Fetch up to 30 issues — workspaces with active SOULs can have 15-20+ open issues
      //NOTE(self): per_page: 10 was too low and missed older issues entirely
      const issuesResult = await listIssues({
        owner: workspace.owner,
        repo: workspace.repo,
        state: 'open',
        sort: 'created',
        direction: 'desc',
        per_page: 30,
      });

      if (!issuesResult.success) {
        logger.warn('Failed to fetch issues for workspace', {
          workspace: getWorkspaceKey(workspace.owner, workspace.repo),
          error: issuesResult.error,
        });
        continue;
      }

      for (const issue of issuesResult.data) {
        //NOTE(self): Filter out issues with 'plan' label (handled by plan polling)
        const hasPlanLabel = issue.labels.some(l => l.name.toLowerCase() === 'plan');
        if (hasPlanLabel) continue;

        //NOTE(self): Filter out PRs (GitHub API returns them as issues too)
        if (issue.pull_request) continue;

        //NOTE(self): Auto-assign unassigned issues to the issue author (Scenario 14: every issue has an assignee)
        //NOTE(self): This ensures clean issue management — no orphaned unassigned issues
        if (issue.assignees.length === 0 && issue.user?.login) {
          const assignResult = await updateIssue({
            owner: workspace.owner,
            repo: workspace.repo,
            issue_number: issue.number,
            assignees: [issue.user.login],
          });
          if (assignResult.success) {
            logger.info('Auto-assigned unassigned issue to author', { repo: `${workspace.owner}/${workspace.repo}`, number: issue.number, author: issue.user.login });
          } else {
            logger.warn('Failed to auto-assign issue to author', { repo: `${workspace.owner}/${workspace.repo}`, number: issue.number, error: assignResult.error });
          }
        }

        //NOTE(self): All open non-plan, non-PR workspace issues are visible to all SOULs
        //NOTE(self): Don't filter by assignee — workspace issues are our collective responsibility
        //NOTE(self): The downstream analyzeConversation with isWorkspaceIssue handles engagement
        //NOTE(self): decisions (round-robin, saturation, consecutive reply prevention)
        results.push({ workspace, issue });
      }
    } catch (err) {
      logger.error('Error polling workspace for open issues', {
        workspace: getWorkspaceKey(workspace.owner, workspace.repo),
        error: String(err),
      });
    }
  }

  return results;
}

//NOTE(self): Get the next claimable task across all workspaces
export async function getNextClaimableTask(): Promise<{
  workspace: WatchedWorkspace;
  issueNumber: number;
  task: ParsedTask;
  plan: ParsedPlan;
} | null> {
  const { claimablePlans } = await pollWorkspacesForPlans();

  for (const discoveredPlan of claimablePlans) {
    if (discoveredPlan.claimableTasks.length > 0) {
      //NOTE(self): Return the first claimable task (lowest number)
      const task = discoveredPlan.claimableTasks.sort((a, b) => a.number - b.number)[0];
      return {
        workspace: discoveredPlan.workspace,
        issueNumber: discoveredPlan.issueNumber,
        task,
        plan: discoveredPlan.plan,
      };
    }
  }

  return null;
}

//NOTE(self): Get workspace discovery stats
export interface WorkspaceDiscoveryStats {
  watchedWorkspaces: number;
  lastFullPoll: string | null;
  totalActivePlans: number;
}

export function getWorkspaceDiscoveryStats(): WorkspaceDiscoveryStats {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);

  return {
    watchedWorkspaces: workspaces.length,
    lastFullPoll: state.lastFullPoll,
    totalActivePlans: workspaces.reduce((sum, w) => sum + w.activePlanIssues.length, 0),
  };
}

//NOTE(self): A PR in a watched workspace that needs review
export interface ReviewablePR {
  workspace: WatchedWorkspace;
  pr: GitHubPullRequest;
}

//NOTE(self): Poll watched workspaces for open PRs the agent hasn't reviewed yet
export async function pollWorkspacesForReviewablePRs(): Promise<ReviewablePR[]> {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  const results: ReviewablePR[] = [];

  if (workspaces.length === 0) {
    logger.debug('No workspaces to poll for reviewable PRs');
    return [];
  }

  const config = getConfig();
  const agentUsername = config.github.username.toLowerCase();

  logger.debug('Polling workspaces for reviewable PRs', { workspaceCount: workspaces.length });

  for (const workspace of workspaces) {
    try {
      const prsResult = await listPullRequests({
        owner: workspace.owner,
        repo: workspace.repo,
        state: 'open',
        sort: 'updated',
        direction: 'desc',
        per_page: 30,
      });

      if (!prsResult.success) {
        logger.warn('Failed to fetch PRs for workspace', {
          workspace: getWorkspaceKey(workspace.owner, workspace.repo),
          error: prsResult.error,
        });
        continue;
      }

      for (const pr of prsResult.data) {
        //NOTE(self): Skip draft PRs
        if (pr.draft === true) continue;

        //NOTE(self): Never review own PRs
        if (pr.user.login.toLowerCase() === agentUsername) continue;

        //NOTE(self): Fast path — if conversation is concluded AND PR hasn't been updated since, skip
        const existing = getConversation(workspace.owner, workspace.repo, pr.number);
        if (existing && existing.state === 'concluded' && existing.concludedAt) {
          const concludedTime = new Date(existing.concludedAt).getTime();
          const prUpdatedTime = new Date(pr.updated_at).getTime();
          if (prUpdatedTime <= concludedTime) continue;
          //NOTE(self): PR was updated after our conclusion — re-review it
        }

        //NOTE(self): API check — skip if agent already has a review on this PR
        const reviewsResult = await listPullRequestReviews({
          owner: workspace.owner,
          repo: workspace.repo,
          pull_number: pr.number,
        });

        if (reviewsResult.success) {
          const agentAlreadyReviewed = reviewsResult.data.some(
            r => r.user.login.toLowerCase() === agentUsername
          );
          if (agentAlreadyReviewed) continue;
        }

        //NOTE(self): Register PR author as peer (they're active in workspace)
        const key = getWorkspaceKey(workspace.owner, workspace.repo);
        registerPeer(pr.user.login, 'workspace', key);

        results.push({ workspace, pr });
      }
    } catch (err) {
      logger.error('Error polling workspace for reviewable PRs', {
        workspace: getWorkspaceKey(workspace.owner, workspace.repo),
        error: String(err),
      });
    }
  }

  return results;
}

//NOTE(self): Stale thresholds — memos are coordination artifacts and should be cleaned up faster
const STALE_ISSUE_DAYS = 7;
const STALE_MEMO_DAYS = 3;

//NOTE(self): Find and close stale open issues in watched workspaces
//NOTE(self): Stale = open, no activity for threshold days, not a plan issue, not a PR
//NOTE(self): Memo-labeled issues use a shorter threshold (3 days) — they're coordination artifacts
//NOTE(self): SOULs should keep workspaces clean — open issues that linger are noise
export async function cleanupStaleWorkspaceIssues(): Promise<{ closed: number; found: number }> {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  let found = 0;
  let closed = 0;

  if (workspaces.length === 0) return { closed, found };

  const now = Date.now();
  const staleThresholdMs = STALE_ISSUE_DAYS * 24 * 60 * 60 * 1000;
  const staleMemoThresholdMs = STALE_MEMO_DAYS * 24 * 60 * 60 * 1000;

  for (const workspace of workspaces) {
    try {
      const issuesResult = await listIssues({
        owner: workspace.owner,
        repo: workspace.repo,
        state: 'open',
        sort: 'updated',
        direction: 'asc', //NOTE(self): Oldest-updated first — most likely to be stale
        per_page: 30,
      });

      if (!issuesResult.success) continue;

      for (const issue of issuesResult.data) {
        //NOTE(self): Skip PRs (GitHub API returns them as issues)
        if (issue.pull_request) continue;

        //NOTE(self): Skip plan issues — plans have their own lifecycle
        const hasPlanLabel = issue.labels.some(l => l.name.toLowerCase() === 'plan');
        if (hasPlanLabel) continue;

        //NOTE(self): Skip discussion issues — they stay open until a human closes them
        const hasDiscussionLabel = issue.labels.some(l => l.name.toLowerCase() === DISCUSSION_LABEL);
        if (hasDiscussionLabel) continue;

        //NOTE(self): Memos use a shorter stale threshold (3 days vs 7 days)
        //NOTE(self): They're coordination artifacts — once read and discussed, they should be closed
        const isMemo = issue.labels.some(l => l.name.toLowerCase() === 'memo');
        const threshold = isMemo ? staleMemoThresholdMs : staleThresholdMs;

        //NOTE(self): Check if stale (no activity for threshold)
        const lastActivity = new Date(issue.updated_at).getTime();
        const staleDuration = now - lastActivity;
        if (staleDuration < threshold) continue;

        found++;
        const staleDays = Math.floor(staleDuration / (24 * 60 * 60 * 1000));

        //NOTE(self): Close the stale issue
        const closeResult = await updateIssue({
          owner: workspace.owner,
          repo: workspace.repo,
          issue_number: issue.number,
          state: 'closed',
        });

        if (closeResult.success) {
          closed++;
          logger.info('Closed stale workspace issue', {
            workspace: getWorkspaceKey(workspace.owner, workspace.repo),
            issue: issue.number,
            title: issue.title,
            staleDays,
          });
        }
      }
    } catch (err) {
      logger.error('Error cleaning up stale workspace issues', {
        workspace: getWorkspaceKey(workspace.owner, workspace.repo),
        error: String(err),
      });
    }
  }

  return { closed, found };
}

//NOTE(self): Close workspace issues that a SOUL has already handled but left open
//NOTE(self): This fixes the "one-shot trap" — after a SOUL comments on a workspace issue,
//NOTE(self): the consecutive reply check prevents re-engagement, so the issue stays open forever.
//NOTE(self): This function auto-closes issues where:
//NOTE(self):   1. Agent's comment is the most recent (we responded, no one followed up)
//NOTE(self):   2. Last activity was > 24 hours ago (gave others time to respond)
//NOTE(self):   3. Not a plan issue (plans have their own lifecycle)
//NOTE(self):   4. Not a PR
const HANDLED_ISSUE_HOURS = 24;

export async function closeHandledWorkspaceIssues(): Promise<{ closed: number; found: number }> {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  let found = 0;
  let closed = 0;

  if (workspaces.length === 0) return { closed, found };

  const config = getConfig();
  const agentUsername = config.github.username.toLowerCase();
  const now = Date.now();
  const thresholdMs = HANDLED_ISSUE_HOURS * 60 * 60 * 1000;

  for (const workspace of workspaces) {
    try {
      const issuesResult = await listIssues({
        owner: workspace.owner,
        repo: workspace.repo,
        state: 'open',
        sort: 'updated',
        direction: 'asc',
        per_page: 30,
      });

      if (!issuesResult.success) continue;

      for (const issue of issuesResult.data) {
        if (issue.pull_request) continue;
        const hasPlanLabel = issue.labels.some(l => l.name.toLowerCase() === 'plan');
        if (hasPlanLabel) continue;

        //NOTE(self): Skip discussion issues — they stay open until a human closes them
        const hasDiscussionLabel = issue.labels.some(l => l.name.toLowerCase() === DISCUSSION_LABEL);
        if (hasDiscussionLabel) continue;

        //NOTE(self): Check if enough time has passed since last activity
        const lastActivity = new Date(issue.updated_at).getTime();
        if (now - lastActivity < thresholdMs) continue;

        //NOTE(self): Fetch the thread to check if agent's comment is most recent
        const threadResult = await getIssueThread(
          { owner: workspace.owner, repo: workspace.repo, issue_number: issue.number },
          agentUsername
        );
        if (!threadResult.success) continue;

        const { comments, agentHasCommented } = threadResult.data;
        if (!agentHasCommented) continue;

        //NOTE(self): Check if agent's comment is the most recent
        const lastComment = comments[comments.length - 1];
        if (!lastComment || lastComment.user.login.toLowerCase() !== agentUsername) continue;

        found++;

        //NOTE(self): Auto-close — the SOUL responded and no one followed up
        const closeResult = await updateIssue({
          owner: workspace.owner,
          repo: workspace.repo,
          issue_number: issue.number,
          state: 'closed',
        });

        if (closeResult.success) {
          closed++;
          logger.info('Auto-closed handled workspace issue', {
            workspace: getWorkspaceKey(workspace.owner, workspace.repo),
            issue: issue.number,
            title: issue.title,
            hoursIdle: Math.floor((now - lastActivity) / (60 * 60 * 1000)),
          });
        }
      }
    } catch (err) {
      logger.error('Error closing handled workspace issues', {
        workspace: getWorkspaceKey(workspace.owner, workspace.repo),
        error: String(err),
      });
    }
  }

  return { closed, found };
}

//NOTE(self): Find approved PRs in watched workspaces that can be auto-merged
//NOTE(self): Also detects PRs stuck with only rejections or no reviews at all
const REJECTED_PR_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const UNREVIEWED_PR_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface PollPRsResult {
  approved: { workspace: WatchedWorkspace; pr: GitHubPullRequest; approvals: number }[];
  stuckRejected: { workspace: WatchedWorkspace; pr: GitHubPullRequest }[];
  stuckUnreviewed: { workspace: WatchedWorkspace; pr: GitHubPullRequest }[];
}

export async function pollWorkspacesForApprovedPRs(): Promise<PollPRsResult> {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  const approved: PollPRsResult['approved'] = [];
  const stuckRejected: PollPRsResult['stuckRejected'] = [];
  const stuckUnreviewed: PollPRsResult['stuckUnreviewed'] = [];

  if (workspaces.length === 0) return { approved, stuckRejected, stuckUnreviewed };

  const config = getConfig();
  const agentUsername = config.github.username.toLowerCase();
  const now = Date.now();

  for (const workspace of workspaces) {
    try {
      //NOTE(self): Fetch up to 30 open PRs — active workspaces can have many concurrent PRs
      //NOTE(self): per_page: 10 was too low and missed PRs beyond page 1 (same fix as v8.0.7 for open issues)
      const prsResult = await listPullRequests({
        owner: workspace.owner,
        repo: workspace.repo,
        state: 'open',
        sort: 'updated',
        direction: 'desc',
        per_page: 30,
      });

      if (!prsResult.success) continue;

      for (const pr of prsResult.data) {
        if (pr.draft === true) continue;

        //NOTE(self): Get reviews to check approval status
        const reviewsResult = await listPullRequestReviews({
          owner: workspace.owner,
          repo: workspace.repo,
          pull_number: pr.number,
        });

        if (!reviewsResult.success) continue;

        //NOTE(self): Compute final review state per user (latest review wins)
        const latestReviewByUser = new Map<string, string>();
        for (const review of reviewsResult.data) {
          if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
          latestReviewByUser.set(review.user.login.toLowerCase(), review.state);
        }

        //NOTE(self): Every requested reviewer must LGTM before merge
        //NOTE(self): If there are still pending reviewers (requested_reviewers not empty), skip
        const pendingReviewers = (pr.requested_reviewers || []).length;
        const approvalCount = [...latestReviewByUser.values()].filter(s => s === 'APPROVED').length;
        const rejectCount = [...latestReviewByUser.values()].filter(s => s === 'CHANGES_REQUESTED').length;
        const totalReviewers = latestReviewByUser.size + pendingReviewers;

        if (pendingReviewers === 0 && approvalCount > 0 && approvalCount === latestReviewByUser.size) {
          //NOTE(self): All reviewers have reviewed and all approved — ready to merge
          approved.push({ workspace, pr, approvals: approvalCount });
        } else if (rejectCount > 0 && approvalCount === 0 && pendingReviewers === 0) {
          //NOTE(self): All reviewers reviewed but only rejections — check if stuck for >1 hour
          const prCreatedAt = new Date(pr.created_at).getTime();
          if (now - prCreatedAt > REJECTED_PR_TIMEOUT_MS) {
            stuckRejected.push({ workspace, pr });
          }
        } else if (latestReviewByUser.size === 0 && pendingReviewers > 0) {
          //NOTE(self): No reviews at all, reviewers still pending — check if stuck for >2 hours
          const prCreatedAt = new Date(pr.created_at).getTime();
          if (now - prCreatedAt > UNREVIEWED_PR_TIMEOUT_MS) {
            stuckUnreviewed.push({ workspace, pr });
          }
        }
      }
    } catch (err) {
      logger.error('Error polling workspace for approved PRs', {
        workspace: getWorkspaceKey(workspace.owner, workspace.repo),
        error: String(err),
      });
    }
  }

  return { approved, stuckRejected, stuckUnreviewed };
}

//NOTE(self): Auto-merge an approved PR — squash merge, then delete the feature branch
export async function autoMergeApprovedPR(
  owner: string,
  repo: string,
  pr: GitHubPullRequest
): Promise<{ success: boolean; error?: string; planComplete?: boolean }> {
  logger.info('Auto-merging approved PR', { owner, repo, number: pr.number, title: pr.title });

  const mergeResult = await mergePullRequest({
    owner,
    repo,
    pull_number: pr.number,
    commit_title: `${pr.title} (#${pr.number})`,
    merge_method: 'squash',
  });

  if (!mergeResult.success) {
    const isConflict = mergeResult.error?.includes('not mergeable') ||
                       mergeResult.error?.includes('405');
    if (isConflict) {
      logger.warn('Auto-merge failed due to merge conflict, attempting recovery', { owner, repo, number: pr.number });
      const recovery = await handleMergeConflictPR(owner, repo, pr);
      if (recovery.success) {
        logger.info('Merge conflict recovery succeeded, task reset to pending', { owner, repo, number: pr.number, taskNumber: recovery.taskNumber });
      } else {
        logger.warn('Merge conflict recovery failed', { owner, repo, number: pr.number, error: recovery.error });
      }
      return { success: false, error: 'merge_conflict_retry' };
    }
    logger.warn('Auto-merge failed', { owner, repo, number: pr.number, error: mergeResult.error });
    return { success: false, error: mergeResult.error };
  }

  //NOTE(self): Delete the feature branch after successful merge
  const headRef = pr.head?.ref;
  if (headRef && headRef !== 'main' && headRef !== 'master') {
    const deleteResult = await deleteBranch(owner, repo, headRef);
    if (deleteResult.success) {
      logger.info('Deleted feature branch after auto-merge', { branch: headRef, number: pr.number });
    } else {
      logger.debug('Branch deletion failed after auto-merge (non-fatal)', { branch: headRef, error: deleteResult.error });
    }
  }

  //NOTE(self): Create follow-up issue from reviewer feedback if any reviews had substantive comments
  await createFollowUpIssueFromReviews(owner, repo, pr);

  //NOTE(self): Mark task as completed NOW that the PR is actually merged
  //NOTE(self): This is the single source of truth for task completion — not PR creation
  const planComplete = await completeTaskAfterMerge(owner, repo, pr);

  return { success: true, planComplete };
}

//NOTE(self): After merging a PR, check if reviewers left substantive feedback and create a follow-up issue
async function createFollowUpIssueFromReviews(
  owner: string,
  repo: string,
  pr: GitHubPullRequest
): Promise<void> {
  try {
    const reviewsResult = await listPullRequestReviews({
      owner,
      repo,
      pull_number: pr.number,
    });

    if (!reviewsResult.success) return;

    //NOTE(self): Collect reviews with substantive body text (not empty, not just "LGTM")
    const feedbackReviews = reviewsResult.data.filter(review => {
      if (!review.body || review.body.trim().length === 0) return false;
      const normalized = review.body.trim().toLowerCase();
      if (normalized === 'lgtm' || normalized === 'lgtm!' || normalized === 'looks good') return false;
      return true;
    });

    if (feedbackReviews.length === 0) return;

    //NOTE(self): Build the follow-up issue body from all reviewer feedback
    const feedbackSections = feedbackReviews.map(review =>
      `### Feedback from @${review.user.login}\n> ${review.body!.trim().split('\n').join('\n> ')}`
    );

    const issueBody = [
      `PR #${pr.number} (\`${pr.title}\`) has been merged. Reviewers left feedback that may warrant follow-up work.`,
      '',
      ...feedbackSections,
      '',
      `---`,
      `*Auto-created from reviewer feedback on #${pr.number}.*`,
    ].join('\n');

    const issueResult = await createIssue({
      owner,
      repo,
      title: `Follow-up: reviewer feedback from #${pr.number}`,
      body: issueBody,
    });

    if (issueResult.success) {
      logger.info('Created follow-up issue from reviewer feedback', { owner, repo, prNumber: pr.number, issueNumber: issueResult.data.number });
    } else {
      logger.warn('Failed to create follow-up issue from reviewer feedback', { owner, repo, prNumber: pr.number, error: issueResult.error });
    }
  } catch (err) {
    logger.warn('Error creating follow-up issue from reviews (non-fatal)', { owner, repo, prNumber: pr.number, error: String(err) });
  }
}

//NOTE(self): After a PR is merged, mark the corresponding task as completed and check plan completion
//NOTE(self): This is the single source of truth for task completion — tasks stay in_progress until merge
async function completeTaskAfterMerge(
  owner: string,
  repo: string,
  pr: GitHubPullRequest
): Promise<boolean> {
  try {
    const headRef = pr.head?.ref || '';
    const taskMatch = headRef.match(/^task-(\d+)-/);
    if (!taskMatch) return false; // Not a task PR

    const taskNumber = parseInt(taskMatch[1], 10);

    // Find the plan issue
    const issuesResult = await listIssues({
      owner,
      repo,
      state: 'open',
      labels: ['plan'],
      per_page: 5,
    });
    if (!issuesResult.success || issuesResult.data.length === 0) return false;

    const planIssue = issuesResult.data[0];

    // Mark task as completed
    const updateResult = await freshUpdateTaskInPlan(owner, repo, planIssue.number, taskNumber, {
      status: 'completed',
      assignee: null,
    });
    if (!updateResult.success) {
      logger.warn('Failed to mark task completed after merge', { owner, repo, taskNumber, error: updateResult.error });
      return false;
    }
    logger.info('Marked task completed after PR merge', { owner, repo, planIssue: planIssue.number, taskNumber, prNumber: pr.number });

    // Release assignee from the plan issue
    const config = getConfig();
    await removeIssueAssignee({
      owner,
      repo,
      issue_number: planIssue.number,
      assignees: [config.github.username],
    });

    // Check if all tasks in the plan are now completed
    const freshResult = await fetchFreshPlan(owner, repo, planIssue.number);
    if (!freshResult.success || !freshResult.plan) return false;

    const allComplete = freshResult.plan.tasks.every(t => t.status === 'completed');
    if (allComplete) {
      logger.info('All tasks completed after merge — closing plan', { owner, repo, planIssue: planIssue.number });
      await handlePlanComplete(owner, repo, planIssue.number);
      return true;
    }

    return false;
  } catch (err) {
    logger.warn('Error in post-merge task completion (non-fatal)', { owner, repo, prNumber: pr.number, error: String(err) });
    return false;
  }
}

//NOTE(self): Handle merge conflict recovery — close conflicting PR, delete branch, reset task to pending
export async function handleMergeConflictPR(
  owner: string,
  repo: string,
  pr: GitHubPullRequest
): Promise<{ success: boolean; taskNumber?: number; error?: string }> {
  const headRef = pr.head?.ref || '';
  const taskMatch = headRef.match(/^task-(\d+)-/);
  const taskNumber = taskMatch ? parseInt(taskMatch[1], 10) : null;

  // Step 1: Close the PR
  const closeResult = await updateIssue({
    owner,
    repo,
    issue_number: pr.number,
    state: 'closed',
  });
  if (!closeResult.success) {
    logger.warn('Failed to close conflicting PR', { owner, repo, number: pr.number, error: closeResult.error });
    return { success: false, error: `Failed to close PR: ${closeResult.error}` };
  }
  logger.info('Closed conflicting PR', { owner, repo, number: pr.number });

  // Step 2: Comment on the PR explaining why
  const commentResult = await createIssueComment({
    owner,
    repo,
    issue_number: pr.number,
    body: `This PR was closed automatically due to merge conflicts. ${taskNumber ? `Task ${taskNumber} has been reset to pending and will be re-executed from a fresh branch.` : 'The branch will be deleted.'}`,
  });
  if (!commentResult.success) {
    logger.warn('Failed to comment on conflicting PR', { owner, repo, number: pr.number, error: commentResult.error });
  }

  // Step 3: Delete the branch
  if (headRef && headRef !== 'main' && headRef !== 'master') {
    const deleteResult = await deleteBranch(owner, repo, headRef);
    if (deleteResult.success) {
      logger.info('Deleted conflicting branch', { branch: headRef, number: pr.number });
    } else {
      logger.warn('Failed to delete conflicting branch (non-fatal)', { branch: headRef, error: deleteResult.error });
    }
  }

  // Step 4: Reset task to pending in the plan
  if (taskNumber === null) {
    logger.warn('Could not extract task number from branch name, skipping plan reset', { branch: headRef });
    return { success: true, error: 'no_task_number' };
  }

  // Find the plan issue in the same repo
  const issuesResult = await listIssues({
    owner,
    repo,
    state: 'open',
    labels: ['plan'],
    per_page: 5,
  });
  if (!issuesResult.success || issuesResult.data.length === 0) {
    logger.warn('Could not find plan issue for task reset', { owner, repo, taskNumber });
    return { success: true, taskNumber, error: 'no_plan_issue_found' };
  }

  const planIssue = issuesResult.data[0];

  // Reset the task to pending with no assignee
  const resetResult = await freshUpdateTaskInPlan(owner, repo, planIssue.number, taskNumber, {
    status: 'pending',
    assignee: null,
  });
  if (!resetResult.success) {
    logger.warn('Failed to reset task in plan', { owner, repo, planIssue: planIssue.number, taskNumber, error: resetResult.error });
    return { success: false, taskNumber, error: `Failed to reset task: ${resetResult.error}` };
  }
  logger.info('Reset task to pending after merge conflict', { owner, repo, planIssue: planIssue.number, taskNumber });

  // Comment on the plan issue
  const planCommentResult = await createIssueComment({
    owner,
    repo,
    issue_number: planIssue.number,
    body: `Task ${taskNumber} PR #${pr.number} had merge conflicts and was closed. Task has been reset to pending for re-execution.`,
  });
  if (!planCommentResult.success) {
    logger.warn('Failed to comment on plan issue about retry', { owner, repo, planIssue: planIssue.number, error: planCommentResult.error });
  }

  return { success: true, taskNumber };
}

//NOTE(self): Plan Synthesis — detect workspaces that need a new plan synthesized from open issues
//NOTE(self): Cooldown: 1 hour between synthesis attempts per workspace
const PLAN_SYNTHESIS_COOLDOWN_MS = 60 * 60 * 1000;

//NOTE(self): Update the synthesis timestamp for a workspace (called after synthesis attempt)
export function updateWorkspaceSynthesisTimestamp(owner: string, repo: string): void {
  const state = loadState();
  const key = getWorkspaceKey(owner, repo);
  if (state.workspaces[key]) {
    state.workspaces[key].lastPlanSynthesisAttempt = new Date().toISOString();
    saveState();
  }
}

//NOTE(self): Get workspaces that need plan synthesis — no open plans AND cooldown expired
export function getWorkspacesNeedingPlanSynthesis(): WatchedWorkspace[] {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  const now = Date.now();

  return workspaces.filter(ws => {
    //NOTE(self): Skip finished workspaces — sentinel issue blocks all new work
    if (ws.finishedIssueNumber) return false;

    //NOTE(self): Must have zero active plan issues (set by pollWorkspacesForPlans)
    if (ws.activePlanIssues.length > 0) return false;

    //NOTE(self): Must have been polled at least once (otherwise we don't know the plan state)
    if (!ws.lastPolled) return false;

    //NOTE(self): Cooldown check — skip if last attempt was within 1 hour
    if (ws.lastPlanSynthesisAttempt) {
      const lastAttempt = new Date(ws.lastPlanSynthesisAttempt).getTime();
      if (now - lastAttempt < PLAN_SYNTHESIS_COOLDOWN_MS) return false;
    }

    return true;
  });
}

//NOTE(self): Health Check Cooldown — 24 hours between checks per workspace
//NOTE(self): Much longer than plan synthesis (1h) because health checks are expensive (LLM call + file reads)
const HEALTH_CHECK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

//NOTE(self): Get workspaces that need a health check — no open plans, no open issues (handled in scheduler),
//NOTE(self): and cooldown expired. The scheduler calls this after confirming 0 open issues.
export function getWorkspacesNeedingHealthCheck(): WatchedWorkspace[] {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  const now = Date.now();

  return workspaces.filter(ws => {
    //NOTE(self): Must have zero active plan issues
    if (ws.activePlanIssues.length > 0) return false;

    //NOTE(self): Must have been polled at least once
    if (!ws.lastPolled) return false;

    //NOTE(self): Cooldown check — skip if last attempt was within 24 hours
    if (ws.lastHealthCheckAttempt) {
      const lastAttempt = new Date(ws.lastHealthCheckAttempt).getTime();
      if (now - lastAttempt < HEALTH_CHECK_COOLDOWN_MS) return false;
    }

    return true;
  });
}

//NOTE(self): Update the health check timestamp for a workspace (called after health check attempt)
export function updateWorkspaceHealthCheckTimestamp(owner: string, repo: string): void {
  const state = loadState();
  const key = getWorkspaceKey(owner, repo);
  if (state.workspaces[key]) {
    state.workspaces[key].lastHealthCheckAttempt = new Date().toISOString();
    saveState();
  }
}

//NOTE(self): Check if a specific workspace is due for a health check (cooldown expired)
export function isHealthCheckDue(workspace: WatchedWorkspace): boolean {
  if (workspace.lastHealthCheckAttempt) {
    const lastAttempt = new Date(workspace.lastHealthCheckAttempt).getTime();
    if (Date.now() - lastAttempt < HEALTH_CHECK_COOLDOWN_MS) return false;
  }
  return true;
}

//NOTE(self): "LIL INTDEV FINISHED" sentinel — marks a workspace as complete
//NOTE(self): Prevents plan synthesis, task claiming, and health checks until closed

export const DISCUSSION_LABEL = 'discussion';

const FINISHED_LABEL = 'finished';
const FINISHED_TITLE_PREFIX = 'LIL INTDEV FINISHED:';

//NOTE(self): Check if a workspace has a finished sentinel (local state only — fast, no API call)
export function isWorkspaceFinished(owner: string, repo: string): boolean {
  const state = loadState();
  const key = getWorkspaceKey(owner, repo);
  return !!state.workspaces[key]?.finishedIssueNumber;
}

//NOTE(self): Create a "LIL INTDEV FINISHED" sentinel issue for a completed workspace
export async function createFinishedSentinel(
  owner: string,
  repo: string,
  summary: string,
): Promise<number | null> {
  try {
    const result = await createIssue({
      owner,
      repo,
      title: `${FINISHED_TITLE_PREFIX} ${summary}`,
      body: `This workspace has been assessed as complete.\n\n**Summary:** ${summary}\n\n---\n\n**What this means:**\n- No new plans will be created\n- No new tasks will be claimed\n- SOULs will not start new work in this workspace\n\n**To restart work:** Close this issue, or comment on it describing what you need. SOULs will pick it up automatically on the next poll cycle.`,
      labels: [FINISHED_LABEL],
    });

    if (!result.success) {
      logger.warn('Failed to create finished sentinel issue', { owner, repo, error: result.error });
      return null;
    }

    const issueNumber = result.data.number;

    //NOTE(self): Store in local state so we skip this workspace without API calls
    const state = loadState();
    const key = getWorkspaceKey(owner, repo);
    if (state.workspaces[key]) {
      state.workspaces[key].finishedIssueNumber = issueNumber;
      saveState();
    }

    logger.info('Created finished sentinel issue', { owner, repo, issueNumber });
    return issueNumber;
  } catch (err) {
    logger.error('Error creating finished sentinel issue', { owner, repo, error: String(err) });
    return null;
  }
}

//NOTE(self): Verify the finished sentinel is still open (called during health check cooldown)
//NOTE(self): If someone closed it, clear the local state so the workspace becomes active again
export async function verifyFinishedSentinel(owner: string, repo: string): Promise<boolean> {
  const state = loadState();
  const key = getWorkspaceKey(owner, repo);
  const issueNumber = state.workspaces[key]?.finishedIssueNumber;

  if (!issueNumber) return false;

  try {
    const result = await listIssues({
      owner,
      repo,
      state: 'open',
      labels: [FINISHED_LABEL],
      per_page: 5,
    });

    if (!result.success) return true; //NOTE(self): Assume still finished on API error

    const stillOpen = result.data.some(i => i.number === issueNumber);
    if (!stillOpen) {
      //NOTE(self): Sentinel was closed — clear local state, workspace is active again
      state.workspaces[key].finishedIssueNumber = undefined;
      saveState();
      logger.info('Finished sentinel was closed — workspace is active again', { owner, repo, issueNumber });
      return false;
    }

    //NOTE(self): Sentinel is still open — check if a non-SOUL user commented (owner wants more work)
    const config = getConfig();
    const agentUsername = config.github.username.toLowerCase();
    const threadResult = await getIssueThread(
      { owner, repo, issue_number: issueNumber },
      agentUsername
    );
    if (threadResult.success) {
      const humanComment = threadResult.data.comments.find(c => {
        const login = c.user.login.toLowerCase();
        return login !== agentUsername && !isPeer(c.user.login);
      });
      if (humanComment) {
        //NOTE(self): Human commented on sentinel — auto-close it and reactivate workspace
        await updateIssue({ owner, repo, issue_number: issueNumber, state: 'closed' });
        state.workspaces[key].finishedIssueNumber = undefined;
        saveState();
        const preview = humanComment.body.slice(0, 80);
        logger.info('Finished sentinel reactivated via human comment — workspace is active again', { owner, repo, issueNumber, commenter: humanComment.user.login, preview });
        return false;
      }
    }

    return true;
  } catch {
    return true; //NOTE(self): Assume still finished on error
  }
}

//NOTE(self): Clear the finished sentinel for a workspace (called when sentinel is externally closed)
export function clearFinishedSentinel(owner: string, repo: string): void {
  const state = loadState();
  const key = getWorkspaceKey(owner, repo);
  if (state.workspaces[key]) {
    state.workspaces[key].finishedIssueNumber = undefined;
    saveState();
  }
}

//NOTE(self): Close issues that were rolled up into a synthesized plan
//NOTE(self): Posts a linking comment and closes each issue
export async function closeRolledUpIssues(
  owner: string,
  repo: string,
  issueNumbers: number[],
  planIssueNumber: number
): Promise<{ closed: number }> {
  let closed = 0;

  for (const issueNumber of issueNumbers) {
    try {
      //NOTE(self): Post comment linking to the plan
      const commentResult = await createIssueComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `Rolled into plan #${planIssueNumber} — closing.`,
      });
      if (!commentResult.success) {
        logger.warn('Failed to comment on rolled-up issue', { owner, repo, issueNumber, error: commentResult.error });
      }

      //NOTE(self): Close the issue
      const closeResult = await updateIssue({
        owner,
        repo,
        issue_number: issueNumber,
        state: 'closed',
      });
      if (closeResult.success) {
        closed++;
        logger.info('Closed rolled-up issue', { owner, repo, issueNumber, planIssueNumber });
      } else {
        logger.warn('Failed to close rolled-up issue', { owner, repo, issueNumber, error: closeResult.error });
      }
    } catch (err) {
      logger.error('Error closing rolled-up issue', { owner, repo, issueNumber, error: String(err) });
    }
  }

  return { closed };
}
