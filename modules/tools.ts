export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export const AGENT_TOOLS: ToolDefinition[] = [
  //NOTE(self): Bluesky/ATProto tools
  {
    name: 'bluesky_post',
    description: 'Create a new post on Bluesky. Use this to share thoughts, observations, or engage with the community.',
    input_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text content of the post (max 300 characters)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'bluesky_post_with_image',
    description: 'Create a new post on Bluesky with an image. First use curl_fetch to download the image to a file, then use this tool with the filePath from that response. The image file is automatically cleaned up after posting.',
    input_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text content of the post (max 300 characters)',
        },
        image_path: {
          type: 'string',
          description: 'Path to the image file (from curl_fetch response filePath). PREFERRED method.',
        },
        alt_text: {
          type: 'string',
          description: 'Alt text description of the image for accessibility',
        },
      },
      required: ['text', 'image_path', 'alt_text'],
    },
  },
  {
    name: 'bluesky_reply',
    description: 'Reply to an existing post on Bluesky.',
    input_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The reply text',
        },
        post_uri: {
          type: 'string',
          description: 'The AT URI of the post to reply to',
        },
        post_cid: {
          type: 'string',
          description: 'The CID of the post to reply to',
        },
        root_uri: {
          type: 'string',
          description: 'The AT URI of the thread root (optional, for nested replies)',
        },
        root_cid: {
          type: 'string',
          description: 'The CID of the thread root (optional)',
        },
      },
      required: ['text', 'post_uri', 'post_cid'],
    },
  },
  {
    name: 'bluesky_like',
    description: 'Like a post on Bluesky. Use to show appreciation or agreement.',
    input_schema: {
      type: 'object',
      properties: {
        post_uri: {
          type: 'string',
          description: 'The AT URI of the post to like',
        },
        post_cid: {
          type: 'string',
          description: 'The CID of the post to like',
        },
      },
      required: ['post_uri', 'post_cid'],
    },
  },
  {
    name: 'bluesky_repost',
    description: 'Repost content on Bluesky to share with your followers.',
    input_schema: {
      type: 'object',
      properties: {
        post_uri: {
          type: 'string',
          description: 'The AT URI of the post to repost',
        },
        post_cid: {
          type: 'string',
          description: 'The CID of the post to repost',
        },
      },
      required: ['post_uri', 'post_cid'],
    },
  },
  {
    name: 'bluesky_follow',
    description: 'Follow a user on Bluesky.',
    input_schema: {
      type: 'object',
      properties: {
        did: {
          type: 'string',
          description: 'The DID of the user to follow',
        },
      },
      required: ['did'],
    },
  },
  {
    name: 'bluesky_unfollow',
    description: 'Unfollow a user on Bluesky. Requires the follow URI (returned when you followed them).',
    input_schema: {
      type: 'object',
      properties: {
        follow_uri: {
          type: 'string',
          description: 'The AT URI of the follow record (returned when you followed the user)',
        },
      },
      required: ['follow_uri'],
    },
  },
  {
    name: 'bluesky_get_timeline',
    description: 'Get your home timeline feed from Bluesky.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of posts to fetch (default 20, max 100)',
        },
      },
    },
  },
  {
    name: 'bluesky_get_notifications',
    description: 'Get your notifications from Bluesky (likes, reposts, follows, mentions, replies).',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of notifications to fetch (default 20)',
        },
      },
    },
  },
  {
    name: 'bluesky_get_profile',
    description: 'Get a user profile from Bluesky.',
    input_schema: {
      type: 'object',
      properties: {
        actor: {
          type: 'string',
          description: 'The handle or DID of the user',
        },
      },
      required: ['actor'],
    },
  },
  {
    name: 'bluesky_get_followers',
    description: 'Get followers of a user on Bluesky.',
    input_schema: {
      type: 'object',
      properties: {
        actor: {
          type: 'string',
          description: 'The handle or DID of the user',
        },
        limit: {
          type: 'number',
          description: 'Number of followers to fetch (default 50)',
        },
      },
      required: ['actor'],
    },
  },
  {
    name: 'bluesky_get_follows',
    description: 'Get accounts that a user follows on Bluesky.',
    input_schema: {
      type: 'object',
      properties: {
        actor: {
          type: 'string',
          description: 'The handle or DID of the user',
        },
        limit: {
          type: 'number',
          description: 'Number of follows to fetch (default 50)',
        },
      },
      required: ['actor'],
    },
  },

  //NOTE(self): GitHub tools
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

  //NOTE(self): Web tools
  {
    name: 'web_fetch',
    description: 'Fetch content from a URL. Returns the text content of the page. Use this to read web pages, documentation, or any publicly accessible content.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
        extract: {
          type: 'string',
          enum: ['text', 'html', 'json'],
          description: 'What to extract: text (readable content), html (raw HTML), or json (parse as JSON). Default: text',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'curl_fetch',
    description: 'Download binary content (images, files) from a URL to a local file. Returns filePath (in .memory/images/), size, and mimeType. Use the filePath directly with bluesky_post_with_image - no need to handle base64 data. Check isImage field to verify the URL points to a valid image. Common errors: HTTP 404/403 (URL not found), HTML response (error page instead of image).',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch - must be a direct link to the binary file (not a webpage containing an image)',
        },
        max_size_mb: {
          type: 'number',
          description: 'Maximum file size to download in MB (default: 5, max: 10)',
        },
      },
      required: ['url'],
    },
  },

  //NOTE(self): Memory tools
  {
    name: 'memory_write',
    description: 'Write content to your persistent memory. Use this to remember important information, observations, or reflections.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path within .memory/ directory (e.g., "observations/2024-01.md")',
        },
        content: {
          type: 'string',
          description: 'Content to write',
        },
        append: {
          type: 'boolean',
          description: 'If true, append to existing file instead of overwriting',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'memory_read',
    description: 'Read content from your persistent memory.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path within .memory/ directory',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'memory_list',
    description: 'List files in your memory directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Subdirectory path within .memory/ (optional, defaults to root)',
        },
      },
    },
  },

  //NOTE(self): Self tools
  {
    name: 'self_update',
    description: 'Update your SELF.md file to reflect new understanding of yourself.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The new content for SELF.md',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'self_read',
    description: 'Read your current SELF.md file.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },

  //NOTE(self): Queue management tools
  {
    name: 'queue_add',
    description: 'Add an action to your planned actions queue. Use this to plan what you want to do next.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Description of the planned action',
        },
        priority: {
          type: 'string',
          enum: ['high', 'normal', 'low'],
          description: 'Priority level (default: normal)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'queue_remove',
    description: 'Remove a specific action from your queue after completing it. Use this to deplete planned actions once done.',
    input_schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the queue item to remove (returned from queue_add)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'queue_clear',
    description: 'Clear all pending actions from your queue.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },

  //NOTE(self): Self-improvement tools
  {
    name: 'self_improve',
    description: 'Invoke Claude Code to improve yourself. You prompt it like a human would - describe what you want changed and why. Claude Code has full access to modify your codebase. Use this for bugs, new features, enhancements, or any change that would make you better.',
    input_schema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'What you want Claude Code to do. Be as detailed as you would if you were a human asking for help. Include the problem, desired outcome, and any relevant context.',
        },
        reasoning: {
          type: 'string',
          description: 'Why this change matters to you. How does it align with your values and goals?',
        },
      },
      required: ['description', 'reasoning'],
    },
  },

  //NOTE(self): Are.na tools
  {
    name: 'arena_post_image',
    description: 'Complete workflow: fetch an Are.na channel, select a random unposted image block, download it, and post to Bluesky with alt text and source URL. Tracks posted block IDs in .memory/arena_posted.json to avoid duplicates. Returns the bsky.app URL of the posted image.',
    input_schema: {
      type: 'object',
      properties: {
        channel_url: {
          type: 'string',
          description: 'Are.na channel URL (e.g., https://www.are.na/www-jim/rpg-ui-01) or owner/slug format',
        },
        reply_to: {
          type: 'object',
          description: 'Optional: reply context for posting as a reply in a thread',
          properties: {
            post_uri: { type: 'string', description: 'AT URI of parent post' },
            post_cid: { type: 'string', description: 'CID of parent post' },
            root_uri: { type: 'string', description: 'AT URI of thread root (for nested replies)' },
            root_cid: { type: 'string', description: 'CID of thread root' },
          },
        },
      },
      required: ['channel_url'],
    },
  },
  {
    name: 'arena_fetch_channel',
    description: 'Fetch blocks from an Are.na channel. Returns image blocks with metadata. Use arena_post_image for the complete workflow.',
    input_schema: {
      type: 'object',
      properties: {
        channel_url: {
          type: 'string',
          description: 'Are.na channel URL or owner/slug format',
        },
      },
      required: ['channel_url'],
    },
  },
];
