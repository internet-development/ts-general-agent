import * as github from '@adapters/github/index.js';
import { logger } from '@modules/logger.js';

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
