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

//NOTE(self): Fetch a post's thread to get full context including the thread root
//NOTE(self): Used for building proper reply references
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

//NOTE(self): Build reply references for a given parent post
//NOTE(self): This helper resolves the proper thread root:
//NOTE(self): - If rootUri/rootCid are provided, uses those directly
//NOTE(self): - Otherwise, fetches the parent post's thread to find the true root
//NOTE(self): - Falls back to treating the parent as root (safe for direct replies to top-level posts)
//NOTE(self): @param parentUri - AT URI of the post being replied to
//NOTE(self): @param parentCid - CID of the post being replied to
//NOTE(self): @param rootUri - Optional: AT URI of the thread root (if already known)
//NOTE(self): @param rootCid - Optional: CID of the thread root (if already known)
//NOTE(self): @returns ReplyRefs with properly resolved parent and root references
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

//NOTE(self): Analyze a thread to help SOUL decide whether to continue engaging
export interface ThreadAnalysis {
  depth: number;                    //NOTE(self): How deep in the thread this reply is
  agentReplyCount: number;          //NOTE(self): How many times agent has replied in this thread
  totalReplies: number;             //NOTE(self): Total replies in the thread
  lastAgentReplyDepth: number | null; //NOTE(self): Depth of agent's last reply (null if never replied)
  isAgentLastReply: boolean;        //NOTE(self): Is the agent's reply the most recent?
  threadParticipants: string[];     //NOTE(self): Unique participants in the thread
  conversationHistory: string;      //NOTE(self): Formatted thread history for LLM context
}

//NOTE(self): Analyze a thread for conversation management
//NOTE(self): Helps SOUL decide whether to continue engaging or gracefully exit
export async function analyzeThread(
  postUri: string,
  agentDid: string
): Promise<AtprotoResult<ThreadAnalysis>> {
  try {
    //NOTE(self): Fetch thread with full depth to get complete picture
    const threadResult = await getPostThread(postUri, 100, 100);

    if (!threadResult.success) {
      return { success: false, error: threadResult.error };
    }

    const thread = threadResult.data.thread;

    //NOTE(self): Walk up the parent chain to find depth and build history
    let depth = 0;
    let agentReplyCount = 0;
    let lastAgentReplyDepth: number | null = null;
    const participants = new Set<string>();
    const historyParts: string[] = [];

    //NOTE(self): Build parent chain (oldest to newest)
    const parentChain: ThreadViewPost[] = [];
    let current: ThreadViewPost | undefined = thread;

    while (current) {
      parentChain.unshift(current);
      participants.add(current.post.author.handle);

      if (current.post.author.did === agentDid) {
        agentReplyCount++;
      }

      //NOTE(self): Move to parent
      if (current.parent && current.parent.$type === 'app.bsky.feed.defs#threadViewPost') {
        current = current.parent as ThreadViewPost;
      } else {
        current = undefined;
      }
    }

    depth = parentChain.length - 1; //NOTE(self): Root is depth 0

    //NOTE(self): Build conversation history
    for (let i = 0; i < parentChain.length; i++) {
      const post = parentChain[i];
      const isAgent = post.post.author.did === agentDid;
      const prefix = isAgent ? '**[YOU]**' : `@${post.post.author.handle}`;
      historyParts.push(`${prefix}: ${post.post.record.text}`);

      if (isAgent) {
        lastAgentReplyDepth = i;
      }
    }

    //NOTE(self): Check if agent's reply is the most recent
    const isAgentLastReply = parentChain.length > 0 &&
      parentChain[parentChain.length - 1].post.author.did === agentDid;

    //NOTE(self): Count total replies in thread (including nested)
    let totalReplies = parentChain.length - 1; //NOTE(self): Exclude root
    function countReplies(node: ThreadViewPost): void {
      if (node.replies) {
        for (const reply of node.replies) {
          if (reply.$type === 'app.bsky.feed.defs#threadViewPost') {
            totalReplies++;
            countReplies(reply as ThreadViewPost);
          }
        }
      }
    }
    if (parentChain.length > 0) {
      countReplies(parentChain[0]);
    }

    return {
      success: true,
      data: {
        depth,
        agentReplyCount,
        totalReplies,
        lastAgentReplyDepth,
        isAgentLastReply,
        threadParticipants: Array.from(participants),
        conversationHistory: historyParts.join('\n\n'),
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
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
