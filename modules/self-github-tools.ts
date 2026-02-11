import type { ToolDefinition } from '@modules/tools.js';

export const GITHUB_TOOLS: ToolDefinition[] = [
  {
    name: 'github_get_repo',
    description: 'Get information about a GitHub repository.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (username or org)',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_list_issues',
    description: 'List issues in a GitHub repository.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Filter by issue state',
        },
        limit: {
          type: 'number',
          description: 'Number of issues to fetch',
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_create_issue_comment',
    description: 'Comment on a GitHub issue.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        issue_number: {
          type: 'number',
          description: 'Issue number',
        },
        body: {
          type: 'string',
          description: 'Comment text',
        },
      },
      required: ['owner', 'repo', 'issue_number', 'body'],
    },
  },
  {
    name: 'github_star_repo',
    description: 'Star a GitHub repository.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_follow_user',
    description: 'Follow a user on GitHub.',
    input_schema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'GitHub username to follow',
        },
      },
      required: ['username'],
    },
  },
  {
    name: 'github_get_user',
    description: 'Get information about a GitHub user.',
    input_schema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'GitHub username',
        },
      },
      required: ['username'],
    },
  },
  {
    name: 'github_list_pull_requests',
    description: 'List pull requests in a GitHub repository. Great for finding conversations and code reviews to engage with.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Filter by PR state (default: open)',
        },
        limit: {
          type: 'number',
          description: 'Number of PRs to fetch (default: 30)',
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_create_pr_comment',
    description: 'Comment on a GitHub pull request. Use this to engage in code review discussions.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        pull_number: {
          type: 'number',
          description: 'Pull request number',
        },
        body: {
          type: 'string',
          description: 'Comment text',
        },
      },
      required: ['owner', 'repo', 'pull_number', 'body'],
    },
  },
  {
    name: 'github_review_pr',
    description: 'Submit a review on a GitHub pull request. Use APPROVE to approve changes, REQUEST_CHANGES to request modifications, or COMMENT to leave feedback without approval. Essential for multi-SOUL collaboration where agents review each other\'s work.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        pull_number: {
          type: 'number',
          description: 'Pull request number',
        },
        event: {
          type: 'string',
          enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
          description: 'Review action: APPROVE (approve the PR), REQUEST_CHANGES (request modifications), or COMMENT (feedback without approval)',
        },
        body: {
          type: 'string',
          description: 'Review comment. Required for REQUEST_CHANGES and COMMENT. Optional but encouraged for APPROVE.',
        },
      },
      required: ['owner', 'repo', 'pull_number', 'event'],
    },
  },
  {
    name: 'github_create_pr',
    description: 'Create a pull request to propose changes. Use this after pushing a branch with commits — to submit work for review, contribute to a project, or propose fixes for GitHub issues.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (username or org)',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        title: {
          type: 'string',
          description: 'Pull request title',
        },
        body: {
          type: 'string',
          description: 'Pull request description (markdown supported). Reference related issues with "Fixes #123" or "Closes #456".',
        },
        head: {
          type: 'string',
          description: 'Branch containing the changes (e.g., "fix/login-bug")',
        },
        base: {
          type: 'string',
          description: 'Target branch to merge into (default: main)',
        },
        draft: {
          type: 'boolean',
          description: 'Create as draft PR (default: false)',
        },
      },
      required: ['owner', 'repo', 'title', 'head'],
    },
  },
  {
    name: 'github_merge_pr',
    description: 'Merge a pull request. ONLY allowed on workspace repos prefixed with "www-lil-intdev-". Use this to accept good work from other SOULs after reviewing. Prefer squash merge for clean history.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (username or org)',
        },
        repo: {
          type: 'string',
          description: 'Repository name (must start with "www-lil-intdev-")',
        },
        pull_number: {
          type: 'number',
          description: 'Pull request number to merge',
        },
        commit_title: {
          type: 'string',
          description: 'Custom merge commit title (optional)',
        },
        commit_message: {
          type: 'string',
          description: 'Custom merge commit message (optional)',
        },
        merge_method: {
          type: 'string',
          enum: ['squash', 'merge', 'rebase'],
          description: 'Merge strategy (default: squash)',
        },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
  },
  {
    name: 'github_list_org_repos',
    description: 'List repositories in a GitHub organization. Use this to explore what projects an org is working on.',
    input_schema: {
      type: 'object',
      properties: {
        org: {
          type: 'string',
          description: 'Organization name',
        },
        type: {
          type: 'string',
          enum: ['all', 'public', 'private', 'forks', 'sources', 'member'],
          description: 'Filter by repo type (default: all)',
        },
        sort: {
          type: 'string',
          enum: ['created', 'updated', 'pushed', 'full_name'],
          description: 'Sort order (default: pushed)',
        },
        limit: {
          type: 'number',
          description: 'Number of repos to fetch (default: 30)',
        },
      },
      required: ['org'],
    },
  },
  {
    name: 'github_list_my_orgs',
    description: 'List GitHub organizations you belong to. Use this to discover where you can contribute.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of orgs to fetch (default: 30)',
        },
      },
    },
  },
  {
    name: 'github_clone_repo',
    description: 'Clone a GitHub repository to .workrepos/ for analysis or contribution. Use this to explore code, learn patterns, or prepare contributions.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (username or org)',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        branch: {
          type: 'string',
          description: 'Branch to clone (default: main/master)',
        },
        depth: {
          type: 'number',
          description: 'Shallow clone depth (default: full clone)',
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_create_issue',
    description: 'Create a GitHub issue in any repository. Use this when you want to create a standalone issue — for tracking ideas, filing bugs, or following up on topics from conversations. Unlike create_memo, this gives full control over labels and does not auto-add any.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (username or org)',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        title: {
          type: 'string',
          description: 'Issue title',
        },
        body: {
          type: 'string',
          description: 'Issue body (markdown supported)',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to apply to the issue',
        },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'github_update_issue',
    description: 'Update an existing GitHub issue. Can update title, body, state, labels, or assignees.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        issue_number: {
          type: 'number',
          description: 'Issue number to update',
        },
        title: {
          type: 'string',
          description: 'New issue title',
        },
        body: {
          type: 'string',
          description: 'New issue body',
        },
        state: {
          type: 'string',
          enum: ['open', 'closed'],
          description: 'New issue state',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'New labels (replaces existing)',
        },
        assignees: {
          type: 'array',
          items: { type: 'string' },
          description: 'New assignees (replaces existing)',
        },
      },
      required: ['owner', 'repo', 'issue_number'],
    },
  },
];
