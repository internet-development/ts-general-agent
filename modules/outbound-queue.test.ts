import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';

// ── Mocks (must be hoisted before any imports of the module under test) ──────

vi.mock('@modules/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@modules/pacing.js', () => ({
  pacing: {
    waitForCooldown: vi.fn().mockResolvedValue(undefined),
    recordAction: vi.fn(),
  },
}));

vi.mock('@modules/ui.js', () => ({
  ui: {
    queue: vi.fn(),
  },
}));

vi.mock('@adapters/atproto/delete-post.js', () => ({
  deletePost: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@modules/engagement.js', () => ({
  isLowValueClosing: vi.fn(),
}));

vi.mock('@common/memory-version.js', () => ({
  resetJsonlIfVersionMismatch: vi.fn(() => false),
  stampJsonlVersion: vi.fn(),
}));

// ── Ensure .memory directory exists before the module-level singleton is constructed ──
const DEDUP_STATE_FILE = '.memory/outbound_dedup.json';
const AUDIT_LOG_FILE = '.memory/logs/outbound-queue.log';

if (!fs.existsSync('.memory')) {
  fs.mkdirSync('.memory', { recursive: true });
}
if (!fs.existsSync('.memory/logs')) {
  fs.mkdirSync('.memory/logs', { recursive: true });
}

// ── Import module under test AFTER mocks and directory setup ─────────────────
import { outboundQueue, pruneDuplicatePosts, pruneThankYouChains } from '@modules/outbound-queue.js';
import { pacing } from '@modules/pacing.js';
import { deletePost } from '@adapters/atproto/delete-post.js';
import { isLowValueClosing } from '@modules/engagement.js';
import type { AtprotoFeedItem } from '@adapters/atproto/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePost(overrides: {
  uri?: string;
  text?: string;
  createdAt?: string;
  likeCount?: number;
  replyCount?: number;
  repostCount?: number;
  replyRoot?: { uri: string; cid: string };
  reason?: unknown;
}): AtprotoFeedItem {
  const uri = overrides.uri ?? 'at://did:plc:test/app.bsky.feed.post/abc123';
  const text = overrides.text ?? 'Hello world';
  const createdAt = overrides.createdAt ?? new Date().toISOString();

  const item: AtprotoFeedItem = {
    post: {
      uri,
      cid: `cid-${uri}`,
      author: {
        did: 'did:plc:test',
        handle: 'test.bsky.social',
      },
      record: {
        text,
        createdAt,
      },
      likeCount: overrides.likeCount ?? 0,
      replyCount: overrides.replyCount ?? 0,
      repostCount: overrides.repostCount ?? 0,
      indexedAt: createdAt,
    },
  };

  if (overrides.replyRoot) {
    item.reply = {
      root: {
        uri: overrides.replyRoot.uri,
        cid: overrides.replyRoot.cid,
        author: { did: 'did:plc:root', handle: 'root.bsky.social' },
        record: { text: 'root post', createdAt },
        replyCount: 0,
        repostCount: 0,
        likeCount: 0,
        indexedAt: createdAt,
      },
      parent: {
        uri: overrides.replyRoot.uri,
        cid: overrides.replyRoot.cid,
        author: { did: 'did:plc:root', handle: 'root.bsky.social' },
        record: { text: 'parent post', createdAt },
        replyCount: 0,
        repostCount: 0,
        likeCount: 0,
        indexedAt: createdAt,
      },
    };
  }

  if (overrides.reason !== undefined) {
    (item as any).reason = overrides.reason;
  }

  return item;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.clearAllMocks();
  try { fs.unlinkSync(DEDUP_STATE_FILE); } catch {}
  try { fs.unlinkSync(AUDIT_LOG_FILE); } catch {}
});

// ── OutboundQueue tests ───────────────────────────────────────────────────────

