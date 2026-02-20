//NOTE(self): Outbound Queue Module
//NOTE(self): Central gatekeeper for all outbound Bluesky posts.
//NOTE(self): Serializes sending (one at a time via mutex), enforces pacing cooldowns,
//NOTE(self): and rejects near-duplicate text via two dedup layers:
//NOTE(self):   1. recentPosts — time-windowed ring buffer for rapid-fire dedup (5-min window)
//NOTE(self):   2. feedTexts — content set populated from the agent's own feed on startup,
//NOTE(self):      catches cross-restart duplicates regardless of how long the agent was down
//NOTE(self): Callers await enqueue() and get back { allowed: true } or { allowed: false, reason }.

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/logger.js';
import { pacing } from '@modules/pacing.js';
import { ui } from '@modules/ui.js';
import { OUTBOUND_DEDUP_WINDOW_MS, OUTBOUND_DEDUP_BUFFER_SIZE } from '@common/config.js';
import { normalizePostText } from '@common/strings.js';
import { deletePost } from '@adapters/atproto/delete-post.js';
import { isLowValueClosing } from '@modules/engagement.js';
import type { AtprotoFeedItem } from '@adapters/atproto/types.js';

const AUDIT_LOG_FILE = '.memory/logs/outbound-queue.log';
const DEDUP_STATE_FILE = '.memory/outbound_dedup.json';

export type OutboundDestination = 'post' | 'reply' | 'post_with_image';

export interface OutboundResult {
  allowed: boolean;
  reason?: string;
}

interface RecentEntry {
  normalized: string;
  timestamp: number;
}

