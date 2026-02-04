import * as atproto from '@adapters/atproto/index.js';
import { logger } from '@modules/logger.js';

export async function checkTimeline(limit = 20): Promise<atproto.AtprotoFeedItem[]> {
  const result = await atproto.getTimeline({ limit });
  if (!result.success) {
    logger.error('Failed to get timeline', { error: result.error });
    return [];
  }
  return result.data.feed;
}
