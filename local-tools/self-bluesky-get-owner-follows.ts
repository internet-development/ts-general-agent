import * as atproto from '@adapters/atproto/index.js';
import { logger } from '@modules/logger.js';

export async function getOwnerFollows(ownerDid: string): Promise<atproto.AtprotoFollower[]> {
  const result = await atproto.getFollows({ actor: ownerDid, limit: 100 });
  if (!result.success) {
    logger.error('Failed to get owner follows', { error: result.error });
    return [];
  }
  return result.data.follows;
}