//NOTE(self): Load persisted dedup entries from disk (prunes expired entries on load)
function loadDedupState(): RecentEntry[] {
  try {
    if (!fs.existsSync(DEDUP_STATE_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(DEDUP_STATE_FILE, 'utf8'));
    if (!Array.isArray(data)) return [];
    const cutoff = Date.now() - OUTBOUND_DEDUP_WINDOW_MS;
    const valid = data.filter(
      (e: any) => typeof e.normalized === 'string' && typeof e.timestamp === 'number' && e.timestamp > cutoff
    );
    if (valid.length > 0) {
      logger.info('Loaded outbound dedup state from disk', { count: valid.length });
    }
    return valid;
  } catch (err) {
    logger.warn('Failed to load outbound dedup state', { error: String(err) });
    return [];
  }
}

//NOTE(self): Persist dedup entries to disk
function saveDedupState(entries: RecentEntry[]): void {
  try {
    const dir = path.dirname(DEDUP_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DEDUP_STATE_FILE, JSON.stringify(entries));
  } catch (err) {
    logger.warn('Failed to save outbound dedup state', { error: String(err) });
  }
}

class OutboundQueue {
  private recentPosts: RecentEntry[];
  //NOTE(self): Content-based dedup set — populated from the agent's own feed on startup
  //NOTE(self): Does NOT expire — persists for the entire session, catches cross-restart duplicates
  //NOTE(self): New posts are added here too so they're protected for the full session
  private feedTexts: Set<string> = new Set();
  //NOTE(self): Promise-based mutex — only one message processes at a time
  private mutexPromise: Promise<void> = Promise.resolve();

  constructor() {
    //NOTE(self): Load persisted dedup state — survives rapid restarts (within 5-min window)
    this.recentPosts = loadDedupState();
  }

  //NOTE(self): Warm up dedup from the agent's own Bluesky feed on startup
  //NOTE(self): This is the cross-restart dedup layer — the feed IS the source of truth
  //NOTE(self): Called once during scheduler startup with the agent's own feed
  warmupFromFeed(feedItems: AtprotoFeedItem[]): void {
    const ownPosts = feedItems.filter((item) => !item.reason);
    let loaded = 0;
    for (const item of ownPosts) {
      const text = item.post.record.text;
      if (!text) continue;
      const normalized = normalizePostText(text);
      if (!normalized) continue;
      this.feedTexts.add(normalized);
      loaded++;
    }
    if (loaded > 0) {
      logger.info('Outbound queue warmed from feed', { loaded, feedItems: ownPosts.length });
    }
  }

  //NOTE(self): Main entry point — callers await this before posting
  async enqueue(destination: OutboundDestination, text: string): Promise<OutboundResult> {
    const normalized = normalizePostText(text);

    //NOTE(self): Step 1: Serialize via mutex — all checks happen inside to prevent TOCTOU races
    //NOTE(self): Two concurrent enqueue() calls must not both pass the dedup check before either records
    let release: () => void;
    const prev = this.mutexPromise;
    this.mutexPromise = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await prev;

      //NOTE(self): Step 2: Dedup check (inside mutex — prevents race condition)
      const dedupResult = this.checkDedup(normalized);
      if (!dedupResult.allowed) {
        this.auditLog('rejected', destination, text, dedupResult.reason!);
        ui.queue('Blocked duplicate', dedupResult.reason);
        return dedupResult;
      }

      ui.queue('Queued', `${destination}: ${text.slice(0, 60)}…`);

      //NOTE(self): Step 3: Pacing — respect cooldowns
      const pacingType = destination === 'reply' ? 'reply' : 'post';
      await pacing.waitForCooldown(pacingType);
      pacing.recordAction(pacingType, text.slice(0, 80));

      //NOTE(self): Step 4: Record in dedup buffer and persist
      this.recordPost(normalized);

      //NOTE(self): Step 5: Audit log
      this.auditLog('allowed', destination, text);
      ui.queue('Sending', `${destination}`);

      return { allowed: true };
    } finally {
      //NOTE(self): Step 6: Release mutex for next message
      release!();
    }
  }

  //NOTE(self): Check both dedup layers: time-windowed (rapid-fire) and feed-based (cross-restart)
  private checkDedup(normalized: string): OutboundResult {
    const now = Date.now();
    const cutoff = now - OUTBOUND_DEDUP_WINDOW_MS;

    //NOTE(self): Layer 1: Time-windowed ring buffer (rapid-fire guard)
    this.recentPosts = this.recentPosts.filter((e) => e.timestamp > cutoff);
    const recentDup = this.recentPosts.find((e) => e.normalized === normalized);
    if (recentDup) {
      const agoSeconds = Math.round((now - recentDup.timestamp) / 1000);
      return {
        allowed: false,
        reason: `Near-duplicate of post sent ${agoSeconds}s ago`,
      };
    }

    //NOTE(self): Layer 2: Feed-based content set (cross-restart guard)
    //NOTE(self): Populated from the agent's own Bluesky feed on startup — doesn't expire
    if (this.feedTexts.has(normalized)) {
      return {
        allowed: false,
        reason: 'Duplicate of post already in feed (cross-restart dedup)',
      };
    }

    return { allowed: true };
  }

  //NOTE(self): Record a post in both dedup layers
  private recordPost(normalized: string): void {
    //NOTE(self): Layer 1: Time-windowed ring buffer
    this.recentPosts.push({ normalized, timestamp: Date.now() });
    if (this.recentPosts.length > OUTBOUND_DEDUP_BUFFER_SIZE) {
      this.recentPosts = this.recentPosts.slice(-OUTBOUND_DEDUP_BUFFER_SIZE);
    }
    saveDedupState(this.recentPosts);

    //NOTE(self): Layer 2: Feed content set — survives for the entire session
    this.feedTexts.add(normalized);
  }

  //NOTE(self): Append JSONL audit entry (follows commitment-queue pattern)
  private auditLog(action: string, destination: string, text: string, reason?: string): void {
    try {
      const logDir = path.dirname(AUDIT_LOG_FILE);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        action,
        destination,
        text: text.slice(0, 120),
        ...(reason ? { reason } : {}),
      }) + '\n';
      fs.appendFileSync(AUDIT_LOG_FILE, entry);
    } catch (err) {
      logger.warn('Failed to write outbound queue audit log', { error: String(err) });
    }
  }
}

//NOTE(self): Singleton export
export const outboundQueue = new OutboundQueue();