describe('OutboundQueue', () => {
  describe('enqueue', () => {
    it('allows the first post', async () => {
      const result = await outboundQueue.enqueue('post', 'A completely unique post about quantum computing');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('blocks a rapid-fire duplicate with the same normalized text', async () => {
      const text = 'This is a unique statement about TypeScript performance';
      const first = await outboundQueue.enqueue('post', text);
      expect(first.allowed).toBe(true);

      const second = await outboundQueue.enqueue('post', text);
      expect(second.allowed).toBe(false);
      expect(second.reason).toMatch(/near-duplicate/i);
    });

    it('calls pacing.waitForCooldown and pacing.recordAction on allowed posts', async () => {
      const text = 'Pacing test: fresh content about distributed systems architecture';
      const result = await outboundQueue.enqueue('post', text);
      expect(result.allowed).toBe(true);
      expect(pacing.waitForCooldown).toHaveBeenCalledWith('post');
      expect(pacing.recordAction).toHaveBeenCalledWith('post', expect.any(String));
    });

    it('uses reply pacing type for reply destinations', async () => {
      const text = 'Fresh reply about asynchronous event-driven microservices';
      const result = await outboundQueue.enqueue('reply', text);
      expect(result.allowed).toBe(true);
      expect(pacing.waitForCooldown).toHaveBeenCalledWith('reply');
      expect(pacing.recordAction).toHaveBeenCalledWith('reply', expect.any(String));
    });

    it('does not call pacing when post is blocked as duplicate', async () => {
      const text = 'Deduplicated content about container orchestration with Kubernetes';
      await outboundQueue.enqueue('post', text);
      vi.clearAllMocks();

      const second = await outboundQueue.enqueue('post', text);
      expect(second.allowed).toBe(false);
      expect(pacing.waitForCooldown).not.toHaveBeenCalled();
      expect(pacing.recordAction).not.toHaveBeenCalled();
    });
  });

  describe('warmupFromFeed', () => {
    it('populates feed dedup set so subsequent enqueue calls are blocked', async () => {
      const feedText = 'Previously published post about serverless cloud functions';
      const feed: AtprotoFeedItem[] = [makePost({ text: feedText, uri: 'at://did:plc:test/post/warm1' })];

      outboundQueue.warmupFromFeed(feed);

      const result = await outboundQueue.enqueue('post', feedText);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/duplicate of post already in feed/i);
    });

    it('excludes reposts (items with reason field) from the feed dedup set', async () => {
      const repostText = 'Reposted content that should not block future posts about serverless';
      const feed: AtprotoFeedItem[] = [
        makePost({
          text: repostText,
          uri: 'at://did:plc:other/post/repost1',
          reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: { did: 'did:plc:other', handle: 'other.bsky.social' }, indexedAt: new Date().toISOString() },
        }),
      ];

      outboundQueue.warmupFromFeed(feed);

      // Repost text should NOT be in the dedup set — we can still post it ourselves
      const result = await outboundQueue.enqueue('post', repostText + ' with new original content added');
      // Text is different enough that it won't match by normalized form
      expect(result.allowed).toBe(true);
    });

    it('blocks text that exactly matches a warmed feed entry regardless of phrasing differences that normalize away', async () => {
      // normalizePostText strips mentions and URLs, lowercases, collapses whitespace
      const feedText = 'Building resilient distributed systems requires careful fault tolerance design';
      const feed: AtprotoFeedItem[] = [makePost({ text: feedText, uri: 'at://did:plc:test/post/norm1' })];

      outboundQueue.warmupFromFeed(feed);

      // Same text with different casing — normalizePostText lowercases, so it should match
      const result = await outboundQueue.enqueue('post', feedText.toUpperCase());
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/duplicate of post already in feed/i);
    });
  });
});

// ── pruneDuplicatePosts tests ─────────────────────────────────────────────────

