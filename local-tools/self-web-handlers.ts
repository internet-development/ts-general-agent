import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { logger } from '@modules/logger.js';
import { getConfig } from '@modules/config.js';
import { getRepoRoot } from '@modules/sandbox.js';
import type { ToolCall, ToolResult } from '@modules/tools.js';
import { isEmpty, truncateGraphemes } from '@common/strings.js';
import { processFileImageForUpload } from '@common/image-processor.js';
import * as atproto from '@adapters/atproto/index.js';
import * as arena from '@adapters/arena/index.js';
import { markInteractionResponded } from '@modules/engagement.js';
import { ui } from '@modules/ui.js';
import {
  logPost,
  type PostLogEntry,
} from '@modules/post-log.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const VERSION = pkg.version || '0.0.0';

//NOTE(self): Web image dedup helpers — track which image URLs have been posted
const WEB_IMAGES_POSTED_PATH = '.memory/web_images_posted.json';

interface WebImagePostedEntry {
  url: string;
  postedAt: string;
  pageUrl?: string;
  pageTitle?: string;
}

function loadWebImagesPosted(): Set<string> {
  try {
    if (fs.existsSync(WEB_IMAGES_POSTED_PATH)) {
      const content = fs.readFileSync(WEB_IMAGES_POSTED_PATH, 'utf8');
      const entries: WebImagePostedEntry[] = JSON.parse(content);
      return new Set(entries.map(e => e.url));
    }
  } catch (e) {
    logger.warn('Failed to load web images posted', { error: String(e) });
  }
  return new Set();
}

export function recordWebImagePosted(imageUrl: string, metadata?: { pageUrl?: string; pageTitle?: string }): void {
  try {
    let entries: WebImagePostedEntry[] = [];
    if (fs.existsSync(WEB_IMAGES_POSTED_PATH)) {
      const content = fs.readFileSync(WEB_IMAGES_POSTED_PATH, 'utf8');
      entries = JSON.parse(content);
    }
    entries.push({
      url: imageUrl,
      postedAt: new Date().toISOString(),
      pageUrl: metadata?.pageUrl,
      pageTitle: metadata?.pageTitle,
    });
    fs.writeFileSync(WEB_IMAGES_POSTED_PATH, JSON.stringify(entries, null, 2));
  } catch (e) {
    logger.warn('Failed to record web image posted', { error: String(e) });
  }
}

export async function handleWebFetch(call: ToolCall): Promise<ToolResult> {
  const { url, extract = 'text' } = call.input as {
    url: string;
    extract?: 'text' | 'html' | 'json';
  };

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': `ts-general-agent/${VERSION} (Autonomous Agent)`,
        'Accept': extract === 'json' ? 'application/json' : 'text/html,text/plain,*/*',
      },
    });

    if (!response.ok) {
      return {
        tool_use_id: call.id,
        content: `Error: HTTP ${response.status} ${response.statusText}`,
        is_error: true,
      };
    }

    if (extract === 'json') {
      const data = await response.json();
      return { tool_use_id: call.id, content: JSON.stringify(data) };
    }

    const html = await response.text();

    if (extract === 'html') {
      return { tool_use_id: call.id, content: html.slice(0, 50000) };
    }

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30000);

    return { tool_use_id: call.id, content: text };
  } catch (error) {
    return {
      tool_use_id: call.id,
      content: `Error: ${String(error)}`,
      is_error: true,
    };
  }
}

