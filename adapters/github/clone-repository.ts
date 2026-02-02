import { exec } from 'child_process';
import { promisify } from 'util';
import { getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';

const execAsync = promisify(exec);

export interface CloneRepositoryParams {
  owner: string;
  repo: string;
  targetDir: string;
  branch?: string;
  depth?: number;
}

export interface CloneRepositoryResponse {
  path: string;
  branch: string;
}

export async function cloneRepository(
  params: CloneRepositoryParams
): Promise<GitHubResult<CloneRepositoryResponse>> {
  const auth = getAuth();

  try {
    let cloneUrl: string;
    if (auth) {
      cloneUrl = `https://${auth.username}:${auth.token}@github.com/${params.owner}/${params.repo}.git`;
    } else {
      cloneUrl = `https://github.com/${params.owner}/${params.repo}.git`;
    }

    const args: string[] = ['git', 'clone'];
    if (params.branch) {
      args.push('--branch', params.branch);
    }
    if (params.depth) {
      args.push('--depth', String(params.depth));
    }
    args.push(cloneUrl, params.targetDir);

    const command = args.join(' ');
    await execAsync(command);

    return {
      success: true,
      data: {
        path: params.targetDir,
        branch: params.branch || 'main',
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function pullRepository(
  repoPath: string
): Promise<GitHubResult<void>> {
  try {
    await execAsync('git pull', { cwd: repoPath });
    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
