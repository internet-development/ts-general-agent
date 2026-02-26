import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('@modules/ui.js', () => ({
  ui: {
    info: vi.fn(),
    think: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@modules/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { pacing } from './pacing.js';

describe('PacingManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset tick counter each test
    pacing.startTick();
    // Ensure urgent mode is off
    pacing.setUrgentMode(false);
    // Reset limits to known defaults
    pacing.setLimits({
      postCooldown: 1800,
      replyCooldown: 60,
      likeCooldown: 45,
      followCooldown: 3600,
      actionCooldown: 10,
      tickInterval: 120,
      maxActionsPerTick: 3,
      reflectionPause: 3,
    });
  });

  it('canDoAction returns allowed:true initially', () => {
    const result = pacing.canDoAction('post');
    expect(result.allowed).toBe(true);
    expect(result.waitSeconds).toBe(0);
    expect(result.reason).toBeUndefined();
  });

  it('after recording an action, type-specific cooldown blocks same type', () => {
    pacing.recordAction('post');

    const result = pacing.canDoAction('post');
    expect(result.allowed).toBe(false);
    expect(result.waitSeconds).toBeGreaterThan(0);
    expect(result.reason).toBeDefined();
  });

  it('global action cooldown blocks any action after recording', () => {
    pacing.recordAction('like');

    // A different type should still be blocked by the global action cooldown
    const result = pacing.canDoAction('post');
    expect(result.allowed).toBe(false);
    expect(result.waitSeconds).toBeGreaterThan(0);
    expect(result.reason).toContain('Breathing');
  });

  it('startTick resets actionsThisTick counter', () => {
    pacing.recordAction('like');
    pacing.recordAction('like');
    expect(pacing.getActionsThisTick()).toBe(2);

    pacing.startTick();
    expect(pacing.getActionsThisTick()).toBe(0);
  });

  it('canDoMoreActions returns false after maxActionsPerTick actions', () => {
    // Default maxActionsPerTick is 3
    pacing.recordAction('like');
    pacing.recordAction('like');
    pacing.recordAction('like');

    expect(pacing.canDoMoreActions()).toBe(false);

    // canDoAction should also reflect the tick limit
    const result = pacing.canDoAction('like');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('limit');
  });

  it('urgentMode bypasses pacing for replies only', () => {
    // Record an action to trigger cooldowns
    pacing.recordAction('reply');

    // Without urgent mode, reply should be blocked
    const blockedResult = pacing.canDoAction('reply');
    expect(blockedResult.allowed).toBe(false);

    // Enable urgent mode
    pacing.setUrgentMode(true);
    expect(pacing.isUrgentMode()).toBe(true);

    // Reply should now be allowed despite cooldowns
    const urgentReply = pacing.canDoAction('reply');
    expect(urgentReply.allowed).toBe(true);
    expect(urgentReply.waitSeconds).toBe(0);

    // Post should still be blocked (urgent mode only bypasses replies)
    const urgentPost = pacing.canDoAction('post');
    expect(urgentPost.allowed).toBe(false);
  });

  it('getStats counts recent actions within 1h window', () => {
    pacing.recordAction('post', 'test post');
    pacing.recordAction('like');
    pacing.recordAction('like');

    const stats = pacing.getStats();

    expect(stats.total).toBeGreaterThanOrEqual(3);
    expect(stats.actionsThisTick).toBe(3);

    // Recent actions should include what we just recorded
    expect(stats.recent['post']).toBeGreaterThanOrEqual(1);
    expect(stats.recent['like']).toBeGreaterThanOrEqual(2);
  });
});
