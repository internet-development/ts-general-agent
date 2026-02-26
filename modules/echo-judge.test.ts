import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
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

import { isEchoByLLMJudge, clearEchoJudgeCache } from './echo-judge.js';
import { chat } from '@modules/llm-gateway.js';

const mockChat = vi.mocked(chat);

describe('echo-judge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEchoJudgeCache();
  });

  it('returns false for empty peer messages', async () => {
    const result = await isEchoByLLMJudge('some candidate', []);
    expect(result).toBe(false);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('returns true when LLM responds YES', async () => {
    mockChat.mockResolvedValueOnce('YES');
    const result = await isEchoByLLMJudge('I agree completely', [
      'This is a great idea',
    ]);
    expect(result).toBe(true);
    expect(mockChat).toHaveBeenCalledOnce();
  });

  it('returns false when LLM responds NO', async () => {
    mockChat.mockResolvedValueOnce('NO');
    const result = await isEchoByLLMJudge('Here is a new perspective', [
      'This is a great idea',
    ]);
    expect(result).toBe(false);
    expect(mockChat).toHaveBeenCalledOnce();
  });

  it('caches results — second call with same input does not call LLM again', async () => {
    mockChat.mockResolvedValueOnce('YES');

    const candidate = 'duplicate point';
    const peers = ['existing message'];

    const first = await isEchoByLLMJudge(candidate, peers);
    const second = await isEchoByLLMJudge(candidate, peers);

    expect(first).toBe(true);
    expect(second).toBe(true);
    // LLM should only be called once; second call is served from cache
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('clearEchoJudgeCache resets the cache so LLM is called again', async () => {
    mockChat.mockResolvedValue('NO');

    const candidate = 'some point';
    const peers = ['peer message'];

    await isEchoByLLMJudge(candidate, peers);
    expect(mockChat).toHaveBeenCalledTimes(1);

    clearEchoJudgeCache();

    await isEchoByLLMJudge(candidate, peers);
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it('fails open — returns false when LLM throws', async () => {
    mockChat.mockRejectedValueOnce(new Error('API rate limit exceeded'));

    const result = await isEchoByLLMJudge('candidate text', [
      'peer message',
    ]);
    expect(result).toBe(false);
  });

  it('caps peer list at 10 messages', async () => {
    mockChat.mockResolvedValueOnce('NO');

    const peers = Array.from({ length: 15 }, (_, i) => `message ${i + 1}`);
    await isEchoByLLMJudge('candidate', peers);

    expect(mockChat).toHaveBeenCalledOnce();
    const callArgs = mockChat.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    const userContent = callArgs.messages[0].content;

    // peerMessages.sort() mutates in-place before slice(0,10), so alphabetical order applies.
    // After sort: "message 1","message 10","message 11",...,"message 15","message 2","message 3","message 4"
    // These are the first 10 alphabetically. "message 5" through "message 9" are dropped.
    expect(userContent).toContain('"message 1"');
    expect(userContent).toContain('"message 4"');
    expect(userContent).not.toContain('"message 5"');
    expect(userContent).not.toContain('"message 9"');
    // Exactly 10 numbered entries
    const numberedLines = userContent.match(/^\d+\.\s"/gm);
    expect(numberedLines?.length).toBe(10);
  });
});
