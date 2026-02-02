/**
 * Pacing Module
 *
 * //NOTE(self): Ensures the agent acts with dignity and deliberation.
 * //NOTE(self): Prevents spammy behavior and encourages thoughtful engagement.
 * //NOTE(self): Quality over quantity - one thoughtful interaction beats many shallow ones.
 */

import { ui } from '@modules/ui.js';
import { logger } from '@modules/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// RATE LIMITS
// ════════════════════════════════════════════════════════════════════════════

export interface RateLimits {
  // NOTE(self): Minimum seconds between posts
  postCooldown: number;
  // NOTE(self): Minimum seconds between likes
  likeCooldown: number;
  // NOTE(self): Minimum seconds between follows
  followCooldown: number;
  // NOTE(self): Minimum seconds between any action
  actionCooldown: number;
  // NOTE(self): Minimum seconds between autonomous ticks
  tickInterval: number;
  // NOTE(self): Maximum actions per tick
  maxActionsPerTick: number;
  // NOTE(self): Reflection pause (seconds) - time to pause and reflect
  reflectionPause: number;
}

// NOTE(self): Default limits encourage thoughtful, measured engagement
// NOTE(self): Fast enough for conversations, slow enough for dignity
const DEFAULT_LIMITS: RateLimits = {
  postCooldown: 120,       // 2 minutes between posts - posts should be meaningful
  likeCooldown: 15,        // 15 seconds between likes - don't spam likes
  followCooldown: 60,      // 1 minute between follows - following is intentional
  actionCooldown: 5,       // 5 seconds between any action - responsive but not frantic
  tickInterval: 15,        // 15 seconds between ticks - responsive to conversations
  maxActionsPerTick: 3,    // Max 3 actions per tick - focus on quality
  reflectionPause: 2,      // 2 second pause for reflection - think before acting
};

// ════════════════════════════════════════════════════════════════════════════
// ACTION TRACKING
// ════════════════════════════════════════════════════════════════════════════

interface ActionRecord {
  type: string;
  timestamp: number;
  detail?: string;
}

class PacingManager {
  private limits: RateLimits;
  private actionHistory: ActionRecord[] = [];
  private actionsThisTick = 0;
  private lastTickTime = 0;

