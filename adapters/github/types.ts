export interface GitHubAuth {
  username: string;
  token: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  owner: {
    login: string;
    id: number;
    avatar_url: string;
  };
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  user: {
    login: string;
    id: number;
    avatar_url: string;
  };
  labels: Array<{
    id: number;
    name: string;
    color: string;
  }>;
  assignees: Array<{
    login: string;
    id: number;
  }>;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  draft?: boolean;
  merged: boolean;
  user: {
    login: string;
    id: number;
    avatar_url: string;
  };
  head: {
    ref: string;
    sha: string;
    repo: { full_name: string } | null;
  };
  base: {
    ref: string;
    sha: string;
    repo: { full_name: string };
  };
  html_url: string;
  diff_url: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  //NOTE(self): PR statistics from GitHub API
  comments?: number;
  review_comments?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: {
    login: string;
    id: number;
    avatar_url: string;
  };
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  name: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
}

export interface GitHubPullRequestReview {
  id: number;
  user: {
    login: string;
    id: number;
    avatar_url: string;
  };
  body: string | null;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  html_url: string;
  pull_request_url: string;
  submitted_at: string;
  commit_id: string;
}

export type GitHubResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
