import * as github from '@adapters/github/index.js';
import { logger } from '@modules/logger.js';

export async function starRepo(owner: string, repo: string): Promise<boolean> {
  const result = await github.starRepository(owner, repo);
  if (!result.success) {
    logger.error('Failed to star repo', { error: result.error });
    return false;
  }
  logger.info('Starred repo', { owner, repo });
  return true;
}
