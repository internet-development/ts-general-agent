import type { ToolDefinition } from '@modules/tools.js';

export const BLUESKY_TOOLS: ToolDefinition[] = [
  {
    name: 'bluesky_post',
    description: 'Create a new post on Bluesky. Use this to share thoughts, observations, or engage with the community.',
    input_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text content of the post (max 300 graphemes). MUST be 300 graphemes or fewer.',
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
          description: 'The text content of the post (max 300 graphemes). MUST be 300 graphemes or fewer.',
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
    description: 'Reply to an existing post on Bluesky. Thread root is auto-resolved if not provided - just supply the parent post URI and CID.',
    input_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The reply text',
        },
        post_uri: {
          type: 'string',
          description: 'The AT URI of the post to reply to (e.g., at://did:plc:.../app.bsky.feed.post/...)',
        },
        post_cid: {
          type: 'string',
          description: 'The CID of the post to reply to',
        },
        root_uri: {
          type: 'string',
          description: 'Optional: AT URI of the thread root. If omitted, automatically resolved from the parent post.',
        },
        root_cid: {
          type: 'string',
          description: 'Optional: CID of the thread root. If omitted, automatically resolved from the parent post.',
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
];
