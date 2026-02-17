import { logger } from '@modules/logger.js';
import { graphemeLen } from '@atproto/common-web';
import { isEmpty } from '@common/strings.js';
import { PORTABLE_MAX_GRAPHEMES } from '@common/strings.js';
import { processBase64ImageForUpload, processFileImageForUpload } from '@common/image-processor.js';
import * as atproto from '@adapters/atproto/index.js';
import * as fs from 'fs';
import type { ToolCall, ToolResult } from '@modules/tools.js';
import { markInteractionResponded, recordOriginalPost } from '@modules/engagement.js';
import { hasAgentRepliedInThread } from '@adapters/atproto/get-post-thread.js';
import { ui } from '@modules/ui.js';
import { outboundQueue } from '@modules/outbound-queue.js';
import {
  logPost,
  type PostLogEntry,
} from '@modules/post-log.js';

const BLUESKY_MAX_GRAPHEMES = PORTABLE_MAX_GRAPHEMES;

export async function handleBlueskyPost(call: ToolCall, config: any): Promise<ToolResult> {
  const text = call.input.text as string;
  const textGraphemes = graphemeLen(text);
  if (textGraphemes > BLUESKY_MAX_GRAPHEMES) {
    return {
      tool_use_id: call.id,
      content: `Error: Post is ${textGraphemes} graphemes, but Bluesky limit is ${BLUESKY_MAX_GRAPHEMES}. Shorten your post and try again.`,
      is_error: true,
    };
  }
  const queueCheck = await outboundQueue.enqueue('post', text);
  if (!queueCheck.allowed) {
    return { tool_use_id: call.id, content: `Blocked: ${queueCheck.reason}`, is_error: true };
  }

  const result = await atproto.createPost({ text });
  if (result.success) {
    ui.social(`${config.agent.name}`, text);
    recordOriginalPost();
    return { tool_use_id: call.id, content: JSON.stringify({ success: true, uri: result.data.uri }) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleBlueskyPostWithImage(call: ToolCall, config: any): Promise<ToolResult> {
  const { text, image_path, image_base64, image_mime_type, alt_text } = call.input as {
    text: string;
    image_path?: string;
    image_base64?: string;
    image_mime_type?: string;
    alt_text: string;
  };

  const imagePostGraphemes = graphemeLen(text);
  if (imagePostGraphemes > BLUESKY_MAX_GRAPHEMES) {
    return {
      tool_use_id: call.id,
      content: `Error: Post text is ${imagePostGraphemes} graphemes, but Bluesky limit is ${BLUESKY_MAX_GRAPHEMES}. Shorten your text and try again.`,
      is_error: true,
    };
  }

  if (!image_path && (!image_base64 || image_base64.length === 0)) {
    return {
      tool_use_id: call.id,
      content: 'Error: Must provide either image_path (from curl_fetch) or image_base64',
      is_error: true,
    };
  }

  let processedImage;
  let imageFilePath: string | null = null;

  try {
    if (image_path) {
      if (!fs.existsSync(image_path)) {
        return {
          tool_use_id: call.id,
          content: `Error: Image file not found at ${image_path}`,
          is_error: true,
        };
      }

      imageFilePath = image_path;
      const stats = fs.statSync(image_path);
      logger.info('Processing image from file', {
        filePath: image_path,
        sizeKB: Math.round(stats.size / 1024),
      });

      processedImage = await processFileImageForUpload(image_path);
    } else {
      if (!image_mime_type || !image_mime_type.startsWith('image/')) {
        return {
          tool_use_id: call.id,
          content: `Error: Invalid image mime type "${image_mime_type}". Expected image/* (e.g., image/jpeg, image/png).`,
          is_error: true,
        };
      }

      const originalSizeBytes = Math.ceil(image_base64!.length * 0.75);
      logger.info('Processing image from base64', {
        originalMimeType: image_mime_type,
        originalSizeKB: Math.round(originalSizeBytes / 1024),
      });

      processedImage = await processBase64ImageForUpload(image_base64!);
    }

    logger.info('Image processed', {
      originalSizeKB: Math.round(processedImage.originalSize / 1024),
      processedSizeKB: Math.round(processedImage.processedSize / 1024),
      dimensions: `${processedImage.width}x${processedImage.height}`,
      mimeType: processedImage.mimeType,
    });
  } catch (err) {
    logger.error('Image processing failed', { error: String(err) });
    return { tool_use_id: call.id, content: `Error processing image: ${String(err)}`, is_error: true };
  }

  const uploadResult = await atproto.uploadBlob(processedImage.buffer, processedImage.mimeType);
  if (!uploadResult.success) {
    if (imageFilePath) {
      try { fs.unlinkSync(imageFilePath); } catch (e) { logger.warn('Failed to clean up image file', { filePath: imageFilePath, error: String(e) }); }
    }
    return { tool_use_id: call.id, content: `Error uploading image: ${uploadResult.error}`, is_error: true };
  }

  logger.info('Image blob uploaded', { blob: uploadResult.data.blob });

  const queueCheck = await outboundQueue.enqueue('post_with_image', text);
  if (!queueCheck.allowed) {
    return { tool_use_id: call.id, content: `Blocked: ${queueCheck.reason}`, is_error: true };
  }

  const postResult = await atproto.createPost({
    text,
    images: [{
      alt: alt_text,
      image: uploadResult.data.blob,
      aspectRatio: {
        width: processedImage.width,
        height: processedImage.height,
      },
    }],
  });

  if (imageFilePath) {
    try {
      fs.unlinkSync(imageFilePath);
      logger.info('Cleaned up image file', { filePath: imageFilePath });
    } catch (err) {
      logger.warn('Failed to clean up image file', { filePath: imageFilePath, error: String(err) });
    }
  }

  if (postResult.success) {
    ui.social(`${config.agent.name} (with image)`, text);

    const postUri = postResult.data.uri;
    const uriMatch = postUri.match(/at:\/\/([^\/]+)\/app\.bsky\.feed\.post\/([^\/]+)/);
    let bskyUrl = postUri;
    if (uriMatch) {
      bskyUrl = `https://bsky.app/profile/${uriMatch[1]}/post/${uriMatch[2]}`;
    }

    const imagePostLogEntry: PostLogEntry = {
      timestamp: new Date().toISOString(),
      bluesky: {
        post_uri: postResult.data.uri,
        post_cid: postResult.data.cid,
        bsky_url: bskyUrl,
      },
      source: {
        type: image_path ? 'url' : 'other',
        image_url: image_path,
      },
      content: {
        post_text: text,
        alt_text: alt_text,
        image_dimensions: {
          width: processedImage.width,
          height: processedImage.height,
        },
      },
    };
    logPost(imagePostLogEntry);
    recordOriginalPost();

    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        uri: postResult.data.uri,
        processedSize: processedImage.processedSize,
        dimensions: `${processedImage.width}x${processedImage.height}`,
      }),
    };
  }
  return { tool_use_id: call.id, content: `Error creating post: ${postResult.error}`, is_error: true };
}

