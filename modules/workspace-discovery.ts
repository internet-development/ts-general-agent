//NOTE(self): Workspace Discovery Module
//NOTE(self): Poll watched workspaces for plan issues and claimable tasks
//NOTE(self): Workspaces are discovered via Bluesky threads (not hardcoded)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';
import { listIssues } from '@adapters/github/list-issues.js';
import { getRepository } from '@adapters/github/get-repository.js';
import { parsePlan, getClaimableTasks, type ParsedPlan, type ParsedTask } from '@skills/self-plan-parse.js';

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
    logger.debug('Workspace already being watched', { key });
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
