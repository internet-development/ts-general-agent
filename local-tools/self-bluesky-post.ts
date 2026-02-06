import * as atproto from '@adapters/atproto/index.js';
import { logger } from '@modules/logger.js';

export async function post(text: string): Promise<string | null> {
  const result = await atproto.createPost({ text });
  if (!result.success) {
    logger.error('Failed to post', { error: result.error });
    return null;
  }
  logger.info('Posted', { uri: result.data.uri });
  return result.data.uri;
}
