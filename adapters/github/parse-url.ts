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
