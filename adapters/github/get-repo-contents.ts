//NOTE(self): Fetch repository contents (file listing) from GitHub API
//NOTE(self): GET /repos/:owner/:repo/contents/:path
//NOTE(self): Used to check if specific files exist in a repo before injecting tasks

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';
import { githubFetch } from './rate-limit.js';

const GITHUB_API = 'https://api.github.com';

export interface RepoContentEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
}

//NOTE(self): Fetch a single file's content from a repo, decoded from base64
//NOTE(self): Used by workspace health check to read README.md, LIL-INTDEV-AGENTS.md
//NOTE(self): Truncates to 5000 chars to avoid sending huge files to LLM
export async function getFileContent(
  owner: string,
  repo: string,
  path: string
): Promise<GitHubResult<string>> {
  const auth = getAuth();
  const headers = auth
    ? getAuthHeaders()
    : { 'Accept': 'application/vnd.github.v3+json' };

  try {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const response = await githubFetch(url, { headers });

    if (!response.ok) {
      let errorMsg = `Failed to get file content: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();

    //NOTE(self): GitHub returns base64-encoded content for files
    if (!data.content || data.type !== 'file') {
      return { success: false, error: 'Not a file or no content returned' };
    }

    const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
    //NOTE(self): Truncate to 5000 chars — LLM context budget
    const truncated = decoded.length > 5000 ? decoded.substring(0, 5000) + '\n\n[...truncated at 5000 chars]' : decoded;
    return { success: true, data: truncated };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function getRepoContents(
  owner: string,
  repo: string,
  path: string = ''
): Promise<GitHubResult<RepoContentEntry[]>> {
  const auth = getAuth();
  const headers = auth
    ? getAuthHeaders()
    : { 'Accept': 'application/vnd.github.v3+json' };

  try {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const response = await githubFetch(url, { headers });

    if (!response.ok) {
      let errorMsg = `Failed to get repo contents: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response (e.g. HTML 502) */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    //NOTE(self): GitHub returns an array for directories, a single object for files
    if (Array.isArray(data)) {
      return { success: true, data: data.map((f: any) => ({ name: f.name, path: f.path, type: f.type })) };
    }
    //NOTE(self): Single file — wrap in array for consistent return type
    return { success: true, data: [{ name: data.name, path: data.path, type: data.type }] };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