  constructor(limits: RateLimits = DEFAULT_LIMITS) {
    this.limits = limits;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTE(self): Configuration
  // ═══════════════════════════════════════════════════════════════════════════

  setLimits(limits: Partial<RateLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  getLimits(): RateLimits {
    return { ...this.limits };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTE(self): Tick Management
  // ═══════════════════════════════════════════════════════════════════════════

  startTick(): void {
    this.actionsThisTick = 0;
    this.lastTickTime = Date.now();
  }

  getTickInterval(): number {
    return this.limits.tickInterval * 1000;
  }

  canDoMoreActions(): boolean {
    return this.actionsThisTick < this.limits.maxActionsPerTick;
  }

  getActionsThisTick(): number {
    return this.actionsThisTick;
  }

  getMaxActionsPerTick(): number {
    return this.limits.maxActionsPerTick;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTE(self): Action Checking - Am I ready to act?
  // ═══════════════════════════════════════════════════════════════════════════

  private getLastActionTime(type?: string): number {
    if (!type) {
      const last = this.actionHistory[this.actionHistory.length - 1];
      return last?.timestamp || 0;
    }

    for (let i = this.actionHistory.length - 1; i >= 0; i--) {
      if (this.actionHistory[i].type === type) {
        return this.actionHistory[i].timestamp;
      }
    }
    return 0;
  }

  private getCooldownForType(type: string): number {
    switch (type) {
      case 'post':
      case 'reply':
        return this.limits.postCooldown;
      case 'like':
      case 'repost':
        return this.limits.likeCooldown;
      case 'follow':
      case 'unfollow':
        return this.limits.followCooldown;
      default:
        return this.limits.actionCooldown;
    }
  }

  canDoAction(type: string): { allowed: boolean; waitSeconds: number; reason?: string } {
    const now = Date.now();

    // NOTE(self): Check actions per tick limit
    if (!this.canDoMoreActions()) {
      return {
        allowed: false,
        waitSeconds: 0,
        reason: `Reached limit (${this.limits.maxActionsPerTick}) for this cycle`,
      };
    }

    // NOTE(self): Check global action cooldown - breathe between actions
    const lastAny = this.getLastActionTime();
    const globalWait = Math.ceil((this.limits.actionCooldown * 1000 - (now - lastAny)) / 1000);
    if (globalWait > 0) {
      return {
        allowed: false,
        waitSeconds: globalWait,
        reason: 'Breathing between actions',
      };
    }

    // NOTE(self): Check type-specific cooldown
    const lastOfType = this.getLastActionTime(type);
    const cooldown = this.getCooldownForType(type);
    const typeWait = Math.ceil((cooldown * 1000 - (now - lastOfType)) / 1000);
    if (typeWait > 0) {
      return {
        allowed: false,
        waitSeconds: typeWait,
        reason: `Waiting before next ${type}`,
      };
    }

    return { allowed: true, waitSeconds: 0 };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTE(self): Action Recording - Remember what we've done
  // ═══════════════════════════════════════════════════════════════════════════

  recordAction(type: string, detail?: string): void {
    this.actionHistory.push({
      type,
      timestamp: Date.now(),
      detail,
    });
    this.actionsThisTick++;

    // NOTE(self): Keep history manageable (last 100 actions)
    if (this.actionHistory.length > 100) {
      this.actionHistory = this.actionHistory.slice(-100);
    }

    logger.debug('Action recorded', { type, actionsThisTick: this.actionsThisTick });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTE(self): Reflection Pause - Take time to think
  // ═══════════════════════════════════════════════════════════════════════════

  async reflect(reason?: string): Promise<void> {
    if (reason) {
      ui.think(reason);
    }
    await this.sleep(this.limits.reflectionPause * 1000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTE(self): Utilities
  // ═══════════════════════════════════════════════════════════════════════════

  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async waitForCooldown(type: string): Promise<void> {
    const check = this.canDoAction(type);
    if (!check.allowed && check.waitSeconds > 0) {
      ui.info(`${check.reason}`, `${check.waitSeconds}s`);
      await this.sleep(check.waitSeconds * 1000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTE(self): Statistics - Understand our rhythm
  // ═══════════════════════════════════════════════════════════════════════════

  getStats(): { total: number; recent: Record<string, number>; actionsThisTick: number } {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    const recentActions = this.actionHistory.filter((a) => a.timestamp > oneHourAgo);
    const byType: Record<string, number> = {};

    for (const action of recentActions) {
      byType[action.type] = (byType[action.type] || 0) + 1;
    }

    return {
      total: this.actionHistory.length,
      recent: byType,
      actionsThisTick: this.actionsThisTick,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// NOTE(self): Singleton export for consistent pacing across the app
// ════════════════════════════════════════════════════════════════════════════

export const pacing = new PacingManager();

// ════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * //NOTE(self): Map tool names to action types for pacing
 */
export function getActionType(toolName: string): string {
  const mapping: Record<string, string> = {
    bluesky_post: 'post',
    bluesky_reply: 'reply',
    bluesky_like: 'like',
    bluesky_repost: 'repost',
    bluesky_follow: 'follow',
    bluesky_unfollow: 'unfollow',
    github_create_issue_comment: 'comment',
    github_star_repo: 'star',
    github_follow_user: 'follow',
    memory_write: 'memory',
    self_update: 'self',
    queue_add: 'queue',
  };

  return mapping[toolName] || 'other';
}

/**
 * //NOTE(self): Check if a tool is a "social action" that should be rate limited
 */
export function isSocialAction(toolName: string): boolean {
  const socialTools = [
    'bluesky_post',
    'bluesky_reply',
    'bluesky_like',
    'bluesky_repost',
    'bluesky_follow',
    'bluesky_unfollow',
    'github_create_issue_comment',
    'github_star_repo',
    'github_follow_user',
  ];

  return socialTools.includes(toolName);
}

/**
 * //NOTE(self): Check if a tool is a "read" action (no rate limit needed)
 */
export function isReadAction(toolName: string): boolean {
  const readTools = [
    'bluesky_get_timeline',
    'bluesky_get_notifications',
    'bluesky_get_profile',
    'bluesky_get_followers',
    'bluesky_get_follows',
    'github_get_repo',
    'github_list_issues',
    'memory_read',
    'memory_list',
    'self_read',
  ];

  return readTools.includes(toolName);
}
