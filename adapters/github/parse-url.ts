//NOTE(self): Parse GitHub URLs to extract owner, repo, type, and number
//NOTE(self): Handles issues, PRs, and discussions

import { logger } from '@modules/logger.js';

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  type: 'issue' | 'pull' | 'discussion';
  number: number;
  url: string;
}

//NOTE(self): Match GitHub issue/PR/discussion URLs
//NOTE(self): Formats:
//NOTE(self): - https://github.com/owner/repo/issues/123
//NOTE(self): - https://github.com/owner/repo/pull/456
//NOTE(self): - https://github.com/owner/repo/discussions/789
//NOTE(self): - github.com/owner/repo/issues/123 (without https://)
const GITHUB_URL_REGEX = /(?:https?:\/\/)?github\.com\/([^\/]+)\/([^\/]+)\/(issues|pull|discussions)\/(\d+)/gi;

/**
 * Parse a single GitHub URL
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  const regex = /(?:https?:\/\/)?github\.com\/([^\/]+)\/([^\/]+)\/(issues|pull|discussions)\/(\d+)/i;
  const match = url.match(regex);

  if (!match) return null;

  const [fullMatch, owner, repo, typeStr, numberStr] = match;
  const type = typeStr.toLowerCase() === 'pull' ? 'pull' :
               typeStr.toLowerCase() === 'discussions' ? 'discussion' : 'issue';

  return {
    owner,
    repo,
    type,
    number: parseInt(numberStr, 10),
    url: fullMatch.startsWith('http') ? fullMatch : `https://${fullMatch}`,
  };
}

/**
 * Extract all GitHub URLs from text
 */
export function extractGitHubUrls(text: string): ParsedGitHubUrl[] {
  const results: ParsedGitHubUrl[] = [];
  const seen = new Set<string>();

  //NOTE(self): Reset regex state
  GITHUB_URL_REGEX.lastIndex = 0;

  let match;
  while ((match = GITHUB_URL_REGEX.exec(text)) !== null) {
    const [fullMatch, owner, repo, typeStr, numberStr] = match;
    const type = typeStr.toLowerCase() === 'pull' ? 'pull' :
                 typeStr.toLowerCase() === 'discussions' ? 'discussion' : 'issue';

    //NOTE(self): Deduplicate by owner/repo/type/number
    const key = `${owner}/${repo}/${type}/${numberStr}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      owner,
      repo,
      type,
      number: parseInt(numberStr, 10),
      url: fullMatch.startsWith('http') ? fullMatch : `https://${fullMatch}`,
    });
  }

  return results;
}

/**
 * Check if text contains any GitHub URLs
 */
export function hasGitHubUrls(text: string): boolean {
  GITHUB_URL_REGEX.lastIndex = 0;
  return GITHUB_URL_REGEX.test(text);
}

/**
 * Extract GitHub URLs from a Bluesky post record
 * //NOTE(self): CRITICAL - Bluesky truncates URLs in displayed text!
 * //NOTE(self): A truncated URL like "issues/12..." might parse as issue #12 when it's really #123
 * //NOTE(self):
 * //NOTE(self): Priority order (STOP as soon as we find GitHub URLs):
 * //NOTE(self): 1. facets (rich text link features) - AUTHORITATIVE, full URLs
 * //NOTE(self): 2. embed.external.uri (link preview card) - AUTHORITATIVE, full URL
 * //NOTE(self): 3. text (ONLY if nothing found above) - may be truncated, last resort
 */
export function extractGitHubUrlsFromRecord(record: Record<string, unknown>): ParsedGitHubUrl[] {
  const seen = new Set<string>();

  //NOTE(self): Helper to parse and deduplicate
  const parseAndAdd = (url: string, results: ParsedGitHubUrl[]): boolean => {
    const parsed = parseGitHubUrl(url);
    if (parsed) {
      const key = `${parsed.owner}/${parsed.repo}/${parsed.type}/${parsed.number}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(parsed);
        return true;
      }
    }
    return false;
  };

  //NOTE(self): Cast to access known Bluesky record fields
  const post = record as {
    text?: string;
    facets?: Array<{
      features?: Array<{
        $type?: string;
        uri?: string;
      }>;
    }>;
    embed?: {
      $type?: string;
      external?: {
        uri?: string;
      };
      media?: {
        external?: {
          uri?: string;
        };
      };
    };
  };

  //NOTE(self): STEP 1 - Check facets (rich text links) - these are AUTHORITATIVE
  const facetResults: ParsedGitHubUrl[] = [];
  if (post.facets && Array.isArray(post.facets)) {
    for (const facet of post.facets) {
      if (facet.features && Array.isArray(facet.features)) {
        for (const feature of facet.features) {
          if (feature.uri && feature.uri.includes('github.com')) {
            parseAndAdd(feature.uri, facetResults);
          }
        }
      }
    }
  }

  if (facetResults.length > 0) {
    logger.info('Found GitHub URLs in facets (authoritative)', {
      urls: facetResults.map(r => r.url),
    });
    return facetResults;
  }

  //NOTE(self): STEP 2 - Check embed (link preview card) - also AUTHORITATIVE
  const embedResults: ParsedGitHubUrl[] = [];
  if (post.embed) {
    //NOTE(self): Direct external embed
    if (post.embed.external?.uri && post.embed.external.uri.includes('github.com')) {
      parseAndAdd(post.embed.external.uri, embedResults);
    }
    //NOTE(self): Media with external (some embed types nest it)
    if (post.embed.media?.external?.uri && post.embed.media.external.uri.includes('github.com')) {
      parseAndAdd(post.embed.media.external.uri, embedResults);
    }
  }

  if (embedResults.length > 0) {
    logger.info('Found GitHub URLs in embed (authoritative)', {
      urls: embedResults.map(r => r.url),
    });
    return embedResults;
  }

  //NOTE(self): STEP 3 - Fall back to text ONLY if nothing found above
  //NOTE(self): WARNING: Text URLs may be truncated! This is last resort.
  const textResults: ParsedGitHubUrl[] = [];
  if (post.text) {
    const textUrls = extractGitHubUrls(post.text);
    for (const parsed of textUrls) {
      const key = `${parsed.owner}/${parsed.repo}/${parsed.type}/${parsed.number}`;
      if (!seen.has(key)) {
        seen.add(key);
        textResults.push(parsed);
      }
    }
  }

  if (textResults.length > 0) {
    logger.warn('Using GitHub URLs from text (may be truncated!)', {
      urls: textResults.map(r => r.url),
      warning: 'No URLs found in facets or embed - text URLs might be truncated',
    });
    return textResults;
  }

  //NOTE(self): Nothing found - log for debugging
  const recordStr = JSON.stringify(record);
  if (recordStr.toLowerCase().includes('github')) {
    logger.debug('Record mentions "github" but no valid URLs extracted', {
      recordPreview: recordStr.slice(0, 500),
    });
  }

  return [];
}
