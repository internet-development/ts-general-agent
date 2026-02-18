//NOTE(self): Outbound Queue Module
//NOTE(self): Central gatekeeper for all outbound Bluesky posts.
//NOTE(self): Serializes sending (one at a time via mutex), enforces pacing cooldowns,
//NOTE(self): and rejects near-duplicate text within a 5-minute window.
//NOTE(self): Callers await enqueue() and get back { allowed: true } or { allowed: false, reason }.

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/logger.js';
import { pacing } from '@modules/pacing.js';
import { ui } from '@modules/ui.js';
import { OUTBOUND_DEDUP_WINDOW_MS, OUTBOUND_DEDUP_BUFFER_SIZE } from '@common/config.js';
import { normalizePostText } from '@common/strings.js';
import { deletePost } from '@adapters/atproto/delete-post.js';
import type { AtprotoFeedItem } from '@adapters/atproto/types.js';

const AUDIT_LOG_FILE = '.memory/logs/outbound-queue.log';

export type OutboundDestination = 'post' | 'reply' | 'post_with_image';

export interface OutboundResult {
  allowed: boolean;
  reason?: string;
}

interface RecentEntry {
  normalized: string;
  timestamp: number;
}

class OutboundQueue {
  private recentPosts: RecentEntry[] = [];
  //NOTE(self): Promise-based mutex — only one message processes at a time
  private mutexPromise: Promise<void> = Promise.resolve();

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

      //NOTE(self): Step 4: Record in dedup buffer
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

  //NOTE(self): Check if normalized text matches any recent post within the dedup window
  private checkDedup(normalized: string): OutboundResult {
    const now = Date.now();
    const cutoff = now - OUTBOUND_DEDUP_WINDOW_MS;

    //NOTE(self): Prune expired entries
    this.recentPosts = this.recentPosts.filter((e) => e.timestamp > cutoff);

    const duplicate = this.recentPosts.find((e) => e.normalized === normalized);
    if (duplicate) {
      const agoSeconds = Math.round((now - duplicate.timestamp) / 1000);
      return {
        allowed: false,
        reason: `Near-duplicate of post sent ${agoSeconds}s ago`,
      };
    }

    return { allowed: true };
  }

  //NOTE(self): Record a post in the ring buffer
  private recordPost(normalized: string): void {
    this.recentPosts.push({ normalized, timestamp: Date.now() });

    //NOTE(self): Enforce ring buffer size
    if (this.recentPosts.length > OUTBOUND_DEDUP_BUFFER_SIZE) {
      this.recentPosts = this.recentPosts.slice(-OUTBOUND_DEDUP_BUFFER_SIZE);
    }
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

//NOTE(self): Scan a feed for near-duplicate posts and delete zero-engagement copies
//NOTE(self): Keeps the oldest post per normalized-text group, deletes newer dupes with no engagement
//NOTE(self): Runs from the engagement check loop to self-heal dupes that slipped past the in-memory buffer
export async function pruneDuplicatePosts(feed: AtprotoFeedItem[]): Promise<number> {
  //NOTE(self): Filter to top-level posts only (skip replies, reposts)
  const topLevelPosts = feed.filter((item) => !item.reply && !item.reason);

  //NOTE(self): Group by normalized text
  const groups = new Map<string, AtprotoFeedItem[]>();
  for (const item of topLevelPosts) {
    const text = item.post.record.text;
    if (!text) continue;
    const key = normalizePostText(text);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  let deleted = 0;

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    //NOTE(self): Sort by createdAt ascending — keep the oldest
    group.sort((a, b) =>
      new Date(a.post.record.createdAt).getTime() - new Date(b.post.record.createdAt).getTime()
    );

    //NOTE(self): Skip the oldest (index 0), check newer dupes for zero engagement
    for (let i = 1; i < group.length; i++) {
      const post = group[i].post;
      const engagement = (post.likeCount || 0) + (post.replyCount || 0) + (post.repostCount || 0);
      if (engagement > 0) continue;

      const result = await deletePost(post.uri);
      if (result.success) {
        deleted++;
        auditLog('pruned', 'duplicate', post.record.text, `kept older post, this had 0 engagement`);
        ui.queue('Pruned duplicate', post.record.text.slice(0, 60));
        logger.info('Pruned duplicate post', { uri: post.uri, text: post.record.text.slice(0, 60) });
      } else {
        logger.warn('Failed to prune duplicate post', { uri: post.uri, error: result.error });
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
