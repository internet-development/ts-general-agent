import * as atproto from '@adapters/atproto/index.js';
import { logger } from '@modules/logger.js';

export interface EngagementTarget {
  did: string;
  handle: string;
  reason: string;
}

export async function checkTimeline(limit = 20): Promise<atproto.AtprotoFeedItem[]> {
  const result = await atproto.getTimeline({ limit });
  if (!result.success) {
    logger.error('Failed to get timeline', { error: result.error });
    return [];
  }
  return result.data.feed;
}

export async function checkNotifications(limit = 20): Promise<atproto.AtprotoNotification[]> {
  const result = await atproto.getNotifications({ limit });
  if (!result.success) {
    logger.error('Failed to get notifications', { error: result.error });
    return [];
  }
  return result.data.notifications;
}

export async function getOwnerFollows(ownerDid: string): Promise<atproto.AtprotoFollower[]> {
  const result = await atproto.getFollows({ actor: ownerDid, limit: 100 });
  if (!result.success) {
    logger.error('Failed to get owner follows', { error: result.error });
    return [];
  }
  return result.data.follows;
}

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

export async function followPerson(did: string): Promise<boolean> {
  const result = await atproto.followUser({ did });
  if (!result.success) {
    logger.error('Failed to follow', { error: result.error });
    return false;
  }
  logger.info('Followed user', { did });
  return true;
}

export async function post(text: string): Promise<string | null> {
  const result = await atproto.createPost({ text });
  if (!result.success) {
    logger.error('Failed to post', { error: result.error });
    return null;
  }
  logger.info('Posted', { uri: result.data.uri });
  return result.data.uri;
}
