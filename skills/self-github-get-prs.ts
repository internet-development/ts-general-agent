import * as github from '@adapters/github/index.js';
import { logger } from '@modules/logger.js';

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