export async function handleCurlFetch(call: ToolCall): Promise<ToolResult> {
  const { url, max_size_mb = 5 } = call.input as {
    url: string;
    max_size_mb?: number;
  };

  const maxBytes = Math.min(max_size_mb, 10) * 1024 * 1024;
  const repoRoot = getRepoRoot();

  const imagesDir = path.join(repoRoot, '.memory', 'images');
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const randomId = Math.random().toString(36).slice(2, 8);
  const tempFile = path.join(imagesDir, `${dateStr}-${randomId}`);

  try {
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
  } catch (err) {
    return {
      tool_use_id: call.id,
      content: `Error: Failed to create images directory: ${String(err)}`,
      is_error: true,
    };
  }

  return new Promise((resolve) => {
    const curl = spawn('curl', [
      '-sS',
      '-L',
      '-f',
      '--max-filesize', maxBytes.toString(),
      '--max-time', '30',
      '-o', tempFile,
      '-w', '%{http_code}:%{content_type}',
      '-H', `User-Agent: ts-general-agent/${VERSION} (Autonomous Agent)`,
      url,
    ]);

    let stderr = '';
    let writeOutput = '';

    curl.stdout.on('data', (data: Buffer) => {
      writeOutput += data.toString();
    });

    curl.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    curl.on('close', (code) => {
      if (code !== 0) {
        try { fs.unlinkSync(tempFile); } catch (e) { logger.warn('Failed to clean up temp file', { file: tempFile, error: String(e) }); }

        let errorMsg = `curl exited with code ${code}`;
        if (code === 22) {
          errorMsg = `HTTP error (URL returned 4xx/5xx status)`;
        } else if (code === 63) {
          errorMsg = `File too large (exceeded ${max_size_mb}MB limit)`;
        }
        if (stderr) {
          errorMsg += `. ${stderr.trim()}`;
        }
        resolve({
          tool_use_id: call.id,
          content: `Error: ${errorMsg}`,
          is_error: true,
        });
        return;
      }

      const [httpCode, contentType] = writeOutput.split(':');
      let mimeType = contentType?.trim() || 'application/octet-stream';
      mimeType = mimeType.split(';')[0].trim();

      let fileSize: number;
      try {
        const stats = fs.statSync(tempFile);
        fileSize = stats.size;
      } catch (err) {
        resolve({
          tool_use_id: call.id,
          content: `Error: Failed to read downloaded file: ${String(err)}`,
          is_error: true,
        });
        return;
      }

      if (fileSize === 0) {
        try { fs.unlinkSync(tempFile); } catch (e) { logger.warn('Failed to clean up temp file', { file: tempFile, error: String(e) }); }
        resolve({
          tool_use_id: call.id,
          content: 'Error: URL returned empty response',
          is_error: true,
        });
        return;
      }

      if (mimeType === 'application/octet-stream' || !mimeType.startsWith('image/')) {
        try {
          const fd = fs.openSync(tempFile, 'r');
          const magicBytes = Buffer.alloc(12);
          fs.readSync(fd, magicBytes, 0, 12, 0);
          fs.closeSync(fd);

          if (magicBytes[0] === 0xFF && magicBytes[1] === 0xD8) {
            mimeType = 'image/jpeg';
          } else if (magicBytes[0] === 0x89 && magicBytes[1] === 0x50 && magicBytes[2] === 0x4E && magicBytes[3] === 0x47) {
            mimeType = 'image/png';
          } else if (magicBytes[0] === 0x47 && magicBytes[1] === 0x49 && magicBytes[2] === 0x46) {
            mimeType = 'image/gif';
          } else if (magicBytes[0] === 0x52 && magicBytes[1] === 0x49 && magicBytes[2] === 0x46 && magicBytes[3] === 0x46 &&
                     magicBytes[8] === 0x57 && magicBytes[9] === 0x45 && magicBytes[10] === 0x42 && magicBytes[11] === 0x50) {
            mimeType = 'image/webp';
          }

          const firstChars = magicBytes.toString('utf8').toLowerCase();
          if (firstChars.includes('<!do') || firstChars.includes('<htm') || firstChars.includes('<?xm')) {
            try { fs.unlinkSync(tempFile); } catch (e) { logger.warn('Failed to clean up temp file', { file: tempFile, error: String(e) }); }
            resolve({
              tool_use_id: call.id,
              content: 'Error: URL returned HTML/XML instead of binary data (likely an error page)',
              is_error: true,
            });
            return;
          }
        } catch (e) {
          logger.warn('Failed to read magic bytes', { file: tempFile, error: String(e) });
        }
      }

      const extMap: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'application/octet-stream': '.bin',
      };
      const ext = extMap[mimeType] || '.bin';
      const finalPath = tempFile + ext;

      try {
        fs.renameSync(tempFile, finalPath);
      } catch (err) {
        logger.warn('Failed to rename temp file', { from: tempFile, to: finalPath, error: String(err) });
      }

      const usePath = fs.existsSync(finalPath) ? finalPath : tempFile;

      resolve({
        tool_use_id: call.id,
        content: JSON.stringify({
          success: true,
          filePath: usePath,
          size: fileSize,
          sizeKB: Math.round(fileSize / 1024),
          mimeType,
          isImage: mimeType.startsWith('image/'),
          httpCode: parseInt(httpCode) || 200,
        }),
      });
    });

    curl.on('error', (err) => {
      try { fs.unlinkSync(tempFile); } catch (e) { logger.warn('Failed to clean up temp file', { file: tempFile, error: String(e) }); }
      resolve({
        tool_use_id: call.id,
        content: `Error: ${err.message}`,
        is_error: true,
      });
    });
  });
}

