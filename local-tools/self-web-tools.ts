import type { ToolDefinition } from '@modules/tools.js';

export const WEB_TOOLS: ToolDefinition[] = [
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
        text: {
          type: 'string',
          description: 'Optional: custom post text to use instead of auto-generated metadata. Use this when you want to add your own commentary about the image (e.g., why you like it). The Are.na source URL will be appended automatically. Must fit within 300 graphemes including the source URL.',
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
  {
    name: 'arena_search',
    description: 'Search Are.na for channels matching a keyword or topic. Returns relevant channels with block counts. Use this when someone asks for images on a topic and you need to find a relevant Are.na channel to pull from. Then use arena_post_image with the discovered channel.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term (e.g., "JRPG", "brutalist architecture", "mood board")',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (default: 1)',
        },
        per: {
          type: 'number',
          description: 'Results per page (default: 10, max: 40)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_browse_images',
    description: 'Browse any URL and discover images on the page. Returns a structured list of images with metadata (URL, alt text, dimensions, surrounding context). Use this to explore design sites, portfolios, galleries, or any web page for visual inspiration. Filter out small icons/thumbnails with min_width. Already-posted images are automatically excluded.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to browse for images (any publicly accessible web page)',
        },
        min_width: {
          type: 'number',
          description: 'Minimum image width in pixels to include (default: 400). Filters out icons, thumbnails, and tracking pixels.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of images to return (default: 12, max: 20)',
        },
      },
      required: ['url'],
    },
  },
];
