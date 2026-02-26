import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

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
  resetJsonlIfVersionMismatch: vi.fn(() => false),
  stampJsonlVersion: vi.fn(),
}));

import {
  logPost,
  lookupPostByUri,
  lookupPostByBskyUrl,
  generatePostContext,
  formatSourceAttribution,
  hasCompleteAttribution,
  getPostsNeedingAttributionFollowup,
  markPostNeedsAttributionFollowup,
  updatePostAttribution,
  type PostLogEntry,
} from './post-log.js';

const POST_LOG_PATH = '.memory/post_log.jsonl';

function cleanupFile() {
  try { fs.unlinkSync(POST_LOG_PATH); } catch {}
}

function makeEntry(overrides: Partial<PostLogEntry> = {}): PostLogEntry {
  return {
    timestamp: new Date().toISOString(),
    bluesky: {
      post_uri: 'at://did:plc:test123/app.bsky.feed.post/abc123',
      post_cid: 'bafyreitest123',
      bsky_url: 'https://bsky.app/profile/test.bsky.social/post/abc123',
    },
    source: {
      type: 'arena',
      channel_url: 'https://www.are.na/test-user/test-channel',
      block_id: 12345,
      block_url: 'https://www.are.na/block/12345',
      block_title: 'Test Block Title',
      filename: 'test-image.jpg',
      original_url: 'https://example.com/original-image',
      source_provider: 'Dribbble',
      arena_user: { username: 'testuser', full_name: 'Test User' },
    },
    content: {
      post_text: 'Check out this image',
      alt_text: 'A beautiful test image',
    },
    why_picked: 'It caught my eye because of its composition',
    ...overrides,
  };
}