export async function handleArenaSearch(call: ToolCall): Promise<ToolResult> {
  const { query, page, per } = call.input as { query: string; page?: number; per?: number };

  if (isEmpty(query)) {
    return { tool_use_id: call.id, content: 'Error: Search query is required', is_error: true };
  }

  const searchResult = await arena.searchChannels({ query: query.trim(), page, per });
  if (!searchResult.success) {
    return { tool_use_id: call.id, content: `Error searching Are.na: ${searchResult.error}`, is_error: true };
  }

  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      success: true,
      query,
      channels: searchResult.data.channels.map(ch => ({
        title: ch.title,
        slug: ch.slug,
        blockCount: ch.length,
        owner: ch.user?.slug || ch.user?.username || 'unknown',
        channel_url: `https://www.are.na/${ch.user?.slug || ch.user?.username}/${ch.slug}`,
      })),
      totalResults: searchResult.data.totalResults,
    }),
    is_error: false,
  };
}

export async function handleArenaFetchChannel(call: ToolCall): Promise<ToolResult> {
  const { channel_url } = call.input as { channel_url: string };

  let owner: string;
  let slug: string;

  const parsed = arena.parseChannelUrl(channel_url);
  if (parsed) {
    owner = parsed.owner;
    slug = parsed.slug;
  } else if (channel_url.includes('/')) {
    [owner, slug] = channel_url.split('/');
  } else {
    return {
      tool_use_id: call.id,
      content: 'Error: Invalid channel URL. Use https://www.are.na/owner/slug or owner/slug format',
      is_error: true,
    };
  }

  const result = await arena.fetchChannel({ owner, slug });
  if (!result.success) {
    return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
  }

  const simplified = result.data.imageBlocks.map((block) => ({
    id: block.id,
    title: block.title || block.generated_title,
    description: block.description ? truncateGraphemes(block.description) : undefined,
    imageUrl: block.image?.original?.url,
    sourceUrl: block.source?.url || `https://www.are.na/block/${block.id}`,
    connected_at: block.connected_at,
  }));

  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      channel: result.data.channel.title,
      totalBlocks: result.data.totalBlocks,
      imageBlocks: result.data.imageBlocks.length,
      blocks: simplified,
    }),
  };
}