export async function handleBlueskyReply(call: ToolCall, config: any): Promise<ToolResult> {
  const { text, post_uri, post_cid, root_uri, root_cid } = call.input as Record<string, string>;

  if (isEmpty(text)) {
    return { tool_use_id: call.id, content: 'Error: Reply text is required and cannot be empty', is_error: true };
  }
  const replyGraphemes = graphemeLen(text);
  if (replyGraphemes > BLUESKY_MAX_GRAPHEMES) {
    return {
      tool_use_id: call.id,
      content: `Error: Reply is ${replyGraphemes} graphemes, but Bluesky limit is ${BLUESKY_MAX_GRAPHEMES}. Shorten your reply and try again.`,
      is_error: true,
    };
  }
  if (!post_uri || !post_cid) {
    return { tool_use_id: call.id, content: 'Error: post_uri and post_cid are required to reply', is_error: true };
  }

  const alreadyReplied = await hasAgentRepliedInThread(post_uri);
  if (alreadyReplied) {
    logger.warn('Blocked duplicate reply attempt (API check)', { post_uri });
    return { tool_use_id: call.id, content: 'BLOCKED: You have already replied to this post. Replying multiple times to the same post is spam. Move on to the next notification.', is_error: true };
  }

  const replyRefsResult = await atproto.getReplyRefs(post_uri, post_cid, root_uri, root_cid);
  if (!replyRefsResult.success) {
    return { tool_use_id: call.id, content: `Error resolving reply refs: ${replyRefsResult.error}`, is_error: true };
  }

  const replyRefs = replyRefsResult.data;

  const queueCheck = await outboundQueue.enqueue('reply', text);
  if (!queueCheck.allowed) {
    return { tool_use_id: call.id, content: `Blocked: ${queueCheck.reason}`, is_error: true };
  }

  const result = await atproto.createPost({
    text,
    replyTo: {
      uri: replyRefs.parent.uri,
      cid: replyRefs.parent.cid,
      rootUri: replyRefs.root.uri,
      rootCid: replyRefs.root.cid,
    },
  });
  if (result.success) {
    ui.social(`${config.agent.name} (reply)`, text);
    markInteractionResponded(post_uri, result.data.uri);
    logger.info('Reply sent', { post_uri, reply_uri: result.data.uri });
    return { tool_use_id: call.id, content: JSON.stringify({ success: true, uri: result.data.uri }) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleBlueskyLike(call: ToolCall): Promise<ToolResult> {
  const { post_uri, post_cid } = call.input as Record<string, string>;
  const result = await atproto.likePost({ uri: post_uri, cid: post_cid });
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleBlueskyRepost(call: ToolCall): Promise<ToolResult> {
  const { post_uri, post_cid } = call.input as Record<string, string>;
  const result = await atproto.repost({ uri: post_uri, cid: post_cid });
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleBlueskyFollow(call: ToolCall): Promise<ToolResult> {
  const did = call.input.did as string;
  const result = await atproto.followUser({ did });
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleBlueskyUnfollow(call: ToolCall): Promise<ToolResult> {
  const followUri = call.input.follow_uri as string;
  const result = await atproto.unfollowUser(followUri);
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleBlueskyGetTimeline(call: ToolCall): Promise<ToolResult> {
  const limit = (call.input.limit as number) || 20;
  const result = await atproto.getTimeline({ limit });
  if (result.success) {
    const simplified = result.data.feed.map((item) => ({
      uri: item.post.uri,
      cid: item.post.cid,
      author: {
        did: item.post.author.did,
        handle: item.post.author.handle,
        displayName: item.post.author.displayName,
      },
      text: (item.post.record as { text?: string })?.text || '',
      likeCount: item.post.likeCount,
      repostCount: item.post.repostCount,
      replyCount: item.post.replyCount,
      indexedAt: item.post.indexedAt,
    }));
    return { tool_use_id: call.id, content: JSON.stringify(simplified) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleBlueskyGetNotifications(call: ToolCall): Promise<ToolResult> {
  const limit = (call.input.limit as number) || 20;
  const result = await atproto.getNotifications({ limit });
  if (result.success) {
    const simplified = result.data.notifications.map((n) => ({
      uri: n.uri,
      cid: n.cid,
      reason: n.reason,
      author: {
        did: n.author.did,
        handle: n.author.handle,
        displayName: n.author.displayName,
      },
      isRead: n.isRead,
      indexedAt: n.indexedAt,
    }));
    return { tool_use_id: call.id, content: JSON.stringify(simplified) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleBlueskyGetProfile(call: ToolCall): Promise<ToolResult> {
  const actor = call.input.actor as string;
  const result = await atproto.getProfile(actor);
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify(result.data) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleBlueskyGetFollowers(call: ToolCall): Promise<ToolResult> {
  const { actor, limit = 50 } = call.input as { actor: string; limit?: number };
  const result = await atproto.getFollowers({ actor, limit });
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify(result.data.followers) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}

export async function handleBlueskyGetFollows(call: ToolCall): Promise<ToolResult> {
  const { actor, limit = 50 } = call.input as { actor: string; limit?: number };
  const result = await atproto.getFollows({ actor, limit });
  if (result.success) {
    return { tool_use_id: call.id, content: JSON.stringify(result.data.follows) };
  }
  return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
}