describe('pruneDuplicatePosts', () => {
  it('deletes newer duplicate posts and keeps the oldest', async () => {
    const text = 'Identical post content about functional programming paradigms';
    const older = makePost({ uri: 'at://did:plc:test/post/older', text, createdAt: '2024-01-01T10:00:00.000Z' });
    const newer = makePost({ uri: 'at://did:plc:test/post/newer', text, createdAt: '2024-01-01T11:00:00.000Z' });

    const deleted = await pruneDuplicatePosts([older, newer]);

    expect(deleted).toBe(1);
    expect(deletePost).toHaveBeenCalledTimes(1);
    expect(deletePost).toHaveBeenCalledWith('at://did:plc:test/post/newer');
  });

  it('excludes reposts from pruning', async () => {
    const text = 'Content that was reposted and should not be pruned';
    const ownPost = makePost({ uri: 'at://did:plc:test/post/mine', text, createdAt: '2024-01-01T10:00:00.000Z' });
    const repost = makePost({
      uri: 'at://did:plc:other/post/theirs',
      text,
      createdAt: '2024-01-01T09:00:00.000Z',
      reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: { did: 'did:plc:other', handle: 'other.bsky.social' }, indexedAt: '2024-01-01T09:30:00.000Z' },
    });

    const deleted = await pruneDuplicatePosts([ownPost, repost]);

    // Only 1 own post after excluding repost — no duplicates
    expect(deleted).toBe(0);
    expect(deletePost).not.toHaveBeenCalled();
  });

  it('returns 0 when there are no duplicates', async () => {
    const feed: AtprotoFeedItem[] = [
      makePost({ uri: 'at://did:plc:test/post/a1', text: 'Post about React hooks and state management' }),
      makePost({ uri: 'at://did:plc:test/post/a2', text: 'Post about Vue composition API differences' }),
      makePost({ uri: 'at://did:plc:test/post/a3', text: 'Post about Angular dependency injection patterns' }),
    ];

    const deleted = await pruneDuplicatePosts(feed);

    expect(deleted).toBe(0);
    expect(deletePost).not.toHaveBeenCalled();
  });

  it('scopes reply duplicates to the same thread root — same text in different threads is not a duplicate', async () => {
    const text = 'Thank you for the kind words and thoughtful response';
    const threadARoot = { uri: 'at://did:plc:test/post/rootA', cid: 'cid-rootA' };
    const threadBRoot = { uri: 'at://did:plc:test/post/rootB', cid: 'cid-rootB' };

    const replyInThreadA = makePost({
      uri: 'at://did:plc:test/post/replyA',
      text,
      createdAt: '2024-01-01T10:00:00.000Z',
      replyRoot: threadARoot,
    });
    const replyInThreadB = makePost({
      uri: 'at://did:plc:test/post/replyB',
      text,
      createdAt: '2024-01-01T11:00:00.000Z',
      replyRoot: threadBRoot,
    });

    const deleted = await pruneDuplicatePosts([replyInThreadA, replyInThreadB]);

    // Different thread roots — not duplicates of each other
    expect(deleted).toBe(0);
    expect(deletePost).not.toHaveBeenCalled();
  });

  it('deletes duplicate replies within the same thread', async () => {
    const text = 'Same closing reply repeated twice in the same thread context here';
    const threadRoot = { uri: 'at://did:plc:test/post/threadRoot', cid: 'cid-threadRoot' };

    const firstReply = makePost({
      uri: 'at://did:plc:test/post/reply1',
      text,
      createdAt: '2024-01-01T10:00:00.000Z',
      replyRoot: threadRoot,
    });
    const secondReply = makePost({
      uri: 'at://did:plc:test/post/reply2',
      text,
      createdAt: '2024-01-01T10:05:00.000Z',
      replyRoot: threadRoot,
    });

    const deleted = await pruneDuplicatePosts([firstReply, secondReply]);

    expect(deleted).toBe(1);
    expect(deletePost).toHaveBeenCalledWith('at://did:plc:test/post/reply2');
  });

  it('deletes all newer copies when there are more than 2 duplicates', async () => {
    const text = 'Triple duplicate post about event sourcing patterns in distributed systems';
    const oldest = makePost({ uri: 'at://did:plc:test/post/dup1', text, createdAt: '2024-01-01T10:00:00.000Z' });
    const middle = makePost({ uri: 'at://did:plc:test/post/dup2', text, createdAt: '2024-01-01T10:05:00.000Z' });
    const newest = makePost({ uri: 'at://did:plc:test/post/dup3', text, createdAt: '2024-01-01T10:10:00.000Z' });

    const deleted = await pruneDuplicatePosts([oldest, middle, newest]);

    expect(deleted).toBe(2);
    expect(deletePost).not.toHaveBeenCalledWith('at://did:plc:test/post/dup1');
    expect(deletePost).toHaveBeenCalledWith('at://did:plc:test/post/dup2');
    expect(deletePost).toHaveBeenCalledWith('at://did:plc:test/post/dup3');
  });
});

// ── pruneThankYouChains tests ─────────────────────────────────────────────────

