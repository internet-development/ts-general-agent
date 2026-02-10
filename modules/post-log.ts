//NOTE(self): Post Log Module
//NOTE(self): Persistent logging of posts so I can remember why I shared things.
//NOTE(self): When someone asks "why did you pick this?", I can give a specific, accurate answer.
//NOTE(self): Context is precious - don't lose it after posting.

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/logger.js';

const POST_LOG_PATH = '.memory/post_log.jsonl';

//NOTE(self): A single logged post entry - everything I need to remember about what I shared
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
  //NOTE(self): Enhanced source tracking for credit + traceability principle
  source: {
    type: 'arena' | 'searchsystem' | 'web' | 'url' | 'generated' | 'other';
    //NOTE(self): Web browsing fields (for web_browse_images sourced posts)
    page_url?: string;          // URL of the page that was browsed
    page_title?: string;        // Title of the browsed page
    channel_url?: string;       // For Are.na: full channel URL
    block_id?: number;          // For Are.na: specific block ID
    //NOTE(self): Direct link to the exact Are.na block for traceability
    block_url?: string;         // For Are.na: https://www.are.na/block/{id}
    block_title?: string;       // Title of the block/image
    //NOTE(self): Original filename from Are.na, often contains creator hints
    filename?: string;          // Original filename on Are.na filesystem
    original_url?: string;      // Original source URL (artist's site, etc.)
    //NOTE(self): Provider info helps trace content origins (e.g., "Dribbble", "Behance")
    source_provider?: string;   // Where the original was found (provider name)
    image_url?: string;         // Direct image URL that was downloaded
    //NOTE(self): Who added this to Are.na - useful for follow-up attribution
    arena_user?: {
      username: string;
      full_name?: string;
    };
    //NOTE(self): SearchSystem.co post fields
    post_id?: string;           // SearchSystem post ID (Tumblr post ID)
    post_url?: string;          // Full SearchSystem post URL
    tags?: string[];            // Post tags from SearchSystem
    //NOTE(self): Flag for posts where I couldn't find the original creator
    needs_attribution_followup?: boolean;
    //NOTE(self): Notes for future me when I circle back to find creators
    attribution_notes?: string;
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

//NOTE(self): Ensure the memory directory exists
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

//NOTE(self): Append a new post entry to the log
//NOTE(self): Uses JSONL format (one JSON object per line) for easy appending and reading
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

//NOTE(self): Look up a post by its Bluesky URI
//NOTE(self): Returns the full context if found, null if not
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

//NOTE(self): Look up a post by its bsky.app URL
//NOTE(self): Convenience method since we often have the public URL, not the AT URI
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

//NOTE(self): Look up a post by Are.na block ID
//NOTE(self): Useful for checking if we've posted a specific block before
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

//NOTE(self): Get recent posts (newest first)
//NOTE(self): Useful for generating context about recent activity
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

//NOTE(self): Generate a human-readable summary of a post for use in replies
//NOTE(self): This is what I'll use when someone asks "why did you pick this?"
export function generatePostContext(entry: PostLogEntry): string {
  const parts: string[] = [];

  // Source context
  if (entry.source.type === 'arena') {
    parts.push(`This image came from Are.na${entry.source.channel_url ? ` (${entry.source.channel_url})` : ''}.`);
    if (entry.source.block_title) {
      parts.push(`It was titled "${entry.source.block_title}".`);
    }
    //NOTE(self): Include exact block URL for clean traceability
    if (entry.source.block_url) {
      parts.push(`Exact block: ${entry.source.block_url}`);
    }
    //NOTE(self): Filename often contains creator hints
    if (entry.source.filename) {
      parts.push(`Original filename: ${entry.source.filename}`);
    }
    if (entry.source.original_url) {
      parts.push(`Original source: ${entry.source.original_url}`);
    }
    //NOTE(self): Provider helps trace origins
    if (entry.source.source_provider) {
      parts.push(`Found via: ${entry.source.source_provider}`);
    }
  } else if (entry.source.type === 'searchsystem') {
    parts.push(`This image came from SearchSystem.co${entry.source.post_url ? ` (${entry.source.post_url})` : ''}.`);
    if (entry.source.block_title) {
      parts.push(`It was titled "${entry.source.block_title}".`);
    }
    if (entry.source.tags && entry.source.tags.length > 0) {
      parts.push(`Tags: ${entry.source.tags.join(', ')}`);
    }
  } else if (entry.source.type === 'web') {
    parts.push(`This image came from${entry.source.page_title ? ` ${entry.source.page_title}` : ' a web page'}${entry.source.page_url ? ` (${entry.source.page_url})` : ''}.`);
    if (entry.source.image_url) {
      parts.push(`Image URL: ${entry.source.image_url}`);
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

//NOTE(self): Credit + traceability - format a clean source attribution for including in posts or replies
//NOTE(self): Returns a concise attribution string suitable for sharing publicly
export function formatSourceAttribution(entry: PostLogEntry): string {
  const parts: string[] = [];

  if (entry.source.type === 'arena') {
    //NOTE(self): Prefer original source if known (the actual creator)
    if (entry.source.original_url) {
      parts.push(`Source: ${entry.source.original_url}`);
    }
    //NOTE(self): Always include exact Are.na block for traceability
    if (entry.source.block_url) {
      if (entry.source.original_url) {
        parts.push(`via Are.na: ${entry.source.block_url}`);
      } else {
        parts.push(`Source: ${entry.source.block_url}`);
      }
    }
    //NOTE(self): Add filename if it might help identify creator
    if (entry.source.filename && !entry.source.original_url) {
      parts.push(`(${entry.source.filename})`);
    }
  } else if (entry.source.original_url) {
    parts.push(`Source: ${entry.source.original_url}`);
  }

  return parts.join(' ');
}

//NOTE(self): Credit + traceability - check if a post has complete attribution
//NOTE(self): A post has complete attribution if we know the original creator (not just Are.na block)
export function hasCompleteAttribution(entry: PostLogEntry): boolean {
  //NOTE(self): Complete attribution means we have the actual original source URL
  return !!entry.source.original_url;
}

//NOTE(self): Get the total number of logged posts
//NOTE(self): Useful for stats and understanding posting history
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

//NOTE(self): Credit + traceability - find posts where I still need to track down original creators
//NOTE(self): Returns posts flagged as needing attribution follow-up, oldest first
export function getPostsNeedingAttributionFollowup(limit: number = 20): PostLogEntry[] {
  try {
    if (!fs.existsSync(POST_LOG_PATH)) {
      return [];
    }

    const content = fs.readFileSync(POST_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    const needsFollowup: PostLogEntry[] = [];

    //NOTE(self): Read oldest first for follow-up (FIFO - handle oldest missing attributions first)
    for (const line of lines) {
      if (needsFollowup.length >= limit) break;
      try {
        const entry = JSON.parse(line) as PostLogEntry;
        if (entry.source.needs_attribution_followup) {
          needsFollowup.push(entry);
        }
      } catch {
        continue;
      }
    }

    return needsFollowup;
  } catch (err) {
    logger.warn('Failed to read posts needing attribution followup', { error: String(err) });
    return [];
  }
}

//NOTE(self): Credit + traceability - mark a post as needing follow-up to find original creator
//NOTE(self): Updates the post log entry in place (rewrites the entire log - use sparingly)
export function markPostNeedsAttributionFollowup(
  post_uri: string,
  needs_followup: boolean,
  notes?: string
): boolean {
  try {
    if (!fs.existsSync(POST_LOG_PATH)) {
      return false;
    }

    const content = fs.readFileSync(POST_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    let found = false;
    const updatedLines: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as PostLogEntry;
        if (entry.bluesky.post_uri === post_uri) {
          entry.source.needs_attribution_followup = needs_followup;
          if (notes !== undefined) {
            entry.source.attribution_notes = notes;
          }
          found = true;
          updatedLines.push(JSON.stringify(entry));
        } else {
          updatedLines.push(line);
        }
      } catch {
        //NOTE(self): Preserve malformed lines as-is
        updatedLines.push(line);
      }
    }

    if (found) {
      fs.writeFileSync(POST_LOG_PATH, updatedLines.join('\n') + '\n', 'utf8');
      logger.debug('Updated attribution followup flag', { post_uri, needs_followup });
    }

    return found;
  } catch (err) {
    logger.warn('Failed to update attribution followup', { error: String(err) });
    return false;
  }
}

//NOTE(self): Credit + traceability - update a post with found attribution info
//NOTE(self): Call this when I later discover who the original creator is
export function updatePostAttribution(
  post_uri: string,
  original_url: string,
  notes?: string
): boolean {
  try {
    if (!fs.existsSync(POST_LOG_PATH)) {
      return false;
    }

    const content = fs.readFileSync(POST_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    let found = false;
    const updatedLines: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as PostLogEntry;
        if (entry.bluesky.post_uri === post_uri) {
          entry.source.original_url = original_url;
          //NOTE(self): Clear the follow-up flag since we found the creator
          entry.source.needs_attribution_followup = false;
          if (notes !== undefined) {
            entry.source.attribution_notes = notes;
          }
          found = true;
          updatedLines.push(JSON.stringify(entry));
        } else {
          updatedLines.push(line);
        }
      } catch {
        updatedLines.push(line);
      }
    }

    if (found) {
      fs.writeFileSync(POST_LOG_PATH, updatedLines.join('\n') + '\n', 'utf8');
      logger.debug('Updated post attribution', { post_uri, original_url });
    }

    return found;
  } catch (err) {
    logger.warn('Failed to update post attribution', { error: String(err) });
    return false;
  }
}
