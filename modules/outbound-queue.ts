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
    //NOTE(self): Step 1: Dedup check (before mutex — fast reject)
    const normalized = this.normalizeText(text);
    const dedupResult = this.checkDedup(normalized);
    if (!dedupResult.allowed) {
      this.auditLog('rejected', destination, text, dedupResult.reason!);
      ui.queue('Blocked duplicate', dedupResult.reason);
      return dedupResult;
    }

    //NOTE(self): Step 2: Serialize via mutex — wait for any in-flight message
    let release: () => void;
    const prev = this.mutexPromise;
    this.mutexPromise = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await prev;
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

  //NOTE(self): Normalize text for dedup comparison
  //NOTE(self): Strips @mentions, lowercases, collapses whitespace, takes first 50 chars
  //NOTE(self): This catches "Working with @X — looking forward..." duplicates
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/@[\w.-]+/g, '') // strip @mentions
      .replace(/\s+/g, ' ')     // collapse whitespace
      .trim()
      .slice(0, 50);
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
