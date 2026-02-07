//NOTE(self): Workspace Discovery Module
//NOTE(self): Poll watched workspaces for plan issues, claimable tasks, and reviewable PRs
//NOTE(self): Workspaces are discovered via Bluesky threads (not hardcoded)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';
import { listIssues } from '@adapters/github/list-issues.js';
import { getRepository } from '@adapters/github/get-repository.js';
import { listPullRequests } from '@adapters/github/list-pull-requests.js';
import { listPullRequestReviews } from '@adapters/github/list-pull-request-reviews.js';
import type { GitHubPullRequest } from '@adapters/github/types.js';
import { parsePlan, getClaimableTasks, type ParsedPlan, type ParsedTask } from '@local-tools/self-plan-parse.js';
import { registerPeer, isPeerByBlueskyHandle } from '@modules/peer-awareness.js';
import { getConfig } from '@modules/config.js';
import { getConversation } from '@modules/github-engagement.js';

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
}

//NOTE(self): A discovered plan with claimable tasks
export interface DiscoveredPlan {
  workspace: WatchedWorkspace;
  issueNumber: number;
  issueUrl: string;
  plan: ParsedPlan;
  claimableTasks: ParsedTask[];
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
    writeFileSync(WATCHED_WORKSPACES_PATH, JSON.stringify(discoveryState, null, 2));
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
export async function pollWorkspacesForPlans(): Promise<DiscoveredPlan[]> {
  const state = loadState();
  const workspaces = Object.values(state.workspaces);
  const discoveredPlans: DiscoveredPlan[] = [];

  if (workspaces.length === 0) {
    logger.debug('No workspaces to poll');
    return [];
  }

  logger.info('Polling workspaces for plans', { workspaceCount: workspaces.length });

  for (const workspace of workspaces) {
    try {
      //NOTE(self): Fetch open issues with 'plan' label
      const issuesResult = await listIssues({
        owner: workspace.owner,
        repo: workspace.repo,
        state: 'open',
        labels: ['plan'],
        per_page: 10,
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

        if (claimableTasks.length > 0) {
          discoveredPlans.push({
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

      //NOTE(self): Update last polled time
      workspace.lastPolled = new Date().toISOString();
      workspace.activePlanIssues = issuesResult.data
        .filter(i => parsePlan(i.body || '', i.title))
        .map(i => i.number);

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

  return discoveredPlans;
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
      const issuesResult = await listIssues({
        owner: workspace.owner,
        repo: workspace.repo,
        state: 'open',
        sort: 'created',
        direction: 'desc',
        per_page: 10,
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

        //NOTE(self): Filter out issues assigned to someone else
        if (issue.assignees.length > 0) {
          const assignedToUs = issue.assignees.some(a => a.login.toLowerCase() === agentUsername);
          if (!assignedToUs) continue;
        }

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
  const plans = await pollWorkspacesForPlans();

  for (const discoveredPlan of plans) {
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
        per_page: 10,
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
