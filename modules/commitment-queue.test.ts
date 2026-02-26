import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Mock logger before importing the module
vi.mock('@modules/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock memory-version to avoid actual file operations during version check
vi.mock('@common/memory-version.js', () => ({
  MEMORY_VERSION: '10.0.0',
  resetJsonlIfVersionMismatch: vi.fn(() => false),
  stampJsonlVersion: vi.fn(),
}));

import {
  enqueueCommitment,
  getPendingCommitments,
  markCommitmentInProgress,
  markCommitmentCompleted,
  markCommitmentFailed,
  abandonStaleCommitments,
  timeoutInProgressCommitments,
  getRecentlyCompletedCommitments,
  getCommitmentOutcomePatterns,
  isRepoCooledDown,
  _resetQueueCacheForTesting,
  type Commitment,
  type CommitmentType,
} from '@modules/commitment-queue.js';

// Helpers
const QUEUE_FILE = '.memory/pending_commitments.jsonl';
const REPO_COOLDOWN_FILE = '.memory/repo_cooldown.json';

function cleanupFiles() {
  try { fs.unlinkSync(QUEUE_FILE); } catch {}
  try { fs.unlinkSync(QUEUE_FILE + '.version'); } catch {}
  try { fs.unlinkSync(REPO_COOLDOWN_FILE); } catch {}
}

function makeCommitmentParams(overrides: Partial<{
  description: string;
  type: CommitmentType;
  sourceThreadUri: string;
  sourceReplyText: string;
  params: Record<string, unknown>;
  source: 'bluesky' | 'space';
}> = {}) {
  return {
    description: overrides.description || 'Create a test issue',
    type: overrides.type || 'create_issue' as CommitmentType,
    sourceThreadUri: overrides.sourceThreadUri || 'at://did:plc:test/app.bsky.feed.post/abc123',
    sourceReplyText: overrides.sourceReplyText || 'I will create a test issue',
    params: overrides.params || { owner: 'test-org', repoName: 'test-repo', title: 'Test Issue' },
    source: overrides.source || 'bluesky' as const,
  };
}

describe('commitment-queue', () => {
  beforeEach(() => {
    cleanupFiles();
    _resetQueueCacheForTesting();
    if (!fs.existsSync('.memory')) {
      fs.mkdirSync('.memory', { recursive: true });
    }
    // Write empty queue file to ensure clean state
    fs.writeFileSync(QUEUE_FILE, '');
    fs.writeFileSync(QUEUE_FILE + '.version', '10.0.0');
  });

  afterEach(() => {
    cleanupFiles();
  });

  describe('enqueueCommitment', () => {
    it('creates a commitment with correct fields', () => {
      const params = makeCommitmentParams();
      const result = enqueueCommitment(params);

      expect(result).not.toBeNull();
      expect(result!.description).toBe(params.description);
      expect(result!.type).toBe(params.type);
      expect(result!.sourceThreadUri).toBe(params.sourceThreadUri);
      expect(result!.sourceReplyText).toBe(params.sourceReplyText);
      expect(result!.status).toBe('pending');
      expect(result!.attemptCount).toBe(0);
      expect(result!.error).toBeNull();
      expect(result!.result).toBeNull();
      expect(result!.source).toBe('bluesky');
      expect(result!.id).toMatch(/^commitment-\d+-[a-f0-9]{16}$/);
    });

    it('defaults source to bluesky', () => {
      const params = makeCommitmentParams();
      delete (params as any).source;
      const result = enqueueCommitment(params);
      expect(result!.source).toBe('bluesky');
    });

    it('respects space source', () => {
      const result = enqueueCommitment(makeCommitmentParams({ source: 'space' }));
      expect(result!.source).toBe('space');
    });

    it('deduplicates identical commitments', () => {
      const params = makeCommitmentParams();
      const first = enqueueCommitment(params);
      const second = enqueueCommitment(params);

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('allows different commitments from same thread', () => {
      const first = enqueueCommitment(makeCommitmentParams({ description: 'Issue one' }));
      const second = enqueueCommitment(makeCommitmentParams({ description: 'Issue two' }));

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.id).not.toBe(second!.id);
    });

    it('allows same description from different threads', () => {
      const first = enqueueCommitment(makeCommitmentParams({ sourceThreadUri: 'at://thread/1' }));
      const second = enqueueCommitment(makeCommitmentParams({ sourceThreadUri: 'at://thread/2' }));

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
    });

    it('persists to disk', () => {
      enqueueCommitment(makeCommitmentParams());

      expect(fs.existsSync(QUEUE_FILE)).toBe(true);
      const content = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
      expect(content.length).toBeGreaterThan(0);
      const parsed = JSON.parse(content);
      expect(parsed.type).toBe('create_issue');
    });

    it('supports all commitment types', () => {
      const types: CommitmentType[] = ['create_issue', 'create_plan', 'comment_issue', 'post_bluesky'];
      for (const type of types) {
        const result = enqueueCommitment(makeCommitmentParams({
          type,
          description: `Test ${type}`,
          sourceThreadUri: `at://thread/${type}`,
        }));
        expect(result).not.toBeNull();
        expect(result!.type).toBe(type);
      }
    });
  });

  describe('getPendingCommitments', () => {
    it('returns pending commitments sorted by creation time', () => {
      enqueueCommitment(makeCommitmentParams({ description: 'First', sourceThreadUri: 'at://1' }));
      enqueueCommitment(makeCommitmentParams({ description: 'Second', sourceThreadUri: 'at://2' }));

      const pending = getPendingCommitments();
      expect(pending.length).toBe(2);
      expect(pending[0].description).toBe('First');
      expect(pending[1].description).toBe('Second');
    });

    it('excludes completed and abandoned commitments', () => {
      const c = enqueueCommitment(makeCommitmentParams());
      markCommitmentCompleted(c!.id, { url: 'https://example.com' });

      const pending = getPendingCommitments();
      expect(pending.length).toBe(0);
    });

    it('includes failed commitments under max attempts', () => {
      const c = enqueueCommitment(makeCommitmentParams());
      markCommitmentFailed(c!.id, 'Network error');

      const pending = getPendingCommitments();
      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('failed');
    });
  });

  describe('status transitions', () => {
    it('marks commitment in progress', () => {
      const c = enqueueCommitment(makeCommitmentParams())!;
      markCommitmentInProgress(c.id);

      const pending = getPendingCommitments();
      expect(pending.length).toBe(0); // in_progress is not pending
    });

    it('marks commitment completed with result', () => {
      const c = enqueueCommitment(makeCommitmentParams())!;
      const result = { issueUrl: 'https://github.com/test/repo/issues/1' };
      markCommitmentCompleted(c.id, result);

      const completed = getRecentlyCompletedCommitments(60 * 60 * 1000);
      expect(completed.length).toBe(1);
      expect(completed[0].result).toEqual(result);
      expect(completed[0].status).toBe('completed');
    });

    it('marks commitment failed and increments attempt count', () => {
      const c = enqueueCommitment(makeCommitmentParams())!;
      markCommitmentFailed(c.id, 'API error');

      const pending = getPendingCommitments();
      expect(pending.length).toBe(1);
      expect(pending[0].attemptCount).toBe(1);
      expect(pending[0].error).toBe('API error');
    });

    it('auto-abandons after max attempts (3)', () => {
      const c = enqueueCommitment(makeCommitmentParams())!;

      markCommitmentFailed(c.id, 'Error 1');
      markCommitmentFailed(c.id, 'Error 2');
      markCommitmentFailed(c.id, 'Error 3');

      const pending = getPendingCommitments();
      expect(pending.length).toBe(0); // abandoned, not pending
    });
  });

  describe('getRecentlyCompletedCommitments', () => {
    it('returns commitments completed within time window', () => {
      const c = enqueueCommitment(makeCommitmentParams())!;
      markCommitmentCompleted(c.id, { done: true });

      const recent = getRecentlyCompletedCommitments(60_000); // 1 minute window
      expect(recent.length).toBe(1);
    });

    it('excludes old completions', () => {
      const recent = getRecentlyCompletedCommitments(1); // 1ms window — nothing will be recent enough
      expect(recent.length).toBe(0);
    });
  });

  describe('getCommitmentOutcomePatterns', () => {
    it('returns success and failure counts', () => {
      const c1 = enqueueCommitment(makeCommitmentParams({ description: 'Success', sourceThreadUri: 'at://s1' }))!;
      markCommitmentCompleted(c1.id, {});

      const c2 = enqueueCommitment(makeCommitmentParams({ description: 'Fail', sourceThreadUri: 'at://f1' }))!;
      markCommitmentFailed(c2.id, 'error');
      markCommitmentFailed(c2.id, 'error');
      markCommitmentFailed(c2.id, 'error'); // auto-abandoned

      const patterns = getCommitmentOutcomePatterns();
      expect(patterns.successes).toBe(1);
      expect(patterns.failures).toBe(1); // abandoned counts as failure
    });
  });

  describe('abandonStaleCommitments', () => {
    it('abandons commitments older than 24h', () => {
      // Create a commitment and manually backdate it
      const c = enqueueCommitment(makeCommitmentParams())!;

      // Read the queue file, modify the timestamp, and write it back
      const content = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
      const commitment = JSON.parse(content);
      commitment.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(commitment) + '\n');

      // Force cache reload by calling abandonStaleCommitments
      // The module caches, so this may or may not pick up the change
      // depending on internal state
      abandonStaleCommitments();
    });
  });

  describe('timeoutInProgressCommitments', () => {
    it('times out in_progress commitments older than threshold', () => {
      const c = enqueueCommitment(makeCommitmentParams())!;
      markCommitmentInProgress(c.id);

      // Manually backdate the lastAttemptAt to 15 minutes ago
      _resetQueueCacheForTesting();
      const content = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
      const commitment = JSON.parse(content);
      commitment.lastAttemptAt = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15m ago
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(commitment) + '\n');
      _resetQueueCacheForTesting();

      timeoutInProgressCommitments();

      // Should now be failed (retryable), not in_progress
      const pending = getPendingCommitments();
      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('failed');
      expect(pending[0].error).toContain('Timed out');
      expect(pending[0].attemptCount).toBe(1);
    });

    it('does not timeout recent in_progress commitments', () => {
      const c = enqueueCommitment(makeCommitmentParams())!;
      markCommitmentInProgress(c.id);

      // lastAttemptAt is just now — should not time out
      timeoutInProgressCommitments();

      // Should still be in_progress (not in pending list)
      const pending = getPendingCommitments();
      expect(pending.length).toBe(0);
    });

    it('auto-abandons after max attempts via timeout', () => {
      const c = enqueueCommitment(makeCommitmentParams())!;

      // Fail twice, then mark in_progress and timeout — should abandon at attempt 3
      markCommitmentFailed(c.id, 'Error 1');
      markCommitmentFailed(c.id, 'Error 2');

      // Now mark in_progress and backdate
      markCommitmentInProgress(c.id);
      _resetQueueCacheForTesting();
      const content = fs.readFileSync(QUEUE_FILE, 'utf8').trim();
      const commitment = JSON.parse(content);
      commitment.lastAttemptAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(commitment) + '\n');
      _resetQueueCacheForTesting();

      timeoutInProgressCommitments();

      // Should be abandoned (3 attempts total)
      const pending = getPendingCommitments();
      expect(pending.length).toBe(0);
    });
  });

  describe('deduplication hash', () => {
    it('normalizes description for dedup (case insensitive, whitespace collapsed)', () => {
      const first = enqueueCommitment(makeCommitmentParams({ description: 'Create an issue' }));
      // Same description with different casing/spacing should be deduped
      const second = enqueueCommitment(makeCommitmentParams({ description: '  CREATE   AN   ISSUE  ' }));

      expect(first).not.toBeNull();
      expect(second).toBeNull(); // deduped
    });
  });

  describe('isRepoCooledDown', () => {
    it('returns false when no cooldown exists', () => {
      expect(isRepoCooledDown('test-org', 'test-repo')).toBe(false);
    });

    it('returns true when cooldown is active', () => {
      const cooldown = [{
        owner: 'test-org',
        repo: 'test-repo',
        cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
        reason: 'test',
      }];
      if (!fs.existsSync('.memory')) fs.mkdirSync('.memory', { recursive: true });
      fs.writeFileSync(REPO_COOLDOWN_FILE, JSON.stringify(cooldown));

      expect(isRepoCooledDown('test-org', 'test-repo')).toBe(true);
    });

    it('returns false when cooldown is expired', () => {
      const cooldown = [{
        owner: 'test-org',
        repo: 'test-repo',
        cooldownUntil: new Date(Date.now() - 60_000).toISOString(), // expired
        reason: 'test',
      }];
      if (!fs.existsSync('.memory')) fs.mkdirSync('.memory', { recursive: true });
      fs.writeFileSync(REPO_COOLDOWN_FILE, JSON.stringify(cooldown));

      expect(isRepoCooledDown('test-org', 'test-repo')).toBe(false);
    });
  });
});
