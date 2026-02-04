import * as github from '@adapters/github/index.js';
import { logger } from '@modules/logger.js';

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
