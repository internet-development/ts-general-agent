export interface AtprotoSession {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
}

export interface AtprotoProfile {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  followersCount: number;
  followsCount: number;
  postsCount: number;
}

export interface AtprotoPost {
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  record: {
    text: string;
    createdAt: string;
    reply?: {
      parent: { uri: string; cid: string };
      root: { uri: string; cid: string };
    };
  };
  replyCount: number;
  repostCount: number;
  likeCount: number;
  indexedAt: string;
}

export interface AtprotoFeedItem {
  post: AtprotoPost;
  reply?: {
    root: AtprotoPost;
    parent: AtprotoPost;
  };
  reason?: {
    $type: string;
    by: { did: string; handle: string };
    indexedAt: string;
  };
}

export interface AtprotoNotification {
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  reason: 'like' | 'repost' | 'follow' | 'mention' | 'reply' | 'quote';
  record: Record<string, unknown>;
  isRead: boolean;
  indexedAt: string;
}

export interface AtprotoFollower {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  indexedAt: string;
}

export type AtprotoResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
