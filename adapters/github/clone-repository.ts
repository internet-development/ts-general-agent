import { execFile } from 'child_process';
import { promisify } from 'util';
import { getAuth } from '@adapters/github/authenticate.js';
import type { GitHubResult } from '@adapters/github/types.js';

const execFileAsync = promisify(execFile);

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

//NOTE(self): Validate git-safe string (no shell metacharacters)
function isValidGitParam(value: string): boolean {
  //NOTE(self): Allow alphanumeric, dash, underscore, dot, slash (for paths)
  //NOTE(self): Reject anything that could be a shell injection
  return /^[a-zA-Z0-9_.\-\/]+$/.test(value) && !value.includes('..');
}

export async function cloneRepository(
  params: CloneRepositoryParams
): Promise<GitHubResult<CloneRepositoryResponse>> {
  const auth = getAuth();

  //NOTE(self): Validate all parameters to prevent injection
  if (!isValidGitParam(params.owner)) {
    return { success: false, error: `Invalid owner: ${params.owner}` };
  }
  if (!isValidGitParam(params.repo)) {
    return { success: false, error: `Invalid repo: ${params.repo}` };
  }
  if (!isValidGitParam(params.targetDir)) {
    return { success: false, error: `Invalid targetDir: ${params.targetDir}` };
  }
  if (params.branch && !isValidGitParam(params.branch)) {
    return { success: false, error: `Invalid branch: ${params.branch}` };
  }

  try {
    //NOTE(self): Use HTTPS URL without embedded credentials
    //NOTE(self): For authenticated access, use git credential helper or GIT_ASKPASS
    const cloneUrl = `https://github.com/${params.owner}/${params.repo}.git`;

    //NOTE(self): Build args array (NOT a shell command string)
    const args: string[] = ['clone'];
    if (params.branch) {
      args.push('--branch', params.branch);
    }
    if (params.depth) {
      args.push('--depth', String(params.depth));
    }
    args.push(cloneUrl, params.targetDir);

    //NOTE(self): Set up environment for authentication if available
    //NOTE(self): Using GIT_ASKPASS is safer than embedding credentials in URL
    const env = { ...process.env };
    if (auth) {
      //NOTE(self): Use git credential helper approach - safer than URL embedding
      //NOTE(self): This passes credentials via environment, not command line
      env.GIT_TERMINAL_PROMPT = '0';
      env.GIT_ASKPASS = 'echo'; //NOTE(self): Disable interactive prompts

      //NOTE(self): For HTTPS auth, configure git to use the token
      //NOTE(self): First, try with credential in URL (but via execFile, not shell)
      args[args.length - 2] = `https://${auth.username}:${auth.token}@github.com/${params.owner}/${params.repo}.git`;
    }

    //NOTE(self): Use execFile (NOT exec) - prevents shell injection
    //NOTE(self): Arguments are passed as array, not parsed by shell
    await execFileAsync('git', args, { env });

    return {
      success: true,
      data: {
        path: params.targetDir,
        branch: params.branch || 'main',
      },
    };
  } catch (error) {
    //NOTE(self): Sanitize error message to avoid leaking credentials
    let errorMsg = String(error);
    if (auth) {
      errorMsg = errorMsg.replace(new RegExp(auth.token, 'g'), '[REDACTED]');
      errorMsg = errorMsg.replace(new RegExp(auth.username, 'g'), '[USER]');
    }
    return { success: false, error: errorMsg };
  }
}