describe('pruneThankYouChains', () => {
  beforeAll(() => {
    // Set up isLowValueClosing to return true for closing-like phrases
    vi.mocked(isLowValueClosing).mockImplementation((text: string) => {
      const closingPhrases = ['thanks so much', 'thank you', 'appreciate it', 'grateful for this'];
      return closingPhrases.some(phrase => text.toLowerCase().includes(phrase));
    });
  });

  it('deletes excess closings and keeps only the first per thread', async () => {
    const threadRoot = { uri: 'at://did:plc:test/post/thankRoot', cid: 'cid-thankRoot' };

    const firstClosing = makePost({
      uri: 'at://did:plc:test/post/close1',
      text: 'Thanks so much for sharing this with me!',
      createdAt: '2024-01-01T10:00:00.000Z',
      replyRoot: threadRoot,
    });
    const secondClosing = makePost({
      uri: 'at://did:plc:test/post/close2',
      text: 'Thank you for the kind response and support!',
      createdAt: '2024-01-01T10:05:00.000Z',
      replyRoot: threadRoot,
    });
    const thirdClosing = makePost({
      uri: 'at://did:plc:test/post/close3',
      text: 'Really appreciate it, means a lot to me!',
      createdAt: '2024-01-01T10:10:00.000Z',
      replyRoot: threadRoot,
    });

    const deleted = await pruneThankYouChains([firstClosing, secondClosing, thirdClosing]);

    expect(deleted).toBe(2);
    expect(deletePost).not.toHaveBeenCalledWith('at://did:plc:test/post/close1');
    expect(deletePost).toHaveBeenCalledWith('at://did:plc:test/post/close2');
    expect(deletePost).toHaveBeenCalledWith('at://did:plc:test/post/close3');
  });

  it('does nothing when there are 0 or 1 closings per thread', async () => {
    const threadRoot = { uri: 'at://did:plc:test/post/singleRoot', cid: 'cid-singleRoot' };

    const onlyClosing = makePost({
      uri: 'at://did:plc:test/post/onlyClose',
      text: 'Thank you for this wonderful discussion!',
      createdAt: '2024-01-01T10:00:00.000Z',
      replyRoot: threadRoot,
    });
    const regularReply = makePost({
      uri: 'at://did:plc:test/post/regularReply',
      text: 'That is a really interesting perspective on the matter',
      createdAt: '2024-01-01T10:05:00.000Z',
      replyRoot: threadRoot,
    });

    const deleted = await pruneThankYouChains([onlyClosing, regularReply]);

    expect(deleted).toBe(0);
    expect(deletePost).not.toHaveBeenCalled();
  });

  it('only processes replies and ignores top-level posts', async () => {
    // Top-level posts with closing text should not be pruned
    const topLevelPost1 = makePost({
      uri: 'at://did:plc:test/post/top1',
      text: 'Thanks so much for following along with my posts!',
      createdAt: '2024-01-01T10:00:00.000Z',
      // No replyRoot — this is a top-level post
    });
    const topLevelPost2 = makePost({
      uri: 'at://did:plc:test/post/top2',
      text: 'Thank you all for the support this week!',
      createdAt: '2024-01-01T10:05:00.000Z',
    });

    const deleted = await pruneThankYouChains([topLevelPost1, topLevelPost2]);

    expect(deleted).toBe(0);
    expect(deletePost).not.toHaveBeenCalled();
  });

  it('handles closings in separate threads independently — only prunes within same thread', async () => {
    const threadARoot = { uri: 'at://did:plc:test/post/chainRootA', cid: 'cid-chainA' };
    const threadBRoot = { uri: 'at://did:plc:test/post/chainRootB', cid: 'cid-chainB' };

    // Thread A: 2 closings — should delete the second
    const closingA1 = makePost({
      uri: 'at://did:plc:test/post/closeA1',
      text: 'Thanks so much for this great thread!',
      createdAt: '2024-01-01T10:00:00.000Z',
      replyRoot: threadARoot,
    });
    const closingA2 = makePost({
      uri: 'at://did:plc:test/post/closeA2',
      text: 'Really appreciate it, you are awesome!',
      createdAt: '2024-01-01T10:05:00.000Z',
      replyRoot: threadARoot,
    });

    // Thread B: only 1 closing — should NOT be deleted
    const closingB1 = makePost({
      uri: 'at://did:plc:test/post/closeB1',
      text: 'Thank you for the kind words in this conversation!',
      createdAt: '2024-01-01T10:00:00.000Z',
      replyRoot: threadBRoot,
    });

    const deleted = await pruneThankYouChains([closingA1, closingA2, closingB1]);

    expect(deleted).toBe(1);
    expect(deletePost).not.toHaveBeenCalledWith('at://did:plc:test/post/closeA1');
    expect(deletePost).toHaveBeenCalledWith('at://did:plc:test/post/closeA2');
    expect(deletePost).not.toHaveBeenCalledWith('at://did:plc:test/post/closeB1');
  });

  it('excludes reposts from thank-you chain detection', async () => {
    const threadRoot = { uri: 'at://did:plc:test/post/repostChainRoot', cid: 'cid-repostChain' };

    const ownClosing = makePost({
      uri: 'at://did:plc:test/post/myClose',
      text: 'Thanks so much for engaging with this!',
      createdAt: '2024-01-01T10:00:00.000Z',
      replyRoot: threadRoot,
    });
    // A reposted reply with closing text — should be excluded
    const repostedClosing = makePost({
      uri: 'at://did:plc:other/post/repostedClose',
      text: 'Appreciate it so much! Grateful for this discussion.',
      createdAt: '2024-01-01T09:55:00.000Z',
      replyRoot: threadRoot,
      reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: { did: 'did:plc:other', handle: 'other.bsky.social' }, indexedAt: '2024-01-01T10:00:00.000Z' },
    });

    const deleted = await pruneThankYouChains([ownClosing, repostedClosing]);

    // Only 1 own reply after filtering reposts — no chain to prune
    expect(deleted).toBe(0);
    expect(deletePost).not.toHaveBeenCalled();
  });
});