//NOTE(self): Scan a feed for near-duplicate posts and delete copies
//NOTE(self): Keeps the oldest post per group, deletes newer dupes
//NOTE(self): For top-level posts: groups by normalized text alone
//NOTE(self): For replies: groups by normalized text + thread root URI (same text in same thread = dupe)
//NOTE(self): Reposts (reason field) are always excluded — those aren't authored by us
//NOTE(self): Runs from the engagement check loop to self-heal dupes that slipped past the outbound queue
export async function pruneDuplicatePosts(feed: AtprotoFeedItem[]): Promise<number> {
  //NOTE(self): Exclude reposts only — include both top-level posts AND replies
  const ownPosts = feed.filter((item) => !item.reason);

  //NOTE(self): Group by normalized text, scoped appropriately:
  //NOTE(self): Top-level posts share a common scope key (duplicates regardless of URI)
  //NOTE(self): Replies are scoped to their thread root (only duplicates within the same thread)
  const groups = new Map<string, AtprotoFeedItem[]>();
  for (const item of ownPosts) {
    const text = item.post.record.text;
    if (!text) continue;
    const normalized = normalizePostText(text);
    if (!normalized) continue;

    const isReply = !!item.reply;
    const scopeKey = isReply ? item.reply!.root.uri : '__top_level__';
    const groupKey = `${normalized}|${scopeKey}`;

    const group = groups.get(groupKey) || [];
    group.push(item);
    groups.set(groupKey, group);
  }

  let deleted = 0;

  for (const [groupKey, group] of groups) {
    if (group.length < 2) continue;

    logger.info('Found duplicate group', {
      count: group.length,
      text: group[0].post.record.text.slice(0, 80),
      isReply: !!group[0].reply,
    });

    //NOTE(self): Sort by createdAt ascending — keep the oldest
    group.sort((a, b) =>
      new Date(a.post.record.createdAt).getTime() - new Date(b.post.record.createdAt).getTime()
    );

    //NOTE(self): Delete ALL newer copies — a duplicate is a duplicate regardless of engagement
    //NOTE(self): 4 identical posts on the feed is worse than losing a few likes on copies
    for (let i = 1; i < group.length; i++) {
      const post = group[i].post;
      const engagement = (post.likeCount || 0) + (post.replyCount || 0) + (post.repostCount || 0);

      const result = await deletePost(post.uri);
      if (result.success) {
        deleted++;
        const engagementNote = engagement > 0
          ? `had ${post.likeCount || 0} likes, ${post.replyCount || 0} replies, ${post.repostCount || 0} reposts`
          : '0 engagement';
        auditLog('pruned', 'duplicate', post.record.text, `kept oldest copy — deleted dupe (${engagementNote})`);
        ui.queue('Pruned duplicate', post.record.text.slice(0, 60));
        logger.info('Pruned duplicate post', {
          uri: post.uri,
          text: post.record.text.slice(0, 60),
          engagement,
        });
      } else {
        logger.warn('Failed to prune duplicate post', { uri: post.uri, error: result.error });
      }
    }
  }

  return deleted;
}

//NOTE(self): Prune thank-you chains — threads where the agent posted multiple low-value closings
//NOTE(self): Uses isLowValueClosing() (same heuristic that prevents sending them) to detect them retroactively
//NOTE(self): Keeps the first closing per thread, deletes subsequent ones — you only say goodbye once
export async function pruneThankYouChains(feed: AtprotoFeedItem[]): Promise<number> {
  //NOTE(self): Only look at our own replies (not top-level posts, not reposts)
  const ownReplies = feed.filter((item) => !!item.reply && !item.reason);

  //NOTE(self): Group by thread root URI
  const threadGroups = new Map<string, AtprotoFeedItem[]>();
  for (const item of ownReplies) {
    const rootUri = item.reply!.root.uri;
    const group = threadGroups.get(rootUri) || [];
    group.push(item);
    threadGroups.set(rootUri, group);
  }

  let deleted = 0;

  for (const [rootUri, replies] of threadGroups) {
    //NOTE(self): Sort by createdAt ascending
    replies.sort((a, b) =>
      new Date(a.post.record.createdAt).getTime() - new Date(b.post.record.createdAt).getTime()
    );

    //NOTE(self): Find which of our replies are low-value closings
    const closings = replies.filter((item) => {
      const text = item.post.record.text;
      return text && isLowValueClosing(text);
    });

    //NOTE(self): If 2+ closings in the same thread, keep the first and delete the rest
    if (closings.length < 2) continue;

    logger.info('Found thank-you chain', {
      threadRoot: rootUri,
      closingCount: closings.length,
      texts: closings.map((c) => c.post.record.text.slice(0, 50)),
    });

    //NOTE(self): Skip index 0 (keep the first closing), delete the rest
    for (let i = 1; i < closings.length; i++) {
      const post = closings[i].post;
      const result = await deletePost(post.uri);
      if (result.success) {
        deleted++;
        auditLog('pruned', 'thank-you-chain', post.record.text, 'kept first closing, deleted follow-up');
        ui.queue('Pruned closing', post.record.text.slice(0, 60));
        logger.info('Pruned excess closing reply', {
          uri: post.uri,
          text: post.record.text.slice(0, 60),
        });
      } else {
        logger.warn('Failed to prune closing reply', { uri: post.uri, error: result.error });
      }
    }
  }

  return deleted;
}

//NOTE(self): Standalone audit logger for use outside the class (shared with pruneDuplicatePosts)
function auditLog(action: string, destination: string, text: string, reason?: string): void {
  try {
    const logDir = path.dirname(AUDIT_LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      action,
      destination,
      text: text.slice(0, 120),
      ...(reason ? { reason } : {}),
    }) + '\n';
    fs.appendFileSync(AUDIT_LOG_FILE, entry);
  } catch (err) {
    logger.warn('Failed to write outbound queue audit log', { error: String(err) });
  }
}
