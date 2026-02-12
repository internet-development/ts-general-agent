//NOTE(self): Pacing Module
//NOTE(self): Ensures the agent acts with dignity and deliberation.
//NOTE(self): Prevents spammy behavior and encourages thoughtful engagement.
//NOTE(self): Quality over quantity - one thoughtful interaction beats many shallow ones.

import { ui } from '@modules/ui.js';
import { logger } from '@modules/logger.js';
import {
  PACING_POST_COOLDOWN_S,
  PACING_REPLY_COOLDOWN_S,
  PACING_LIKE_COOLDOWN_S,
  PACING_FOLLOW_COOLDOWN_S,
  PACING_ACTION_COOLDOWN_S,
  PACING_TICK_INTERVAL_S,
  PACING_MAX_ACTIONS_PER_TICK,
  PACING_REFLECTION_PAUSE_S,
} from '@common/config.js';


//NOTE(self): Rate Limits
export interface RateLimits {
  //NOTE(self): Minimum seconds between original posts
  postCooldown: number;
  //NOTE(self): Minimum seconds between replies (faster - conversations flow)
  replyCooldown: number;
  //NOTE(self): Minimum seconds between likes
  likeCooldown: number;
  //NOTE(self): Minimum seconds between follows
  followCooldown: number;
  //NOTE(self): Minimum seconds between any action
  actionCooldown: number;
  //NOTE(self): Minimum seconds between autonomous ticks
  tickInterval: number;
  //NOTE(self): Maximum actions per tick
  maxActionsPerTick: number;
  //NOTE(self): Reflection pause (seconds) - time to pause and reflect
  reflectionPause: number;
}

//NOTE(self): Default limits model real human social media behavior
//NOTE(self): Thoughtful, present, but not obsessively refreshing
const DEFAULT_LIMITS: RateLimits = {
  postCooldown: PACING_POST_COOLDOWN_S,
  replyCooldown: PACING_REPLY_COOLDOWN_S,
  likeCooldown: PACING_LIKE_COOLDOWN_S,
  followCooldown: PACING_FOLLOW_COOLDOWN_S,
  actionCooldown: PACING_ACTION_COOLDOWN_S,
  tickInterval: PACING_TICK_INTERVAL_S,
  maxActionsPerTick: PACING_MAX_ACTIONS_PER_TICK,
  reflectionPause: PACING_REFLECTION_PAUSE_S,
};


//NOTE(self): Action Tracking
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
  private urgentMode = false;

  constructor(limits: RateLimits = DEFAULT_LIMITS) {
    this.limits = limits;
  }


  //NOTE(self): Urgent Mode - bypass pacing for immediate replies


  setUrgentMode(urgent: boolean): void {
    this.urgentMode = urgent;
    if (urgent) {
      logger.info('Urgent mode enabled - replies will flow immediately');
    }
  }

  isUrgentMode(): boolean {
    return this.urgentMode;
  }


  //NOTE(self): Configuration


  setLimits(limits: Partial<RateLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  getLimits(): RateLimits {
    return { ...this.limits };
  }


  //NOTE(self): Tick Management


  startTick(): void {
    this.actionsThisTick = 0;
    this.lastTickTime = Date.now();
  }

  getTickInterval(): number {
    return this.limits.tickInterval * 1000;
  }

  canDoMoreActions(): boolean {
    //NOTE(self): Urgent mode allows unlimited actions - clear the queue
    if (this.urgentMode) {
      return true;
    }
    return this.actionsThisTick < this.limits.maxActionsPerTick;
  }

  getActionsThisTick(): number {
    return this.actionsThisTick;
  }

  getMaxActionsPerTick(): number {
    return this.limits.maxActionsPerTick;
  }


  //NOTE(self): Action Checking - Am I ready to act?


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
        return this.limits.postCooldown;
      case 'reply':
        return this.limits.replyCooldown;
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

    //NOTE(self): Urgent mode bypasses all pacing for replies - people deserve quick responses
    if (this.urgentMode && type === 'reply') {
      return { allowed: true, waitSeconds: 0 };
    }

    //NOTE(self): Check actions per tick limit
    if (!this.canDoMoreActions()) {
      return {
        allowed: false,
        waitSeconds: 0,
        reason: `Reached limit (${this.limits.maxActionsPerTick}) for this cycle`,
      };
    }

    //NOTE(self): Check global action cooldown - breathe between actions
    const lastAny = this.getLastActionTime();
    const globalWait = Math.ceil((this.limits.actionCooldown * 1000 - (now - lastAny)) / 1000);
    if (globalWait > 0) {
      return {
        allowed: false,
        waitSeconds: globalWait,
        reason: 'Breathing between actions',
      };
    }

    //NOTE(self): Check type-specific cooldown
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


  //NOTE(self): Action Recording - Remember what we've done


  recordAction(type: string, detail?: string): void {
    this.actionHistory.push({
      type,
      timestamp: Date.now(),
      detail,
    });
    this.actionsThisTick++;

    //NOTE(self): Keep history manageable (last 100 actions)
    if (this.actionHistory.length > 100) {
      this.actionHistory = this.actionHistory.slice(-100);
    }

    logger.info('Action recorded', { type, actionsThisTick: this.actionsThisTick });
  }


  //NOTE(self): Reflection Pause - Take time to think


  async reflect(reason?: string): Promise<void> {
    if (reason) {
      ui.think(reason);
    }
    await this.sleep(this.limits.reflectionPause * 1000);
  }


  //NOTE(self): Utilities


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


  //NOTE(self): Statistics - Understand our rhythm


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


//NOTE(self): Singleton export for consistent pacing across the app


export const pacing = new PacingManager();
