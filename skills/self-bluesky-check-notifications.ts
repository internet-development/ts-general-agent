import * as atproto from '@adapters/atproto/index.js';
import { logger } from '@modules/logger.js';

export async function checkNotifications(limit = 20): Promise<atproto.AtprotoNotification[]> {
  const result = await atproto.getNotifications({ limit });
  if (!result.success) {
    logger.error('Failed to get notifications', { error: result.error });
    return [];
  }
  return result.data.notifications;
}
