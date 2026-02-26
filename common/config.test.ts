import { describe, it, expect } from 'vitest';
import {
  // Scheduler intervals
  AWARENESS_INTERVAL_MS,
  GITHUB_AWARENESS_INTERVAL_MS,
  EXPRESSION_MIN_INTERVAL_MS,
  EXPRESSION_MAX_INTERVAL_MS,
  REFLECTION_INTERVAL_MS,
  PLAN_AWARENESS_INTERVAL_MS,
  SESSION_REFRESH_INTERVAL_MS,
  VERSION_CHECK_INTERVAL_MS,
  EXPRESSION_CHECK_INTERVAL_MS,
  REFLECTION_CHECK_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  ENGAGEMENT_CHECK_INTERVAL_MS,
  COMMITMENT_CHECK_INTERVAL_MS,
  RITUAL_CHECK_INTERVAL_MS,
  SPACE_CHECK_INTERVAL_MS,
  SPACE_RECONNECT_INTERVAL_MS,

  // Quiet hours
  QUIET_HOURS_START,
  QUIET_HOURS_END,

  // Echo detection
  ENSEMBLE_ECHO_THRESHOLD,
  CONCEPT_NOVELTY_THRESHOLD,
  ECHO_JUDGE_BORDERLINE_LOW,

  // Role budgets
  ROLE_MESSAGE_BUDGET_ACTOR,
  ROLE_MESSAGE_BUDGET_REVIEWER,
  ROLE_MESSAGE_BUDGET_OBSERVER,

  // LLM gateway
  LLM_MAX_RETRIES,

  // Space message validation (mode-dependent)
  SPACE_ACTION_MAX_CHARS,
  SPACE_ACTION_MAX_SENTENCES,
  SPACE_DISCUSSION_MAX_CHARS,
  SPACE_DISCUSSION_MAX_SENTENCES,

  // Commitment in-progress timeout
  COMMITMENT_IN_PROGRESS_TIMEOUT_MS,
} from './config.js';

describe('config sanity checks', () => {
  describe('all interval constants are positive numbers', () => {
    const intervals: Record<string, number> = {
      AWARENESS_INTERVAL_MS,
      GITHUB_AWARENESS_INTERVAL_MS,
      EXPRESSION_MIN_INTERVAL_MS,
      EXPRESSION_MAX_INTERVAL_MS,
      REFLECTION_INTERVAL_MS,
      PLAN_AWARENESS_INTERVAL_MS,
      SESSION_REFRESH_INTERVAL_MS,
      VERSION_CHECK_INTERVAL_MS,
      EXPRESSION_CHECK_INTERVAL_MS,
      REFLECTION_CHECK_INTERVAL_MS,
      HEARTBEAT_INTERVAL_MS,
      ENGAGEMENT_CHECK_INTERVAL_MS,
      COMMITMENT_CHECK_INTERVAL_MS,
      RITUAL_CHECK_INTERVAL_MS,
      SPACE_CHECK_INTERVAL_MS,
      SPACE_RECONNECT_INTERVAL_MS,
    };

    for (const [name, value] of Object.entries(intervals)) {
      it(`${name} is a positive number`, () => {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
      });
    }
  });

  it('EXPRESSION_MIN_INTERVAL_MS < EXPRESSION_MAX_INTERVAL_MS', () => {
    expect(EXPRESSION_MIN_INTERVAL_MS).toBeLessThan(EXPRESSION_MAX_INTERVAL_MS);
  });

  it('QUIET_HOURS_START is a valid hour (0-23)', () => {
    expect(QUIET_HOURS_START).toBeGreaterThanOrEqual(0);
    expect(QUIET_HOURS_START).toBeLessThanOrEqual(23);
    expect(Number.isInteger(QUIET_HOURS_START)).toBe(true);
  });

  it('QUIET_HOURS_END is a valid hour (0-23)', () => {
    expect(QUIET_HOURS_END).toBeGreaterThanOrEqual(0);
    expect(QUIET_HOURS_END).toBeLessThanOrEqual(23);
    expect(Number.isInteger(QUIET_HOURS_END)).toBe(true);
  });

  it('ENSEMBLE_ECHO_THRESHOLD is between 0 and 1', () => {
    expect(ENSEMBLE_ECHO_THRESHOLD).toBeGreaterThan(0);
    expect(ENSEMBLE_ECHO_THRESHOLD).toBeLessThan(1);
  });

  it('CONCEPT_NOVELTY_THRESHOLD is between 0 and 1', () => {
    expect(CONCEPT_NOVELTY_THRESHOLD).toBeGreaterThan(0);
    expect(CONCEPT_NOVELTY_THRESHOLD).toBeLessThan(1);
  });

  it('ECHO_JUDGE_BORDERLINE_LOW < ENSEMBLE_ECHO_THRESHOLD', () => {
    expect(ECHO_JUDGE_BORDERLINE_LOW).toBeLessThan(ENSEMBLE_ECHO_THRESHOLD);
  });

  describe('role message budgets are positive integers', () => {
    const budgets: Record<string, number> = {
      ROLE_MESSAGE_BUDGET_ACTOR,
      ROLE_MESSAGE_BUDGET_REVIEWER,
      ROLE_MESSAGE_BUDGET_OBSERVER,
    };

    for (const [name, value] of Object.entries(budgets)) {
      it(`${name} is a positive integer`, () => {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      });
    }
  });

  it('LLM_MAX_RETRIES is positive', () => {
    expect(LLM_MAX_RETRIES).toBeGreaterThan(0);
  });

  describe('space message validation limits', () => {
    it('all limits are positive numbers', () => {
      expect(SPACE_ACTION_MAX_CHARS).toBeGreaterThan(0);
      expect(SPACE_ACTION_MAX_SENTENCES).toBeGreaterThan(0);
      expect(SPACE_DISCUSSION_MAX_CHARS).toBeGreaterThan(0);
      expect(SPACE_DISCUSSION_MAX_SENTENCES).toBeGreaterThan(0);
    });

    it('action limits are not stricter than discussion limits', () => {
      expect(SPACE_ACTION_MAX_CHARS).toBeLessThanOrEqual(SPACE_DISCUSSION_MAX_CHARS);
      expect(SPACE_ACTION_MAX_SENTENCES).toBeLessThanOrEqual(SPACE_DISCUSSION_MAX_SENTENCES);
    });
  });

  it('COMMITMENT_IN_PROGRESS_TIMEOUT_MS is positive and less than stale threshold', () => {
    expect(COMMITMENT_IN_PROGRESS_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
