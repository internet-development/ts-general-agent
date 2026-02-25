import type { ToolDefinition } from '@modules/tools.js';

export const SELF_TOOLS: ToolDefinition[] = [
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
  {
    name: 'graceful_exit',
    description: 'Exit a conversation gracefully with a closing gesture - never leave with silence. Sends a brief closing message OR likes the last post, then marks the conversation concluded. Use this instead of just stopping - it leaves warmth, not awkwardness.',
    input_schema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['bluesky', 'github'],
          description: 'Which platform the conversation is on',
        },
        identifier: {
          type: 'string',
          description: 'For Bluesky: the thread root URI (at://...). For GitHub: owner/repo#number format (e.g., "anthropics/claude-code#123")',
        },
        closing_type: {
          type: 'string',
          enum: ['message', 'like'],
          description: 'How to close: "message" sends a brief closing reply, "like" just likes/reacts to their last message (Bluesky only for now)',
        },
        closing_message: {
          type: 'string',
          description: 'The closing message to send. Required if closing_type is "message". Keep it warm and brief (e.g., "Thanks for the great discussion!", "Appreciate the conversation", "This was helpful, thanks!")',
        },
        target_uri: {
          type: 'string',
          description: 'For Bluesky: the AT URI of the post to reply to or like (usually the last message from the other person)',
        },
        target_cid: {
          type: 'string',
          description: 'For Bluesky: the CID of the target post',
        },
        reason: {
          type: 'string',
          description: 'Internal note on why you\'re concluding (e.g., "Point made", "They seem satisfied", "Conversation complete")',
        },
      },
      required: ['platform', 'identifier', 'closing_type', 'reason'],
    },
  },
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
  {
    name: 'lookup_post_context',
    description: 'Look up the context/metadata for a post I made. Returns source information (Are.na channel, block title, original URL), alt text, and when I posted it. Useful for answering questions like "why did you pick this?" or "where is this from?" when someone asks about an image I posted.',
    input_schema: {
      type: 'object',
      properties: {
        post_uri: {
          type: 'string',
          description: 'AT URI of the post (at://did:plc:.../app.bsky.feed.post/...)',
        },
        bsky_url: {
          type: 'string',
          description: 'Bluesky URL of the post (https://bsky.app/profile/.../post/...)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_posts_needing_attribution',
    description: 'Get posts where I shared content but could not find the original creator. Returns oldest first so I can circle back and try to find proper attribution. Use this during quiet moments to work on credit/traceability backlog.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of posts to return (default: 10)',
        },
      },
      required: [],
    },
  },
  {
    name: 'mark_attribution_followup',
    description: 'Mark a post as needing follow-up to find the original creator, or clear the flag if found. Use when I realize I should credit someone but cannot find them yet, or when I later discover the original source.',
    input_schema: {
      type: 'object',
      properties: {
        post_uri: {
          type: 'string',
          description: 'AT URI of the post to update',
        },
        needs_followup: {
          type: 'boolean',
          description: 'Set to true if still needs follow-up, false if resolved',
        },
        notes: {
          type: 'string',
          description: 'Notes to help future me (e.g., "looks like Dribbble style, try reverse image search")',
        },
      },
      required: ['post_uri', 'needs_followup'],
    },
  },
  {
    name: 'update_post_attribution',
    description: 'Update a post with the original creator attribution after finding them. Clears the follow-up flag and records the original source URL.',
    input_schema: {
      type: 'object',
      properties: {
        post_uri: {
          type: 'string',
          description: 'AT URI of the post to update',
        },
        original_url: {
          type: 'string',
          description: 'URL of the original creator (portfolio, Dribbble, Behance, etc.)',
        },
        notes: {
          type: 'string',
          description: 'How I found them or additional context (e.g., "found via reverse image search")',
        },
      },
      required: ['post_uri', 'original_url'],
    },
  },
  {
    name: 'format_source_attribution',
    description: 'Get a clean, formatted source attribution for a post I made. Use this when someone asks where an image came from, or when I want to share proper credit. Returns a concise string with exact Are.na block URL + original source if known.',
    input_schema: {
      type: 'object',
      properties: {
        post_uri: {
          type: 'string',
          description: 'AT URI of the post (at://did:plc:.../app.bsky.feed.post/...)',
        },
        bsky_url: {
          type: 'string',
          description: 'Bluesky URL of the post (https://bsky.app/profile/.../post/...)',
        },
      },
      required: [],
    },
  },
];