describe('post-log', () => {
  beforeEach(() => {
    if (!fs.existsSync('.memory')) {
      fs.mkdirSync('.memory', { recursive: true });
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupFile();
  });

  // ---------------------------------------------------------------------------
  // logPost
  // ---------------------------------------------------------------------------
  describe('logPost', () => {
    it('writes entry to JSONL file', () => {
      const entry = makeEntry();
      const result = logPost(entry);

      expect(result).toBe(true);
      expect(fs.existsSync(POST_LOG_PATH)).toBe(true);

      const content = fs.readFileSync(POST_LOG_PATH, 'utf8').trim();
      const parsed = JSON.parse(content) as PostLogEntry;
      expect(parsed.bluesky.post_uri).toBe(entry.bluesky.post_uri);
      expect(parsed.bluesky.bsky_url).toBe(entry.bluesky.bsky_url);
      expect(parsed.content.post_text).toBe(entry.content.post_text);
    });

    it('appends multiple entries', () => {
      const entry1 = makeEntry({
        bluesky: {
          post_uri: 'at://did:plc:test/app.bsky.feed.post/post001',
          post_cid: 'cid001',
          bsky_url: 'https://bsky.app/profile/test/post/post001',
        },
      });
      const entry2 = makeEntry({
        bluesky: {
          post_uri: 'at://did:plc:test/app.bsky.feed.post/post002',
          post_cid: 'cid002',
          bsky_url: 'https://bsky.app/profile/test/post/post002',
        },
      });

      logPost(entry1);
      logPost(entry2);

      const content = fs.readFileSync(POST_LOG_PATH, 'utf8').trim();
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(2);

      const parsed1 = JSON.parse(lines[0]) as PostLogEntry;
      const parsed2 = JSON.parse(lines[1]) as PostLogEntry;
      expect(parsed1.bluesky.post_uri).toBe(entry1.bluesky.post_uri);
      expect(parsed2.bluesky.post_uri).toBe(entry2.bluesky.post_uri);
    });
  });

  // ---------------------------------------------------------------------------
  // lookupPostByUri
  // ---------------------------------------------------------------------------
  describe('lookupPostByUri', () => {
    it('finds the correct entry by AT URI', () => {
      const target_uri = 'at://did:plc:test/app.bsky.feed.post/target';
      const entry = makeEntry({
        bluesky: {
          post_uri: target_uri,
          post_cid: 'cid-target',
          bsky_url: 'https://bsky.app/profile/test/post/target',
        },
      });

      logPost(makeEntry({
        bluesky: {
          post_uri: 'at://did:plc:test/app.bsky.feed.post/other',
          post_cid: 'cid-other',
          bsky_url: 'https://bsky.app/profile/test/post/other',
        },
      }));
      logPost(entry);

      const found = lookupPostByUri(target_uri);
      expect(found).not.toBeNull();
      expect(found!.bluesky.post_uri).toBe(target_uri);
    });

    it('returns null when URI is not found', () => {
      logPost(makeEntry());

      const found = lookupPostByUri('at://did:plc:test/app.bsky.feed.post/nonexistent');
      expect(found).toBeNull();
    });

    it('returns null when file does not exist', () => {
      // Ensure file does not exist
      cleanupFile();

      const found = lookupPostByUri('at://did:plc:test/app.bsky.feed.post/any');
      expect(found).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // lookupPostByBskyUrl
  // ---------------------------------------------------------------------------
  describe('lookupPostByBskyUrl', () => {
    it('finds the correct entry by bsky URL', () => {
      const target_url = 'https://bsky.app/profile/test.bsky.social/post/uniqueurl';
      const entry = makeEntry({
        bluesky: {
          post_uri: 'at://did:plc:test/app.bsky.feed.post/uniqueurl',
          post_cid: 'cid-unique',
          bsky_url: target_url,
        },
      });

      logPost(makeEntry());
      logPost(entry);

      const found = lookupPostByBskyUrl(target_url);
      expect(found).not.toBeNull();
      expect(found!.bluesky.bsky_url).toBe(target_url);
    });
  });

  // ---------------------------------------------------------------------------
  // generatePostContext
  // ---------------------------------------------------------------------------
  describe('generatePostContext', () => {
    it('includes arena source info', () => {
      const entry = makeEntry({
        source: {
          type: 'arena',
          channel_url: 'https://www.are.na/user/channel',
          block_url: 'https://www.are.na/block/99999',
          block_title: 'My Arena Block',
          filename: 'cool-image.jpg',
          original_url: 'https://original.com/image',
          source_provider: 'Behance',
        },
      });

      const context = generatePostContext(entry);

      expect(context).toContain('Are.na');
      expect(context).toContain('https://www.are.na/user/channel');
      expect(context).toContain('My Arena Block');
      expect(context).toContain('https://www.are.na/block/99999');
      expect(context).toContain('cool-image.jpg');
      expect(context).toContain('https://original.com/image');
      expect(context).toContain('Behance');
    });

    it('includes searchsystem source info', () => {
      const entry = makeEntry({
        source: {
          type: 'searchsystem',
          post_url: 'https://searchsystem.co/post/12345',
          block_title: 'SearchSystem Post Title',
          tags: ['design', 'typography'],
        },
      });

      const context = generatePostContext(entry);

      expect(context).toContain('SearchSystem.co');
      expect(context).toContain('https://searchsystem.co/post/12345');
      expect(context).toContain('SearchSystem Post Title');
      expect(context).toContain('design, typography');
    });

    it('includes web source info', () => {
      const entry = makeEntry({
        source: {
          type: 'web',
          page_title: 'Awesome Design Blog',
          page_url: 'https://designblog.example.com/post/123',
          image_url: 'https://designblog.example.com/images/photo.jpg',
        },
      });

      const context = generatePostContext(entry);

      expect(context).toContain('Awesome Design Blog');
      expect(context).toContain('https://designblog.example.com/post/123');
      expect(context).toContain('https://designblog.example.com/images/photo.jpg');
    });

    it('includes why_picked when set', () => {
      const entry = makeEntry({ why_picked: 'The colors are absolutely stunning' });

      const context = generatePostContext(entry);

      expect(context).toContain('The colors are absolutely stunning');
    });

    it('includes timing context', () => {
      // Posted just now
      const justNow = makeEntry({ timestamp: new Date().toISOString() });
      const contextNow = generatePostContext(justNow);
      expect(contextNow).toContain('Posted just now');

      // Posted 3 hours ago
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const oldEntry = makeEntry({ timestamp: threeHoursAgo });
      const contextOld = generatePostContext(oldEntry);
      expect(contextOld).toMatch(/Posted \d+ hour/);

      // Posted 2 days ago
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const oldDayEntry = makeEntry({ timestamp: twoDaysAgo });
      const contextDays = generatePostContext(oldDayEntry);
      expect(contextDays).toMatch(/Posted \d+ day/);
    });
  });

  // ---------------------------------------------------------------------------
  // formatSourceAttribution
  // ---------------------------------------------------------------------------
  describe('formatSourceAttribution', () => {
    it('formats arena attribution with original_url', () => {
      const entry = makeEntry({
        source: {
          type: 'arena',
          original_url: 'https://artist.com/portfolio',
        },
      });

      const attribution = formatSourceAttribution(entry);

      expect(attribution).toContain('Source: https://artist.com/portfolio');
    });

    it('formats arena attribution with block_url only (no original_url)', () => {
      const entry = makeEntry({
        source: {
          type: 'arena',
          block_url: 'https://www.are.na/block/55555',
          filename: 'mystery-file.png',
        },
      });

      const attribution = formatSourceAttribution(entry);

      expect(attribution).toContain('Source: https://www.are.na/block/55555');
      expect(attribution).toContain('mystery-file.png');
    });

    it('formats arena attribution with both original_url and block_url', () => {
      const entry = makeEntry({
        source: {
          type: 'arena',
          original_url: 'https://creator.io/work',
          block_url: 'https://www.are.na/block/77777',
        },
      });

      const attribution = formatSourceAttribution(entry);

      expect(attribution).toContain('Source: https://creator.io/work');
      expect(attribution).toContain('via Are.na: https://www.are.na/block/77777');
    });
  });

  // ---------------------------------------------------------------------------
  // hasCompleteAttribution
  // ---------------------------------------------------------------------------
  describe('hasCompleteAttribution', () => {
    it('returns true when original_url exists', () => {
      const entry = makeEntry({
        source: { type: 'arena', original_url: 'https://some-creator.com' },
      });

      expect(hasCompleteAttribution(entry)).toBe(true);
    });

    it('returns false when original_url is absent', () => {
      const entry = makeEntry({
        source: { type: 'arena' },
      });

      expect(hasCompleteAttribution(entry)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getPostsNeedingAttributionFollowup
  // ---------------------------------------------------------------------------
  describe('getPostsNeedingAttributionFollowup', () => {
    it('returns posts flagged as needing attribution followup', () => {
      const flaggedEntry = makeEntry({
        bluesky: {
          post_uri: 'at://did:plc:test/app.bsky.feed.post/flagged',
          post_cid: 'cid-flagged',
          bsky_url: 'https://bsky.app/profile/test/post/flagged',
        },
        source: {
          type: 'arena',
          block_url: 'https://www.are.na/block/11111',
          needs_attribution_followup: true,
          attribution_notes: 'Could not find original creator',
        },
      });
      const normalEntry = makeEntry({
        bluesky: {
          post_uri: 'at://did:plc:test/app.bsky.feed.post/normal',
          post_cid: 'cid-normal',
          bsky_url: 'https://bsky.app/profile/test/post/normal',
        },
        source: {
          type: 'arena',
          original_url: 'https://known-creator.com',
          needs_attribution_followup: false,
        },
      });

      logPost(flaggedEntry);
      logPost(normalEntry);

      const results = getPostsNeedingAttributionFollowup();

      expect(results).toHaveLength(1);
      expect(results[0].bluesky.post_uri).toBe('at://did:plc:test/app.bsky.feed.post/flagged');
    });

    it('respects the limit parameter', () => {
      // Create 5 flagged entries
      for (let i = 0; i < 5; i++) {
        logPost(makeEntry({
          bluesky: {
            post_uri: `at://did:plc:test/app.bsky.feed.post/flagged${i}`,
            post_cid: `cid-flagged${i}`,
            bsky_url: `https://bsky.app/profile/test/post/flagged${i}`,
          },
          source: {
            type: 'arena',
            needs_attribution_followup: true,
          },
        }));
      }

      const results = getPostsNeedingAttributionFollowup(3);

      expect(results).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // markPostNeedsAttributionFollowup
  // ---------------------------------------------------------------------------
  describe('markPostNeedsAttributionFollowup', () => {
    it('updates the needs_attribution_followup flag on the correct entry', () => {
      const target_uri = 'at://did:plc:test/app.bsky.feed.post/mark-target';
      const entry = makeEntry({
        bluesky: {
          post_uri: target_uri,
          post_cid: 'cid-mark',
          bsky_url: 'https://bsky.app/profile/test/post/mark-target',
        },
        source: { type: 'arena', needs_attribution_followup: false },
      });

      logPost(entry);
      const success = markPostNeedsAttributionFollowup(target_uri, true, 'Needs follow-up');

      expect(success).toBe(true);

      const updated = lookupPostByUri(target_uri);
      expect(updated).not.toBeNull();
      expect(updated!.source.needs_attribution_followup).toBe(true);
      expect(updated!.source.attribution_notes).toBe('Needs follow-up');
    });

    it('returns false when the post URI does not exist', () => {
      logPost(makeEntry());

      const result = markPostNeedsAttributionFollowup(
        'at://did:plc:test/app.bsky.feed.post/nonexistent',
        true
      );

      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // updatePostAttribution
  // ---------------------------------------------------------------------------
  describe('updatePostAttribution', () => {
    it('updates original_url and clears the followup flag', () => {
      const target_uri = 'at://did:plc:test/app.bsky.feed.post/attrib-target';
      const entry = makeEntry({
        bluesky: {
          post_uri: target_uri,
          post_cid: 'cid-attrib',
          bsky_url: 'https://bsky.app/profile/test/post/attrib-target',
        },
        source: {
          type: 'arena',
          block_url: 'https://www.are.na/block/99999',
          needs_attribution_followup: true,
          attribution_notes: 'Could not find creator',
        },
      });

      logPost(entry);
      const success = updatePostAttribution(
        target_uri,
        'https://found-creator.com/work',
        'Found the creator on their portfolio site'
      );

      expect(success).toBe(true);

      const updated = lookupPostByUri(target_uri);
      expect(updated).not.toBeNull();
      expect(updated!.source.original_url).toBe('https://found-creator.com/work');
      expect(updated!.source.needs_attribution_followup).toBe(false);
      expect(updated!.source.attribution_notes).toBe('Found the creator on their portfolio site');
    });

    it('returns false when post URI does not exist', () => {
      logPost(makeEntry());

      const result = updatePostAttribution(
        'at://did:plc:test/app.bsky.feed.post/nonexistent',
        'https://some-url.com'
      );

      expect(result).toBe(false);
    });
  });
});
