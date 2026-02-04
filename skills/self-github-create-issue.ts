//NOTE(self): Creates GitHub issues - useful for memos and collaborative notes

import { createIssue, type CreateIssueParams } from '@adapters/github/create-issue.js';
import { logger } from '@modules/logger.js';

export interface CreateMemoParams {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
}

export interface MemoResult {
  success: boolean;
  memo?: {
    number: number;
    title: string;
    url: string;
  };
  error?: string;
}

/**
 * Create an issue as a memo/note in a repository
 * Designed for agents to leave notes, share thoughts, or coordinate work
 */
export async function createMemo(params: CreateMemoParams): Promise<MemoResult> {
  logger.info('Creating memo', {
    owner: params.owner,
    repo: params.repo,
    title: params.title
  });

  const result = await createIssue({
    owner: params.owner,
    repo: params.repo,
    title: params.title,
    body: params.body,
    labels: params.labels || ['memo'],
  });

  if (!result.success) {
    logger.error('Failed to create memo', { error: result.error });
    return { success: false, error: result.error };
  }

  const issue = result.data;
  logger.info('Memo created', { number: issue.number, url: issue.html_url });

  return {
    success: true,
    memo: {
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
    },
  };
}

/**
 * Create a general issue (full control over parameters)
 */
export async function createGitHubIssue(params: CreateIssueParams): Promise<MemoResult> {
  const result = await createIssue(params);

  if (!result.success) {
    logger.error('Failed to create issue', { error: result.error });
    return { success: false, error: result.error };
  }

  const issue = result.data;
  return {
    success: true,
    memo: {
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
    },
  };
}
