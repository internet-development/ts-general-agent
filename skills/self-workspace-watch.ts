//NOTE(self): Skill to add/remove workspaces from watch list
//NOTE(self): Called when workspace URLs are seen in Bluesky threads

import { logger } from '@modules/logger.js';
import {
  watchWorkspace,
  unwatchWorkspace,
  getWatchedWorkspaces,
  isWatchingWorkspace,
  parseGitHubWorkspaceUrl,
  type WatchedWorkspace,
} from '@modules/workspace-discovery.js';
import { findExistingWorkspace, getWorkspaceUrl } from '@skills/self-github-create-workspace.js';

const WORKSPACE_PREFIX = 'www-lil-intdev-';

//NOTE(self): Extract workspace URLs from text (Bluesky post, facets, etc.)
export function extractWorkspaceUrls(text: string): string[] {
  const urls: string[] = [];

  //NOTE(self): Match GitHub repository URLs
  const urlRegex = /https?:\/\/github\.com\/([^\/\s]+)\/([^\/\s\?#]+)/g;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    const repoName = match[2];
    //NOTE(self): Only watch repositories with the workspace prefix
    if (repoName.startsWith(WORKSPACE_PREFIX)) {
      urls.push(match[0]);
    }
  }

  return urls;
}

//NOTE(self): Process text and add any workspace URLs to watch list
export function processTextForWorkspaces(text: string, threadUri?: string): number {
  const urls = extractWorkspaceUrls(text);
  let added = 0;

  for (const url of urls) {
    const parsed = parseGitHubWorkspaceUrl(url);
    if (!parsed) continue;

    if (!isWatchingWorkspace(parsed.owner, parsed.repo)) {
      watchWorkspace(parsed.owner, parsed.repo, url, threadUri);
      added++;
      logger.info('Discovered workspace in thread', {
        owner: parsed.owner,
        repo: parsed.repo,
        threadUri,
      });
    }
  }

  return added;
}

//NOTE(self): Check if a URL is a workspace URL
export function isWorkspaceUrl(url: string): boolean {
  const parsed = parseGitHubWorkspaceUrl(url);
  if (!parsed) return false;
  return parsed.repo.startsWith(WORKSPACE_PREFIX);
}

//NOTE(self): Get the current list of watched workspaces (for display/debugging)
export function listWatchedWorkspaces(): WatchedWorkspace[] {
  return getWatchedWorkspaces();
}

//NOTE(self): Stop watching a workspace
export function stopWatchingWorkspace(owner: string, repo: string): void {
  unwatchWorkspace(owner, repo);
}

//NOTE(self): Ensure we're watching the default workspace for an org (if it exists)
export async function ensureWatchingDefaultWorkspace(org: string): Promise<boolean> {
  //NOTE(self): Check if a workspace exists in the org
  const workspaceName = await findExistingWorkspace(org);
  if (!workspaceName) {
    logger.debug('No workspace found in org', { org });
    return false;
  }

  //NOTE(self): Check if we're already watching
  if (isWatchingWorkspace(org, workspaceName)) {
    return true;
  }

  //NOTE(self): Add to watch list
  const url = `https://github.com/${org}/${workspaceName}`;
  watchWorkspace(org, workspaceName, url);

  return true;
}
