import * as atproto from '@adapters/atproto/index.js';
import { logger } from '@modules/logger.js';

export async function engageWithPost(
  postUri: string,
  postCid: string,
  action: 'like' | 'repost'
): Promise<boolean> {
  if (action === 'like') {
    const result = await atproto.likePost({ uri: postUri, cid: postCid });
    if (!result.success) {
      logger.error('Failed to like', { error: result.error });
      return false;
    }
    return true;
  }

  if (action === 'repost') {
    const result = await atproto.repost({ uri: postUri, cid: postCid });
    if (!result.success) {
      logger.error('Failed to repost', { error: result.error });
      return false;
    }
    return true;
  }

  return false;
}