export async function handleArenaPostImage(call: ToolCall, config: any): Promise<ToolResult> {
  const { channel_url, text: customText, reply_to } = call.input as {
    channel_url: string;
    text?: string;
    reply_to?: {
      post_uri: string;
      post_cid: string;
      root_uri?: string;
      root_cid?: string;
    };
  };

  let owner: string;
  let slug: string;

  const parsed = arena.parseChannelUrl(channel_url);
  if (parsed) {
    owner = parsed.owner;
    slug = parsed.slug;
  } else if (channel_url.includes('/')) {
    [owner, slug] = channel_url.split('/');
  } else {
    return {
      tool_use_id: call.id,
      content: 'Error: Invalid channel URL. Use https://www.are.na/owner/slug or owner/slug format',
      is_error: true,
    };
  }

  const repoRoot = getRepoRoot();
  const postedPath = path.join(repoRoot, '.memory', 'arena_posted.json');
  let postedIds: number[] = [];
  try {
    if (fs.existsSync(postedPath)) {
      const content = fs.readFileSync(postedPath, 'utf8');
      postedIds = JSON.parse(content);
    }
  } catch (e) {
    logger.warn('Failed to load arena posted IDs', { path: postedPath, error: String(e) });
    postedIds = [];
  }

  const channelResult = await arena.fetchChannel({ owner, slug });
  if (!channelResult.success) {
    return { tool_use_id: call.id, content: `Error fetching channel: ${channelResult.error}`, is_error: true };
  }

  const { imageBlocks, channel } = channelResult.data;

  const unpostedBlocks = imageBlocks.filter((block) => !postedIds.includes(block.id));

  if (unpostedBlocks.length === 0) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: false,
        error: 'No unposted images remaining in channel',
        channel: channel.title,
        totalImages: imageBlocks.length,
        alreadyPosted: postedIds.length,
      }),
      is_error: true,
    };
  }

  const selectedBlock = unpostedBlocks[Math.floor(Math.random() * unpostedBlocks.length)];
  const imageUrl = selectedBlock.image?.original?.url;

  if (!imageUrl) {
    return {
      tool_use_id: call.id,
      content: 'Error: Selected block has no image URL',
      is_error: true,
    };
  }

  const imagesDir = path.join(repoRoot, '.memory', 'images');
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const randomId = Math.random().toString(36).slice(2, 8);
  const tempFile = path.join(imagesDir, `arena-${dateStr}-${randomId}`);

  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  const curlResult = await new Promise<{ success: boolean; filePath?: string; mimeType?: string; error?: string }>((resolve) => {
    const curl = spawn('curl', [
      '-sS', '-L', '-f',
      '--max-filesize', (10 * 1024 * 1024).toString(),
      '--max-time', '30',
      '-o', tempFile,
      '-w', '%{http_code}:%{content_type}',
      '-H', `User-Agent: ts-general-agent/${VERSION} (Autonomous Agent)`,
      imageUrl,
    ]);

    let writeOutput = '';
    let stderr = '';

    curl.stdout.on('data', (data: Buffer) => { writeOutput += data.toString(); });
    curl.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    curl.on('close', (code) => {
      if (code !== 0) {
        try { fs.unlinkSync(tempFile); } catch (e) { logger.warn('Failed to clean up temp file', { file: tempFile, error: String(e) }); }
        resolve({ success: false, error: `curl failed: ${stderr || `exit code ${code}`}` });
        return;
      }

      const [, contentType] = writeOutput.split(':');
      let mimeType = contentType?.trim()?.split(';')[0] || 'image/jpeg';

      try {
        const fd = fs.openSync(tempFile, 'r');
        const magicBytes = Buffer.alloc(12);
        fs.readSync(fd, magicBytes, 0, 12, 0);
        fs.closeSync(fd);

        if (magicBytes[0] === 0xFF && magicBytes[1] === 0xD8) mimeType = 'image/jpeg';
        else if (magicBytes[0] === 0x89 && magicBytes[1] === 0x50) mimeType = 'image/png';
        else if (magicBytes[0] === 0x47 && magicBytes[1] === 0x49) mimeType = 'image/gif';
        else if (magicBytes[0] === 0x52 && magicBytes[1] === 0x49 && magicBytes[8] === 0x57) mimeType = 'image/webp';
      } catch (e) { logger.warn('Failed to detect mime from magic bytes', { file: tempFile, error: String(e) }); }

      const extMap: Record<string, string> = {
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
      };
      const ext = extMap[mimeType] || '.jpg';
      const finalPath = tempFile + ext;

      try {
        fs.renameSync(tempFile, finalPath);
        resolve({ success: true, filePath: finalPath, mimeType });
      } catch (e) {
        logger.warn('Failed to rename temp file, using original', { tempFile, finalPath, error: String(e) });
        resolve({ success: true, filePath: tempFile, mimeType });
      }
    });

    curl.on('error', (err) => {
      try { fs.unlinkSync(tempFile); } catch (e) { logger.warn('Failed to clean up temp file', { file: tempFile, error: String(e) }); }
      resolve({ success: false, error: err.message });
    });
  });

  if (!curlResult.success || !curlResult.filePath) {
    return {
      tool_use_id: call.id,
      content: `Error downloading image: ${curlResult.error}`,
      is_error: true,
    };
  }

  let processedImage;
  try {
    processedImage = await processFileImageForUpload(curlResult.filePath);
  } catch (err) {
    try { fs.unlinkSync(curlResult.filePath); } catch (e) { logger.warn('Failed to clean up temp file', { file: curlResult.filePath, error: String(e) }); }
    return {
      tool_use_id: call.id,
      content: `Error processing image: ${String(err)}`,
      is_error: true,
    };
  }

  const uploadResult = await atproto.uploadBlob(processedImage.buffer, processedImage.mimeType);
  if (!uploadResult.success) {
    try { fs.unlinkSync(curlResult.filePath); } catch (e) { logger.warn('Failed to clean up temp file', { file: curlResult.filePath, error: String(e) }); }
    return {
      tool_use_id: call.id,
      content: `Error uploading to Bluesky: ${uploadResult.error}`,
      is_error: true,
    };
  }

  const blockTitle = selectedBlock.title || selectedBlock.generated_title || 'Untitled';
  const sourceUrl = selectedBlock.source?.url || `https://www.are.na/block/${selectedBlock.id}`;

  let postText: string;
  const sourcePrefix = '\n\nSource: ';
  if (customText) {
    const maxCustomLen = 300 - sourcePrefix.length - sourceUrl.length;
    postText = customText.length > maxCustomLen
      ? customText.slice(0, maxCustomLen - 3) + '...'
      : customText;
    postText += sourcePrefix + sourceUrl;
  } else {
    postText = blockTitle;
    const maxTitleLen = 300 - sourcePrefix.length - sourceUrl.length;
    if (postText.length > maxTitleLen) {
      postText = postText.slice(0, maxTitleLen - 3) + '...';
    }
    postText += sourcePrefix + sourceUrl;
  }

  let altText = blockTitle;
  if (selectedBlock.description) {
    altText += ` - ${selectedBlock.description.slice(0, 500)}`;
  }

  const postParams: Parameters<typeof atproto.createPost>[0] = {
    text: postText,
    images: [{
      alt: altText,
      image: uploadResult.data.blob,
      aspectRatio: {
        width: processedImage.width,
        height: processedImage.height,
      },
    }],
  };

  if (reply_to) {
    const replyRefsResult = await atproto.getReplyRefs(
      reply_to.post_uri,
      reply_to.post_cid,
      reply_to.root_uri,
      reply_to.root_cid
    );
    if (!replyRefsResult.success) {
      try { fs.unlinkSync(curlResult.filePath); } catch (e) { logger.warn('Failed to clean up temp file', { file: curlResult.filePath, error: String(e) }); }
      return {
        tool_use_id: call.id,
        content: `Error resolving reply refs: ${replyRefsResult.error}`,
        is_error: true,
      };
    }
    postParams.replyTo = {
      uri: replyRefsResult.data.parent.uri,
      cid: replyRefsResult.data.parent.cid,
      rootUri: replyRefsResult.data.root.uri,
      rootCid: replyRefsResult.data.root.cid,
    };
  }

  const postResult = await atproto.createPost(postParams);

  try { fs.unlinkSync(curlResult.filePath); } catch (e) { logger.warn('Failed to clean up temp file', { file: curlResult.filePath, error: String(e) }); }

  if (!postResult.success) {
    return {
      tool_use_id: call.id,
      content: `Error creating post: ${postResult.error}`,
      is_error: true,
    };
  }

  ui.social(`${config.agent.name} (arena image)`, postText);

  postedIds.push(selectedBlock.id);
  try {
    fs.writeFileSync(postedPath, JSON.stringify(postedIds, null, 2));
  } catch (err) {
    logger.warn('Failed to save arena_posted.json', { error: String(err) });
  }

  const postUri = postResult.data.uri;
  const uriMatch = postUri.match(/at:\/\/([^\/]+)\/app\.bsky\.feed\.post\/([^\/]+)/);
  let bskyUrl = postUri;
  if (uriMatch) {
    bskyUrl = `https://bsky.app/profile/${uriMatch[1]}/post/${uriMatch[2]}`;
  }

  if (reply_to) {
    markInteractionResponded(reply_to.post_uri, postResult.data.uri);
  }

  const hasOriginalSource = !!selectedBlock.source?.url;
  const postLogEntry: PostLogEntry = {
    timestamp: new Date().toISOString(),
    bluesky: {
      post_uri: postResult.data.uri,
      post_cid: postResult.data.cid,
      bsky_url: bskyUrl,
    },
    source: {
      type: 'arena',
      channel_url: `https://www.are.na/${owner}/${slug}`,
      block_id: selectedBlock.id,
      block_url: `https://www.are.na/block/${selectedBlock.id}`,
      block_title: blockTitle,
      filename: selectedBlock.filename,
      original_url: selectedBlock.source?.url,
      source_provider: selectedBlock.source?.provider?.name,
      image_url: imageUrl,
      arena_user: selectedBlock.user ? {
        username: selectedBlock.user.username,
        full_name: selectedBlock.user.full_name,
      } : undefined,
      needs_attribution_followup: !hasOriginalSource,
    },
    content: {
      post_text: postText,
      alt_text: altText,
      image_dimensions: {
        width: processedImage.width,
        height: processedImage.height,
      },
    },
    reply_context: reply_to ? {
      parent_uri: reply_to.post_uri,
      parent_cid: reply_to.post_cid,
      root_uri: reply_to.root_uri,
      root_cid: reply_to.root_cid,
    } : undefined,
  };
  logPost(postLogEntry);

  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      success: true,
      bskyUrl,
      uri: postResult.data.uri,
      blockId: selectedBlock.id,
      blockTitle,
      channel: channel.title,
      remainingUnposted: unpostedBlocks.length - 1,
    }),
  };
}

