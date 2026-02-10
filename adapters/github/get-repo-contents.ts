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
