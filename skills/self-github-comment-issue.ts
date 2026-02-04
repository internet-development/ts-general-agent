import * as github from '@adapters/github/index.js';
import { logger } from '@modules/logger.js';

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
