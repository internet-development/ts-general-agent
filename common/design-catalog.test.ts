import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getRandomDesignSource,
  getRandomBrowseUrl,
  type DesignSource,
} from './design-catalog.js';

describe('design-catalog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getRandomDesignSource', () => {
    it('returns a valid DesignSource object', () => {
      const source = getRandomDesignSource();

      expect(source).toBeDefined();
      expect(typeof source.type).toBe('string');
      expect(['arena', 'web']).toContain(source.type);
      expect(typeof source.url).toBe('string');
      expect(source.url).toMatch(/^https?:\/\//);
      expect(typeof source.name).toBe('string');
      expect(source.name.length).toBeGreaterThan(0);
    });

    it('always returns one of the catalog entries', () => {
      // Call multiple times to increase confidence
      for (let i = 0; i < 20; i++) {
        const source = getRandomDesignSource();
        expect(source.type).toMatch(/^(arena|web)$/);
        expect(source.url).toBeTruthy();
        expect(source.name).toBeTruthy();
      }
    });
  });

  describe('getRandomBrowseUrl', () => {
    it('returns from browseUrls when available', () => {
      const source: DesignSource = {
        type: 'web',
        url: 'https://example.com',
        name: 'Test Source',
        browseUrls: [
          'https://example.com/page1',
          'https://example.com/page2',
          'https://example.com/page3',
        ],
      };

      // Call multiple times; result must always be from browseUrls
      for (let i = 0; i < 20; i++) {
        const result = getRandomBrowseUrl(source);
        expect(source.browseUrls).toContain(result);
      }
    });

    it('falls back to source.url when browseUrls is undefined', () => {
      const source: DesignSource = {
        type: 'arena',
        url: 'https://example.com/fallback',
        name: 'No Browse URLs',
      };

      const result = getRandomBrowseUrl(source);
      expect(result).toBe('https://example.com/fallback');
    });

    it('falls back to source.url when browseUrls is empty', () => {
      const source: DesignSource = {
        type: 'web',
        url: 'https://example.com/fallback',
        name: 'Empty Browse URLs',
        browseUrls: [],
      };

      const result = getRandomBrowseUrl(source);
      expect(result).toBe('https://example.com/fallback');
    });
  });
});
