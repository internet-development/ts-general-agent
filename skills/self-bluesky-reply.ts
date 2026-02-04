import * as atproto from '@adapters/atproto/index.js';
import { logger } from '@modules/logger.js';

export async function replyToPost(
  postUri: string,
  postCid: string,
  text: string,
  rootUri?: string,
  rootCid?: string
): Promise<boolean> {
  const result = await atproto.createPost({
    text,
    replyTo: {
      uri: postUri,
      cid: postCid,
      rootUri,
      rootCid,
    },
  });

  if (!result.success) {
    logger.error('Failed to reply', { error: result.error });
    return false;
  }

  logger.info('Reply posted', { uri: result.data.uri });
  return true;
}
