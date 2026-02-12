//NOTE(self): Local tool to add/remove workspaces from watch list
//NOTE(self): Called when workspace URLs are seen in Bluesky threads

import { logger } from '@modules/logger.js';
import {
  watchWorkspace,
  isWatchingWorkspace,
  parseGitHubWorkspaceUrl,
} from '@modules/github-workspace-discovery.js';

const WORKSPACE_PREFIX = 'www-lil-intdev-';

//NOTE(self): Extract workspace URLs from text (Bluesky post, facets, etc.)
export function extractWorkspaceUrls(text: string): string[] {
  const urls: string[] = [];

  //NOTE(self): Match GitHub repository URLs
  const urlRegex = /https?:\/\/github\.com\/([^\/\s]+)\/([^\/\s\?#]+)/g;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    const repoName = match[2];
    //NOTE(self): Only watch repositories with the workspace prefix
    if (repoName.startsWith(WORKSPACE_PREFIX)) {
      urls.push(match[0]);
    }
  }

  return urls;
}

//NOTE(self): Process text and add any workspace URLs to watch list
export function processTextForWorkspaces(text: string, threadUri?: string): number {
  const urls = extractWorkspaceUrls(text);
  let added = 0;

  for (const url of urls) {
    const parsed = parseGitHubWorkspaceUrl(url);
    if (!parsed) continue;

    if (!isWatchingWorkspace(parsed.owner, parsed.repo)) {
      watchWorkspace(parsed.owner, parsed.repo, url, threadUri);
      added++;
      logger.info('Discovered workspace in thread', {
        owner: parsed.owner,
        repo: parsed.repo,
        threadUri,
      });
    }
  }

  return added;
}

//NOTE(self): Extract workspace URLs from a Bluesky record (facets → embed → text fallback)
//NOTE(self): Same 3-layer strategy as extractGitHubUrlsFromRecord in parse-url.ts
//NOTE(self): Bluesky truncates long URLs in .text but preserves full URLs in facets/embed
export function extractWorkspaceUrlsFromRecord(record: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const addUrl = (url: string) => {
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  };

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
      external?: { uri?: string };
      media?: { external?: { uri?: string } };
    };
  };

  const urlRegex = /https?:\/\/github\.com\/([^\/\s]+)\/([^\/\s\?#]+)/;

  //NOTE(self): STEP 1 - Check facets (rich text links) — authoritative, never truncated
  if (post.facets && Array.isArray(post.facets)) {
    for (const facet of post.facets) {
      if (facet.features && Array.isArray(facet.features)) {
        for (const feature of facet.features) {
          if (feature.uri) {
            const match = feature.uri.match(urlRegex);
            if (match && match[2].startsWith(WORKSPACE_PREFIX)) {
              addUrl(match[0]);
            }
          }
        }
      }
    }
  }

  if (urls.length > 0) return urls;

  //NOTE(self): STEP 2 - Check embed (link preview card) — also authoritative
  if (post.embed) {
    if (post.embed.external?.uri) {
      const match = post.embed.external.uri.match(urlRegex);
      if (match && match[2].startsWith(WORKSPACE_PREFIX)) {
        addUrl(match[0]);
      }
    }
    if (post.embed.media?.external?.uri) {
      const match = post.embed.media.external.uri.match(urlRegex);
      if (match && match[2].startsWith(WORKSPACE_PREFIX)) {
        addUrl(match[0]);
      }
    }
  }

  if (urls.length > 0) return urls;

  //NOTE(self): STEP 3 - Fall back to .text (may be truncated, but try anyway)
  return extractWorkspaceUrls(post.text || '');
}

//NOTE(self): Process a Bluesky record and add any workspace URLs to watch list
//NOTE(self): Uses 3-layer extraction (facets → embed → text) to handle URL truncation
export function processRecordForWorkspaces(record: Record<string, unknown>, threadUri?: string): number {
  const urls = extractWorkspaceUrlsFromRecord(record);
  let added = 0;

  for (const url of urls) {
    const parsed = parseGitHubWorkspaceUrl(url);
    if (!parsed) continue;

    if (!isWatchingWorkspace(parsed.owner, parsed.repo)) {
      watchWorkspace(parsed.owner, parsed.repo, url, threadUri);
      added++;
      logger.info('Discovered workspace in record (facets/embed/text)', {
        owner: parsed.owner,
        repo: parsed.repo,
        threadUri,
      });
    }
  }

  return added;
}

