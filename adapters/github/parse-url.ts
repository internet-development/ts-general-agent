//NOTE(self): Parse GitHub URLs to extract owner, repo, type, and number
//NOTE(self): Handles issues, PRs, and discussions

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

//NOTE(self): Bluesky post record structure for URL extraction
interface BlueskyPostRecord {
  text?: string;
  //NOTE(self): Facets contain rich text features like links
  facets?: Array<{
    features: Array<{
      $type: string;
      uri?: string;  //NOTE(self): Full URI for link facets
    }>;
  }>;
  //NOTE(self): Embed contains link preview cards
  embed?: {
    $type?: string;
    external?: {
      uri?: string;  //NOTE(self): Full URI for external embeds
    };
    //NOTE(self): Record embeds (quotes) may also have URIs
    record?: {
      uri?: string;
    };
  };
}

/**
 * Extract GitHub URLs from a Bluesky post record
 * //NOTE(self): Checks text, facets (rich text links), and embed (link preview)
 * //NOTE(self): This handles truncated URLs in text - facets/embed have the full URL
 */
export function extractGitHubUrlsFromRecord(record: Record<string, unknown>): ParsedGitHubUrl[] {
  const results: ParsedGitHubUrl[] = [];
  const seen = new Set<string>();

  const post = record as BlueskyPostRecord;

  //NOTE(self): Helper to add a parsed URL if valid and not duplicate
  const addIfValid = (url: string) => {
    const parsed = parseGitHubUrl(url);
    if (parsed) {
      const key = `${parsed.owner}/${parsed.repo}/${parsed.type}/${parsed.number}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(parsed);
      }
    }
  };

  //NOTE(self): 1. Check facets first - these have the full, untruncated URIs
  if (post.facets && Array.isArray(post.facets)) {
    for (const facet of post.facets) {
      if (facet.features && Array.isArray(facet.features)) {
        for (const feature of facet.features) {
          if (feature.$type === 'app.bsky.richtext.facet#link' && feature.uri) {
            addIfValid(feature.uri);
          }
        }
      }
    }
  }

  //NOTE(self): 2. Check embed - link preview cards have full URI
  if (post.embed) {
    //NOTE(self): External embed (link card)
    if (post.embed.external?.uri) {
      addIfValid(post.embed.external.uri);
    }
    //NOTE(self): Record embed (quote) might reference a post with links
    if (post.embed.record?.uri) {
      //NOTE(self): This is a Bluesky URI, not a GitHub URL, so skip
    }
  }

  //NOTE(self): 3. Check text as fallback (may have truncated URLs)
  if (post.text) {
    const textUrls = extractGitHubUrls(post.text);
    for (const parsed of textUrls) {
      const key = `${parsed.owner}/${parsed.repo}/${parsed.type}/${parsed.number}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(parsed);
      }
    }
  }

  return results;
}
