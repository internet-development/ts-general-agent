import * as github from '@adapters/github/index.js';
import { logger } from '@modules/logger.js';
import { join } from 'path';

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
