import { getAuthHeaders, getSession } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';
import { logger } from '@modules/logger.js';

const BSKY_SERVICE = 'https://bsky.social';

//NOTE(self): Minimal thread view types - just what we need for reply resolution
export interface ThreadPost {
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
  };
  record: {
    text: string;
    createdAt: string;
    reply?: {
      parent: { uri: string; cid: string };
      root: { uri: string; cid: string };
    };
  };
}

export interface ThreadViewPost {
  $type: 'app.bsky.feed.defs#threadViewPost';
  post: ThreadPost;
  parent?: ThreadViewPost | { $type: 'app.bsky.feed.defs#notFoundPost' } | { $type: 'app.bsky.feed.defs#blockedPost' };
  replies?: Array<ThreadViewPost | { $type: 'app.bsky.feed.defs#notFoundPost' } | { $type: 'app.bsky.feed.defs#blockedPost' }>;
}

export interface GetPostThreadResponse {
  thread: ThreadViewPost;
}

//NOTE(self): Reply reference structure for creating replies
export interface ReplyRefs {
  parent: { uri: string; cid: string };
  root: { uri: string; cid: string };
}

/**
 * Fetch a post's thread to get full context including the thread root.
 * Used for building proper reply references.
 */
export async function getPostThread(
  uri: string,
  depth: number = 0, //NOTE(self): We only need the post itself and its parent chain
  parentHeight: number = 100 //NOTE(self): Get full parent chain to find root
): Promise<AtprotoResult<GetPostThreadResponse>> {
  const session = getSession();
  const headers = session ? getAuthHeaders() : { 'Content-Type': 'application/json' };

  try {
    const searchParams = new URLSearchParams();
    searchParams.set('uri', uri);
    searchParams.set('depth', String(depth));
    searchParams.set('parentHeight', String(parentHeight));

    const url = `${BSKY_SERVICE}/xrpc/app.bsky.feed.getPostThread?${searchParams}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to get post thread' };
    }

    const data = await response.json();
    return { success: true, data: { thread: data.thread } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Build reply references for a given parent post.
 *
 * This helper resolves the proper thread root:
 * - If rootUri/rootCid are provided, uses those directly
 * - Otherwise, fetches the parent post's thread to find the true root
 * - Falls back to treating the parent as root (safe for direct replies to top-level posts)
 *
 * @param parentUri - AT URI of the post being replied to
 * @param parentCid - CID of the post being replied to
 * @param rootUri - Optional: AT URI of the thread root (if already known)
 * @param rootCid - Optional: CID of the thread root (if already known)
 * @returns ReplyRefs with properly resolved parent and root references
 */
export async function getReplyRefs(
  parentUri: string,
  parentCid: string,
  rootUri?: string,
  rootCid?: string
): Promise<AtprotoResult<ReplyRefs>> {
  //NOTE(self): Validate required parameters
  if (!parentUri || !parentCid) {
    return {
      success: false,
      error: 'Missing required parameters: parentUri and parentCid are required'
    };
  }

  //NOTE(self): Validate URI format
  if (!parentUri.startsWith('at://')) {
    return {
      success: false,
      error: `Invalid parent URI format: expected "at://..." but got "${parentUri.slice(0, 20)}..."`
    };
  }

  //NOTE(self): If root is fully provided, use it directly
  if (rootUri && rootCid) {
    //NOTE(self): Validate root URI format too
    if (!rootUri.startsWith('at://')) {
      return {
        success: false,
        error: `Invalid root URI format: expected "at://..." but got "${rootUri.slice(0, 20)}..."`
      };
    }

    return {
      success: true,
      data: {
        parent: { uri: parentUri, cid: parentCid },
        root: { uri: rootUri, cid: rootCid },
      },
    };
  }

  //NOTE(self): Fetch parent post thread to find the true root
  const threadResult = await getPostThread(parentUri);

  if (!threadResult.success) {
    //NOTE(self): If we can't fetch the thread, fall back to parent=root
    //NOTE(self): This is safe for top-level replies and better than failing
    return {
      success: true,
      data: {
        parent: { uri: parentUri, cid: parentCid },
        root: { uri: parentUri, cid: parentCid },
      },
    };
  }

  const thread = threadResult.data.thread;

  //NOTE(self): Check if the parent post itself has a reply reference (meaning it's a reply)
  if (thread.post.record.reply?.root) {
    //NOTE(self): The parent is a reply, so use its root as our root
    return {
      success: true,
      data: {
        parent: { uri: parentUri, cid: parentCid },
        root: thread.post.record.reply.root,
      },
    };
  }

  //NOTE(self): The parent has no reply reference, so it IS the thread root
  return {
    success: true,
    data: {
      parent: { uri: parentUri, cid: parentCid },
      root: { uri: thread.post.uri, cid: thread.post.cid },
    },
  };
}

//NOTE(self): Check thread API to see if we've already replied - single source of truth
//NOTE(self): No local tracking needed - the API IS the truth
export async function hasAgentRepliedInThread(postUri: string): Promise<boolean> {
  const session = getSession();
  if (!session) {
    //NOTE(self): No session means we can't check - fail OPEN (allow reply attempt)
    logger.debug('No session for hasAgentRepliedInThread check', { postUri });
    return false;
  }

  const agentDid = session.did;

  try {
    //NOTE(self): Fetch thread with depth=1 (direct replies only) to minimize API cost
    const threadResult = await getPostThread(postUri, 1, 0);

    if (!threadResult.success) {
      //NOTE(self): Fail OPEN - better to attempt a reply than block all replies
      //NOTE(self): Bluesky will reject true duplicates anyway
      logger.debug('Failed to fetch thread for reply check, failing open', {
        postUri,
        error: threadResult.error,
      });
      return false;
    }

    const thread = threadResult.data.thread;

    //NOTE(self): Check if any direct reply is from the agent
    if (thread.replies && Array.isArray(thread.replies)) {
      for (const reply of thread.replies) {
        //NOTE(self): Skip blocked/notfound posts
        if (reply.$type !== 'app.bsky.feed.defs#threadViewPost') {
          continue;
        }

        const replyPost = reply as ThreadViewPost;
        if (replyPost.post.author.did === agentDid) {
          logger.debug('Agent has already replied in thread', {
            postUri,
            agentReplyUri: replyPost.post.uri,
          });
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    //NOTE(self): Fail OPEN on any error
    logger.debug('Error checking thread for agent reply, failing open', {
      postUri,
      error: String(error),
    });
    return false;
  }
}
