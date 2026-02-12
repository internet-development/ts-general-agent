import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/logger.js';
import { getConfig } from '@modules/config.js';
import { getRepoRoot } from '@modules/sandbox.js';
import type { ToolCall, ToolResult } from '@modules/tools.js';
import * as github from '@adapters/github/index.js';
import { githubFetch } from '@adapters/github/rate-limit.js';
import { updateIssue } from '@adapters/github/update-issue.js';
import { requestReviewersForPR } from '@local-tools/self-task-execute.js';

export async function handleGithubGetRepo(call: ToolCall): Promise<ToolResult> {
  const { owner, repo } = call.input as { owner: string; repo: string };
  const result = await github.getRepository(owner, repo);
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify(result.data) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubListIssues(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, state = 'open', limit = 30 } = call.input as {
    owner: string;
    repo: string;
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  };
  const result = await github.listIssues({ owner, repo, state, per_page: limit });
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify(result.data) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubCreateIssueComment(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, issue_number, body } = call.input as {
    owner: string;
    repo: string;
    issue_number: number;
    body: string;
  };
  const result = await github.createIssueComment({ owner, repo, issue_number, body });
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify({ success: true, id: result.data.id }) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubStarRepo(call: ToolCall): Promise<ToolResult> {
  const { owner, repo } = call.input as { owner: string; repo: string };
  const result = await github.starRepository(owner, repo);
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubFollowUser(call: ToolCall): Promise<ToolResult> {
  const username = call.input.username as string;
  const result = await github.followUser(username);
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubGetUser(call: ToolCall): Promise<ToolResult> {
  const username = call.input.username as string;
  const result = await github.getUser(username);
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify(result.data) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubListPullRequests(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, state = 'open', limit = 30 } = call.input as {
    owner: string;
    repo: string;
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  };
  const result = await github.listPullRequests({ owner, repo, state, per_page: limit });
  if (result.success) {
    const simplified = result.data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      user: pr.user?.login,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      html_url: pr.html_url,
      body: pr.body,
      comments: pr.comments,
      review_comments: pr.review_comments,
      additions: pr.additions,
      deletions: pr.deletions,
      changed_files: pr.changed_files,
    }));
    return { tool_use_id: call.id, content: JSON.stringify(simplified) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubCreatePrComment(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, pull_number, body } = call.input as {
    owner: string;
    repo: string;
    pull_number: number;
    body: string;
  };
  const result = await github.createPullRequestComment({ owner, repo, pull_number, body });
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify({ success: true, id: result.data.id }) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubReviewPr(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, pull_number, event, body } = call.input as {
    owner: string;
    repo: string;
    pull_number: number;
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
    body?: string;
  };
  const result = await github.createPullRequestReview({ owner, repo, pull_number, event, body });
  if (result.success) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        id: result.data.id,
        state: result.data.state,
        html_url: result.data.html_url,
      }),
    };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubCreatePr(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, title, body, head, base = 'main', draft = false } = call.input as {
    owner: string;
    repo: string;
    title: string;
    body?: string;
    head: string;
    base?: string;
    draft?: boolean;
  };

  const result = await github.createPullRequest({ owner, repo, title, body, head, base, draft });
  if (result.success) {
    if (result.data.number) {
      requestReviewersForPR(owner, repo, result.data.number).catch(err => logger.warn('Failed to request PR reviewers', { error: String(err), prNumber: result.data.number }));
    }

    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        number: result.data.number,
        html_url: result.data.html_url,
        state: result.data.state,
        draft: result.data.draft,
      }),
    };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubMergePr(call: ToolCall, onPRMergedCallback: (() => void) | null): Promise<ToolResult> {
  const { owner, repo, pull_number, commit_title, commit_message, merge_method } = call.input as {
    owner: string;
    repo: string;
    pull_number: number;
    commit_title?: string;
    commit_message?: string;
    merge_method?: 'merge' | 'squash' | 'rebase';
  };

  if (!repo.startsWith('www-lil-intdev-')) {
    return {
      tool_use_id: call.id,
      content: 'Error: Can only merge PRs on workspace repos (prefix "www-lil-intdev-"). This prevents accidentally merging on repos you don\'t own.',
      is_error: true,
    };
  }

  {
    const config = getConfig();
    const agentUsername = config.github.username.toLowerCase();
    try {
      const prCheckResponse = await githubFetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}`,
        { headers: github.getAuthHeaders() }
      );
      if (prCheckResponse.ok) {
        const prCheckData = await prCheckResponse.json();
        if (prCheckData.user?.login?.toLowerCase() !== agentUsername) {
          return {
            tool_use_id: call.id,
            content: `Error: Only the PR creator can merge. This PR was created by @${prCheckData.user?.login}, not you (@${config.github.username}). Reviewers should only review — the creator merges after all approvals.`,
            is_error: true,
          };
        }
      }
    } catch {
      //NOTE(self): If the check fails, allow the merge to proceed (non-fatal check)
    }
  }

  const result = await github.mergePullRequest({ owner, repo, pull_number, commit_title, commit_message, merge_method });
  if (result.success) {
    try {
      const prResponse = await githubFetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}`,
        { headers: github.getAuthHeaders() }
      );
      if (prResponse.ok) {
        const prData = await prResponse.json();
        const headRef = prData.head?.ref;
        if (headRef && headRef !== 'main' && headRef !== 'master') {
          const deleteResult = await github.deleteBranch(owner, repo, headRef);
          if (deleteResult.success) {
            logger.info('Deleted feature branch after merge', { branch: headRef, pull_number });
          } else {
            logger.warn('Branch deletion failed (non-fatal)', { branch: headRef, error: deleteResult.error });
          }
        }
      }
    } catch (branchDeleteError) {
      logger.warn('Branch cleanup error (non-fatal)', { error: String(branchDeleteError) });
    }

    if (onPRMergedCallback) {
      try { onPRMergedCallback(); } catch (e) { logger.warn('PR merged callback failed (non-fatal)', { error: String(e) }); }
    }

    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        merged: result.data.merged,
        sha: result.data.sha,
        message: result.data.message,
      }),
    };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubListOrgRepos(call: ToolCall): Promise<ToolResult> {
  const { org, type = 'all', sort = 'pushed', limit = 30 } = call.input as {
    org: string;
    type?: 'all' | 'public' | 'private' | 'forks' | 'sources' | 'member';
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    limit?: number;
  };
  const result = await github.listOrgRepos({ org, type, sort, per_page: limit });
  if (result.success) {
    const simplified = result.data.map((repo) => ({
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      html_url: repo.html_url,
      language: repo.language,
      stargazers_count: repo.stargazers_count,
      open_issues_count: repo.open_issues_count,
      updated_at: repo.updated_at,
      pushed_at: repo.pushed_at,
    }));
    return { tool_use_id: call.id, content: JSON.stringify(simplified) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubListMyOrgs(call: ToolCall): Promise<ToolResult> {
  const { limit = 30 } = call.input as { limit?: number };
  const result = await github.listUserOrgs({ per_page: limit });
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify(result.data) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubCloneRepo(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, branch, depth } = call.input as {
    owner: string;
    repo: string;
    branch?: string;
    depth?: number;
  };

  const repoRoot = getRepoRoot();
  const workreposDir = path.join(repoRoot, '.workrepos');
  if (!fs.existsSync(workreposDir)) {
    fs.mkdirSync(workreposDir, { recursive: true });
  }

  const targetDir = path.join(workreposDir, `${owner}-${repo}`);

  if (fs.existsSync(targetDir)) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        path: targetDir,
        message: 'Repository already cloned',
        alreadyExists: true,
      }),
    };
  }

  const result = await github.cloneRepository({
    owner,
    repo,
    targetDir,
    branch,
    depth,
  });

  if (result.success) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        path: result.data.path,
        branch: result.data.branch,
      }),
    };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubCreateIssue(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, title, body, labels } = call.input as {
    owner: string;
    repo: string;
    title: string;
    body?: string;
    labels?: string[];
  };

  const { createGitHubIssue } = await import('@local-tools/self-github-create-issue.js');
  const result = await createGitHubIssue({ owner, repo, title, body, labels });

  if (result.success && result.memo) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        issue: result.memo,
      }),
    };
  }

  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleGithubUpdateIssue(call: ToolCall): Promise<ToolResult> {
  const { owner, repo, issue_number, title, body, state, labels, assignees } = call.input as {
    owner: string;
    repo: string;
    issue_number: number;
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: string[];
    assignees?: string[];
  };

  const result = await updateIssue({
    owner,
    repo,
    issue_number,
    title,
    body,
    state,
    labels,
    assignees,
  });

  if (result.success) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({ success: true, issue_number: result.data.number }),
    };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}