export async function handleWebBrowseImages(call: ToolCall): Promise<ToolResult> {
  const { url: browseUrl, min_width = 400, max_results = 12 } = call.input as {
    url: string;
    min_width?: number;
    max_results?: number;
  };

  const cappedMaxResults = Math.min(max_results, 20);

  try {
    const pageResponse = await fetch(browseUrl, {
      headers: {
        'User-Agent': `ts-general-agent/${VERSION} (Autonomous Agent)`,
        'Accept': 'text/html,*/*',
      },
    });

    if (!pageResponse.ok) {
      return {
        tool_use_id: call.id,
        content: `Error: HTTP ${pageResponse.status} ${pageResponse.statusText}`,
        is_error: true,
      };
    }

    const html = await pageResponse.text();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : '';

    interface RawImage {
      url: string;
      alt: string;
      width: number;
      height: number;
      context: string;
    }
    const rawImages: RawImage[] = [];
    const seenUrls = new Set<string>();

    const resolveUrl = (src: string): string | null => {
      if (!src || src.startsWith('data:') || src.endsWith('.svg')) return null;
      try {
        return new URL(src, browseUrl).href;
      } catch {
        return null;
      }
    };

    const imgRegex = /<img\s+([^>]+)>/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      const attrs = imgMatch[1];
      const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
      const altMatch = attrs.match(/alt\s*=\s*["']([^"']*?)["']/i);
      const widthMatch = attrs.match(/width\s*=\s*["']?(\d+)["']?/i);
      const heightMatch = attrs.match(/height\s*=\s*["']?(\d+)["']?/i);

      const srcsetMatch = attrs.match(/srcset\s*=\s*["']([^"']+)["']/i);
      let bestSrc = srcMatch ? srcMatch[1] : null;
      let bestWidth = widthMatch ? parseInt(widthMatch[1]) : 0;

      if (srcsetMatch) {
        const candidates = srcsetMatch[1].split(',').map(s => s.trim());
        let maxW = bestWidth;
        for (const candidate of candidates) {
          const parts = candidate.split(/\s+/);
          if (parts.length >= 2) {
            const wMatch = parts[1].match(/(\d+)w/);
            if (wMatch) {
              const w = parseInt(wMatch[1]);
              if (w > maxW) {
                maxW = w;
                bestSrc = parts[0];
                bestWidth = w;
              }
            }
          }
        }
      }

      if (!bestSrc) continue;
      const resolved = resolveUrl(bestSrc);
      if (!resolved || seenUrls.has(resolved)) continue;
      seenUrls.add(resolved);

      rawImages.push({
        url: resolved,
        alt: altMatch ? altMatch[1] : '',
        width: bestWidth,
        height: heightMatch ? parseInt(heightMatch[1]) : 0,
        context: '',
      });
    }

    const ogImageRegex = /<meta\s+[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let ogMatch;
    while ((ogMatch = ogImageRegex.exec(html)) !== null) {
      const resolved = resolveUrl(ogMatch[1]);
      if (resolved && !seenUrls.has(resolved)) {
        seenUrls.add(resolved);
        rawImages.push({ url: resolved, alt: '', width: 0, height: 0, context: 'og:image' });
      }
    }

    const sourceRegex = /<source\s+[^>]*srcset\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let sourceMatch;
    while ((sourceMatch = sourceRegex.exec(html)) !== null) {
      const candidates = sourceMatch[1].split(',').map(s => s.trim());
      let best = candidates[0]?.split(/\s+/)[0];
      let maxW = 0;
      for (const candidate of candidates) {
        const parts = candidate.split(/\s+/);
        const wMatch = parts[1]?.match(/(\d+)w/);
        if (wMatch && parseInt(wMatch[1]) > maxW) {
          maxW = parseInt(wMatch[1]);
          best = parts[0];
        }
      }
      if (best) {
        const resolved = resolveUrl(best);
        if (resolved && !seenUrls.has(resolved)) {
          seenUrls.add(resolved);
          rawImages.push({ url: resolved, alt: '', width: maxW, height: 0, context: 'picture source' });
        }
      }
    }

    const bgRegex = /background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi;
    let bgMatch;
    while ((bgMatch = bgRegex.exec(html)) !== null) {
      const resolved = resolveUrl(bgMatch[1]);
      if (resolved && !seenUrls.has(resolved)) {
        seenUrls.add(resolved);
        rawImages.push({ url: resolved, alt: '', width: 0, height: 0, context: 'background-image' });
      }
    }

    const postedSet = loadWebImagesPosted();
    const filtered = rawImages.filter(img => {
      if (img.width > 0 && img.width < min_width) return false;
      if (img.width > 0 && img.width <= 10) return false;
      if (img.height > 0 && img.height <= 10) return false;
      if (postedSet.has(img.url)) return false;
      if (/pixel|tracking|beacon|spacer|blank|logo.*small|favicon/i.test(img.url)) return false;
      return true;
    });

    const results = filtered.slice(0, cappedMaxResults);

    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        pageTitle,
        pageUrl: browseUrl,
        images: results.map(img => ({
          url: img.url,
          alt: img.alt,
          context: img.context,
          width: img.width || null,
          height: img.height || null,
        })),
        totalFound: rawImages.length,
        totalReturned: results.length,
        filteredOut: rawImages.length - filtered.length,
      }),
    };
  } catch (error) {
    return {
      tool_use_id: call.id,
      content: `Error browsing ${browseUrl}: ${String(error)}`,
      is_error: true,
    };
  }
}
