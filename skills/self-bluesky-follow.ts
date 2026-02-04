import * as atproto from '@adapters/atproto/index.js';
import { logger } from '@modules/logger.js';

export async function followPerson(did: string): Promise<boolean> {
  const result = await atproto.followUser({ did });
  if (!result.success) {
    logger.error('Failed to follow', { error: result.error });
    return false;
  }
  logger.info('Followed user', { did });
  return true;
}
