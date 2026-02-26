import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before importing the module under test
vi.mock('@modules/llm-gateway.js', () => ({
  chat: vi.fn(),
}));

vi.mock('@modules/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@modules/ui.js', () => ({
  ui: {
    info: vi.fn(),
  },
}));

// Import the mocked chat after vi.mock declarations
import { chat } from '@modules/llm-gateway.js';
import {
  clearIntentCache,
  getCachedIntent,
  classifyHostMessage,
  classifyHostMessages,
} from './intent-cache.js';

const mockedChat = vi.mocked(chat);

describe('intent-cache', () => {
  beforeEach(() => {
    // Reset the cache and all mocks before each test
    clearIntentCache();
    vi.clearAllMocks();
  });

  // ─── clearIntentCache ──────────────────────────────────────────────────────

  describe('clearIntentCache', () => {
    it('clears all cached entries', async () => {
      // Populate the cache with a high-confidence structural hit
      await classifyHostMessage('Create an issue for the checklist');
      expect(getCachedIntent('Create an issue for the checklist')).toBe('action_request');

      clearIntentCache();

      expect(getCachedIntent('Create an issue for the checklist')).toBeUndefined();
    });
  });

  // ─── getCachedIntent ───────────────────────────────────────────────────────

  describe('getCachedIntent', () => {
    it('returns undefined for content that has not been classified yet', () => {
      expect(getCachedIntent('something totally new')).toBeUndefined();
    });

    it('returns the cached intent after a classification has been performed', async () => {
      // "Create an issue" is structurally action_request with high confidence
      await classifyHostMessage('Create an issue');
      expect(getCachedIntent('Create an issue')).toBe('action_request');
    });
  });

  // ─── classifyHostMessage — structural (high-confidence) path ──────────────

  describe('classifyHostMessage — structural high-confidence', () => {
    it('returns action_request for an imperative message without calling the LLM', async () => {
      const result = await classifyHostMessage('Create an issue for the prod checklist');
      expect(result).toBe('action_request');
      expect(mockedChat).not.toHaveBeenCalled();
    });

    it('caches the structural result so a second call returns the same value without re-invoking the LLM', async () => {
      await classifyHostMessage('Create an issue for the prod checklist');
      const result = await classifyHostMessage('Create an issue for the prod checklist');
      expect(result).toBe('action_request');
      // Chat must never have been called for either invocation
      expect(mockedChat).not.toHaveBeenCalled();
    });
  });

  // ─── classifyHostMessage — LLM (ambiguous) path ───────────────────────────

  describe('classifyHostMessage — LLM classification for ambiguous messages', () => {
    // "We should probably run some tests" is genuinely ambiguous:
    // - no question mark, so no question-pattern match
    // - starts with "We", not an action verb, so ACTION_VERB_START does not trigger
    // - no POLITE_IMPERATIVE / POLITE_REQUEST / DIRECT_REQUEST match
    // - no OPINION_SHARING / FOLLOW_UP / URL match
    // The structural classifier returns { confidence: 'ambiguous' }, forwarding to LLM.
    const AMBIGUOUS = 'We should probably run some tests';

    it('calls the LLM and returns action_request when the response contains ACTION_REQUEST', async () => {
      mockedChat.mockResolvedValueOnce('ACTION_REQUEST');
      const result = await classifyHostMessage(AMBIGUOUS);
      expect(result).toBe('action_request');
      expect(mockedChat).toHaveBeenCalledOnce();
    });

    it('calls the LLM and returns follow_up when the response contains FOLLOW_UP', async () => {
      mockedChat.mockResolvedValueOnce('FOLLOW_UP');
      const result = await classifyHostMessage(AMBIGUOUS);
      expect(result).toBe('follow_up');
      expect(mockedChat).toHaveBeenCalledOnce();
    });

    it('calls the LLM and returns discussion when the response contains DISCUSSION', async () => {
      mockedChat.mockResolvedValueOnce('DISCUSSION');
      const result = await classifyHostMessage(AMBIGUOUS);
      expect(result).toBe('discussion');
      expect(mockedChat).toHaveBeenCalledOnce();
    });

    it('caches the LLM result — a second call with the same content does not invoke the LLM again', async () => {
      mockedChat.mockResolvedValueOnce('ACTION_REQUEST');

      const first = await classifyHostMessage(AMBIGUOUS);
      const second = await classifyHostMessage(AMBIGUOUS);

      expect(first).toBe('action_request');
      expect(second).toBe('action_request');
      // Only one LLM call despite two invocations
      expect(mockedChat).toHaveBeenCalledOnce();
    });

    it('defaults to discussion when the LLM call throws', async () => {
      mockedChat.mockRejectedValueOnce(new Error('network error'));
      const result = await classifyHostMessage(AMBIGUOUS);
      expect(result).toBe('discussion');
    });

    it('defaults to discussion when the LLM returns an unrecognised response', async () => {
      mockedChat.mockResolvedValueOnce('SOMETHING_UNKNOWN');
      const result = await classifyHostMessage(AMBIGUOUS);
      expect(result).toBe('discussion');
    });
  });

  // ─── classifyHostMessages ─────────────────────────────────────────────────

  describe('classifyHostMessages', () => {
    it('classifies multiple messages and returns the original fields plus intent', async () => {
      // Use high-confidence structural inputs so the LLM is never required
      const messages = [
        { name: 'alice', content: 'Create an issue', timestamp: '2024-01-01T00:00:00Z' },
        { name: 'bob', content: 'What do you think about this?', timestamp: '2024-01-01T00:01:00Z' },
        { name: 'charlie', content: 'Did you create that issue?', timestamp: '2024-01-01T00:02:00Z' },
      ];

      const results = await classifyHostMessages(messages);

      expect(results).toHaveLength(3);

      // Original fields are preserved
      expect(results[0].name).toBe('alice');
      expect(results[0].content).toBe('Create an issue');
      expect(results[0].timestamp).toBe('2024-01-01T00:00:00Z');

      // Intents are correct
      expect(results[0].intent).toBe('action_request');
      expect(results[1].intent).toBe('discussion');
      expect(results[2].intent).toBe('follow_up');
    });

    it('classifies messages in parallel — all LLM calls fire concurrently for ambiguous inputs', async () => {
      // Both strings are structurally ambiguous (no question mark, no imperative verb start,
      // no POLITE_IMPERATIVE/REQUEST/DIRECT_REQUEST, no OPINION_SHARING, no URL).
      const AMBIGUOUS_A = 'We should probably run some tests';
      const AMBIGUOUS_B = 'The retry logic could be improved';

      mockedChat
        .mockResolvedValueOnce('ACTION_REQUEST')
        .mockResolvedValueOnce('DISCUSSION');

      const messages = [
        { name: 'alice', content: AMBIGUOUS_A, timestamp: '2024-01-01T00:00:00Z' },
        { name: 'bob', content: AMBIGUOUS_B, timestamp: '2024-01-01T00:01:00Z' },
      ];

      const results = await classifyHostMessages(messages);

      expect(results[0].intent).toBe('action_request');
      expect(results[1].intent).toBe('discussion');
      expect(mockedChat).toHaveBeenCalledTimes(2);
    });
  });
});
