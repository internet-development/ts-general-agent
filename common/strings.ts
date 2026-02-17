//NOTE(self): Shared string utilities used across the codebase
//NOTE(self): createSlug for URL/branch-safe identifiers, isEmpty for robust empty checks
//NOTE(self): truncateGraphemes for portable text truncation (Bluesky + Are.na share 300 grapheme limit)

import { graphemeLen } from '@atproto/common-web';

export const PORTABLE_MAX_GRAPHEMES = 300;

export function isEmpty(text: any): boolean {
  // NOTE(jimmylee):
  // If a number gets passed in, it isn't considered empty for zero.
  if (text === 0) {
    return false;
  }

  if (!text) {
    return true;
  }

  if (typeof text === 'object') {
    return true;
  }

  if (text.length === 0) {
    return true;
  }

  text = text.toString();

  return Boolean(!text.trim());
}

export function createSlug(text: any): string {
  if (isEmpty(text)) {
    return 'untitled';
  }

  const a = 'æøåàáäâèéëêìíïîòóöôùúüûñçßÿœæŕśńṕẃǵǹḿǘẍźḧ·/_,:;';
  const b = 'aoaaaaaeeeeiiiioooouuuuncsyoarsnpwgnmuxzh------';
  const p = new RegExp(a.split('').join('|'), 'g');

  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(p, (c: string) => b.charAt(a.indexOf(c)))
    .replace(/&/g, '-and-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

//NOTE(self): Ensure a URL has a protocol prefix so Bluesky creates a clickable link facet
//NOTE(self): Bare "github.com/..." becomes "https://github.com/..." — use this when building post text
export function ensureHttps(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

//NOTE(self): Normalize post text for dedup comparison
//NOTE(self): Strips @mentions, lowercases, collapses whitespace, takes first 50 chars
//NOTE(self): Used by outbound queue (pre-send) and dupe cleanup (post-send)
export function normalizePostText(text: string): string {
  return text
    .toLowerCase()
    .replace(/@[\w.-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
}

//NOTE(self): Truncate text to a grapheme limit, preserving whole grapheme clusters
//NOTE(self): Used wherever text may flow to Bluesky (300 grapheme limit) or similar services
export function truncateGraphemes(text: string, maxGraphemes: number = PORTABLE_MAX_GRAPHEMES): string {
  if (graphemeLen(text) <= maxGraphemes) return text;

  //NOTE(self): Binary search for the right cut point since grapheme clusters can be multi-byte
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (graphemeLen(text.slice(0, mid)) <= maxGraphemes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo);
}
