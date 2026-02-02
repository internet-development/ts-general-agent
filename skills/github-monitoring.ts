import * as github from '@adapters/github/index.js';
import { logger } from '@modules/logger.js';
import { join } from 'path';

export interface RepoToMonitor {
  owner: string;
  repo: string;
  reason: string;
}

export async function getOpenIssues(
  owner: string,
  repo: string,
  limit = 10
): Promise<github.GitHubIssue[]> {
  const result = await github.listIssues({
    owner,
    repo,
    state: 'open',
    per_page: limit,
    sort: 'updated',
    direction: 'desc',
  });

  if (!result.success) {
    logger.error('Failed to get issues', { owner, repo, error: result.error });
    return [];
  }

  return result.data;
}

export async function getOpenPRs(
  owner: string,
  repo: string,
  limit = 10
): Promise<github.GitHubPullRequest[]> {
  const result = await github.listPullRequests({
    owner,
    repo,
    state: 'open',
    per_page: limit,
    sort: 'updated',
    direction: 'desc',
  });

  if (!result.success) {
    logger.error('Failed to get PRs', { owner, repo, error: result.error });
    return [];
  }

  return result.data;
}

export async function commentOnIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<boolean> {
  const result = await github.createIssueComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });

  if (!result.success) {
    logger.error('Failed to comment on issue', { error: result.error });
    return false;
  }

  logger.info('Commented on issue', { owner, repo, issueNumber });
  return true;
}

export async function commentOnPR(
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<boolean> {
  const result = await github.createPullRequestComment({
    owner,
    repo,
    pull_number: prNumber,
    body,
  });

  if (!result.success) {
    logger.error('Failed to comment on PR', { error: result.error });
    return false;
  }

  logger.info('Commented on PR', { owner, repo, prNumber });
  return true;
}

export async function cloneRepo(
  owner: string,
  repo: string,
  workreposPath: string
): Promise<string | null> {
  const targetDir = join(workreposPath, owner, repo);

  const result = await github.cloneRepository({
    owner,
    repo,
    targetDir,
    depth: 1,
  });

  if (!result.success) {
    logger.error('Failed to clone repo', { error: result.error });
    return null;
  }

  logger.info('Cloned repo', { owner, repo, path: result.data.path });
  return result.data.path;
}

export async function starRepo(owner: string, repo: string): Promise<boolean> {
  const result = await github.starRepository(owner, repo);
  if (!result.success) {
    logger.error('Failed to star repo', { error: result.error });
    return false;
  }
  logger.info('Starred repo', { owner, repo });
  return true;
}
