/**
 * Post Log Module
 *
 * //NOTE(self): Persistent logging of posts so I can remember why I shared things.
 * //NOTE(self): When someone asks "why did you pick this?", I can give a specific, accurate answer.
 * //NOTE(self): Context is precious - don't lose it after posting.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/logger.js';

const POST_LOG_PATH = '.memory/post_log.jsonl';

/**
 * A single logged post entry - everything I need to remember about what I shared
 */
export interface PostLogEntry {
  // When it happened
  timestamp: string;

  // What I posted on Bluesky
  bluesky: {
    post_uri: string;
    post_cid: string;
    bsky_url: string;
  };

  // Where the content came from
  source: {
    type: 'arena' | 'url' | 'generated' | 'other';
    channel_url?: string;       // For Are.na: full channel URL
    block_id?: number;          // For Are.na: specific block ID
    block_title?: string;       // Title of the block/image
    original_url?: string;      // Original source URL (artist's site, etc.)
    image_url?: string;         // Direct image URL that was downloaded
  };

  // What I said about it
  content: {
    post_text: string;          // The text I posted
    alt_text?: string;          // Alt text for the image
    image_dimensions?: {
      width: number;
      height: number;
    };
  };

  // Why I picked it (if I have a reason)
  why_picked?: string;

  // Context for replies
  reply_context?: {
    parent_uri: string;
    parent_cid: string;
    root_uri?: string;
    root_cid?: string;
  };
}

/**
 * Ensure the memory directory exists
 */
function ensureLogDir(): boolean {
  try {
    const dir = path.dirname(POST_LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch (err) {
    logger.warn('Failed to create post log directory', { error: String(err) });
    return false;
  }
}

/**
 * Append a new post entry to the log
 * Uses JSONL format (one JSON object per line) for easy appending and reading
 */
export function logPost(entry: PostLogEntry): boolean {
  try {
    ensureLogDir();
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(POST_LOG_PATH, line, 'utf8');
    logger.debug('Logged post to post_log.jsonl', {
      bsky_url: entry.bluesky.bsky_url,
      source_type: entry.source.type,
    });
    return true;
  } catch (err) {
    //NOTE(self): Graceful degradation - don't crash if logging fails
    logger.warn('Failed to log post', { error: String(err) });
    return false;
  }
}

/**
 * Look up a post by its Bluesky URI
 * Returns the full context if found, null if not
 */
export function lookupPostByUri(post_uri: string): PostLogEntry | null {
  try {
    if (!fs.existsSync(POST_LOG_PATH)) {
      return null;
    }

    const content = fs.readFileSync(POST_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    //NOTE(self): Search from newest to oldest (most likely to find recent posts)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as PostLogEntry;
        if (entry.bluesky.post_uri === post_uri) {
          return entry;
        }
      } catch {
        //NOTE(self): Skip malformed lines, don't crash
        continue;
      }
    }

    return null;
  } catch (err) {
    logger.warn('Failed to read post log', { error: String(err) });
    return null;
  }
}

/**
 * Look up a post by its bsky.app URL
 * Convenience method since we often have the public URL, not the AT URI
 */
export function lookupPostByBskyUrl(bsky_url: string): PostLogEntry | null {
  try {
    if (!fs.existsSync(POST_LOG_PATH)) {
      return null;
    }

    const content = fs.readFileSync(POST_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as PostLogEntry;
        if (entry.bluesky.bsky_url === bsky_url) {
          return entry;
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch (err) {
    logger.warn('Failed to read post log', { error: String(err) });
    return null;
  }
}

/**
 * Look up a post by Are.na block ID
 * Useful for checking if we've posted a specific block before
 */
export function lookupPostByBlockId(block_id: number): PostLogEntry | null {
  try {
    if (!fs.existsSync(POST_LOG_PATH)) {
      return null;
    }

    const content = fs.readFileSync(POST_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as PostLogEntry;
        if (entry.source.block_id === block_id) {
          return entry;
        }
      } catch {
        continue;
      }
    }

    return null;
  } catch (err) {
    logger.warn('Failed to read post log', { error: String(err) });
    return null;
  }
}

/**
 * Get recent posts (newest first)
 * Useful for generating context about recent activity
 */
export function getRecentPosts(limit: number = 10): PostLogEntry[] {
  try {
    if (!fs.existsSync(POST_LOG_PATH)) {
      return [];
    }

    const content = fs.readFileSync(POST_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    const posts: PostLogEntry[] = [];
    //NOTE(self): Read from end (newest) to beginning
    for (let i = lines.length - 1; i >= 0 && posts.length < limit; i--) {
      try {
        const entry = JSON.parse(lines[i]) as PostLogEntry;
        posts.push(entry);
      } catch {
        continue;
      }
    }

    return posts;
  } catch (err) {
    logger.warn('Failed to read recent posts', { error: String(err) });
    return [];
  }
}

/**
 * Generate a human-readable summary of a post for use in replies
 * This is what I'll use when someone asks "why did you pick this?"
 */
export function generatePostContext(entry: PostLogEntry): string {
  const parts: string[] = [];

  // Source context
  if (entry.source.type === 'arena') {
    parts.push(`This image came from Are.na${entry.source.channel_url ? ` (${entry.source.channel_url})` : ''}.`);
    if (entry.source.block_title) {
      parts.push(`It was titled "${entry.source.block_title}".`);
    }
    if (entry.source.original_url) {
      parts.push(`Original source: ${entry.source.original_url}`);
    }
  } else if (entry.source.type === 'url' && entry.source.original_url) {
    parts.push(`This image came from ${entry.source.original_url}.`);
  }

  // Why I picked it
  if (entry.why_picked) {
    parts.push(`I picked it because: ${entry.why_picked}`);
  }

  // Alt text gives visual context
  if (entry.content.alt_text) {
    parts.push(`Visual description: ${entry.content.alt_text}`);
  }

  // Timing context
  const postedDate = new Date(entry.timestamp);
  const now = new Date();
  const hoursSince = Math.round((now.getTime() - postedDate.getTime()) / (1000 * 60 * 60));

  if (hoursSince < 1) {
    parts.push('(Posted just now)');
  } else if (hoursSince < 24) {
    parts.push(`(Posted ${hoursSince} hour${hoursSince === 1 ? '' : 's'} ago)`);
  } else {
    const daysSince = Math.round(hoursSince / 24);
    parts.push(`(Posted ${daysSince} day${daysSince === 1 ? '' : 's'} ago)`);
  }

  return parts.join(' ');
}

/**
 * Get the total number of logged posts
 * Useful for stats and understanding posting history
 */
export function getPostCount(): number {
  try {
    if (!fs.existsSync(POST_LOG_PATH)) {
      return 0;
    }

    const content = fs.readFileSync(POST_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    let count = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
        count++;
      } catch {
        //NOTE(self): Skip malformed lines
      }
    }

    return count;
  } catch {
    return 0;
  }
}
