import * as path from 'path';
import { logger } from '@modules/logger.js';
import {
  safeReadFile,
  safeWriteFile,
  getRepoRoot,
} from '@modules/sandbox.js';
import type { ToolCall, ToolResult } from '@modules/tools.js';
import * as atproto from '@adapters/atproto/index.js';
import * as github from '@adapters/github/index.js';
import { runClaudeCode } from '@local-tools/self-improve-run.js';
import { renderSkillSection } from '@modules/skills.js';
import {
  markConversationConcluded as markBlueskyConversationConcluded,
  getConversation as getBlueskyConversation,
} from '@modules/bluesky-engagement.js';
import {
  markConversationConcluded as markGitHubConversationConcluded,
  getConversation as getGitHubConversation,
} from '@modules/github-engagement.js';
import { isWatchingWorkspace } from '@modules/github-workspace-discovery.js';
import { ui } from '@modules/ui.js';
import {
  lookupPostByUri,
  lookupPostByBskyUrl,
  generatePostContext,
  formatSourceAttribution,
  hasCompleteAttribution,
  getPostsNeedingAttributionFollowup,
  markPostNeedsAttributionFollowup,
  updatePostAttribution,
} from '@modules/post-log.js';

export async function handleSelfUpdate(call: ToolCall): Promise<ToolResult> {
  const content = call.input.content as string;
  const repoRoot = getRepoRoot();
  const fullPath = path.join(repoRoot, 'SELF.md');

  if (safeWriteFile(fullPath, content)) {
    return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
  }
  return { tool_use_id: call.id, content: 'Error: Failed to update SELF.md', is_error: true };
}

export async function handleSelfRead(call: ToolCall): Promise<ToolResult> {
  const repoRoot = getRepoRoot();
  const fullPath = path.join(repoRoot, 'SELF.md');
  const content = safeReadFile(fullPath);

  if (content !== null) {
    return { tool_use_id: call.id, content };
  }
  return { tool_use_id: call.id, content: 'Error: Failed to read SELF.md', is_error: true };
}

export async function handleLookupPostContext(call: ToolCall): Promise<ToolResult> {
  const { post_uri, bsky_url } = call.input as {
    post_uri?: string;
    bsky_url?: string;
  };

  if (!post_uri && !bsky_url) {
    return {
      tool_use_id: call.id,
      content: 'Error: Must provide either post_uri or bsky_url to look up',
      is_error: true,
    };
  }

  let entry = null;
  if (post_uri) {
    entry = lookupPostByUri(post_uri);
  }
  if (!entry && bsky_url) {
    entry = lookupPostByBskyUrl(bsky_url);
  }

  if (!entry) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: false,
        error: 'Post not found in log. This might be an older post from before context logging was enabled.',
      }),
    };
  }

  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      success: true,
      context: generatePostContext(entry),
      raw: entry,
    }),
  };
}

export async function handleGetPostsNeedingAttribution(call: ToolCall): Promise<ToolResult> {
  const { limit = 10 } = call.input as { limit?: number };

  const posts = getPostsNeedingAttributionFollowup(limit);

  if (posts.length === 0) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        message: 'No posts currently need attribution follow-up. All sources are properly credited!',
        count: 0,
        posts: [],
      }),
    };
  }

  const summaries = posts.map(post => ({
    bsky_url: post.bluesky.bsky_url,
    post_uri: post.bluesky.post_uri,
    posted_at: post.timestamp,
    block_title: post.source.block_title,
    block_url: post.source.block_url,
    filename: post.source.filename,
    arena_user: post.source.arena_user,
    source_provider: post.source.source_provider,
    notes: post.source.attribution_notes,
  }));

  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      success: true,
      count: posts.length,
      posts: summaries,
    }),
  };
}

export async function handleMarkAttributionFollowup(call: ToolCall): Promise<ToolResult> {
  const { post_uri, needs_followup, notes } = call.input as {
    post_uri: string;
    needs_followup: boolean;
    notes?: string;
  };

  const success = markPostNeedsAttributionFollowup(post_uri, needs_followup, notes);

  if (!success) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: false,
        error: 'Post not found in log',
      }),
    };
  }

  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      success: true,
      message: needs_followup
        ? 'Marked for attribution follow-up'
        : 'Attribution follow-up cleared',
    }),
  };
}

export async function handleUpdatePostAttribution(call: ToolCall): Promise<ToolResult> {
  const { post_uri, original_url, notes } = call.input as {
    post_uri: string;
    original_url: string;
    notes?: string;
  };

  const success = updatePostAttribution(post_uri, original_url, notes);

  if (!success) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: false,
        error: 'Post not found in log',
      }),
    };
  }

  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      success: true,
      message: `Attribution updated to: ${original_url}`,
    }),
  };
}

export async function handleFormatSourceAttribution(call: ToolCall): Promise<ToolResult> {
  const { post_uri, bsky_url } = call.input as {
    post_uri?: string;
    bsky_url?: string;
  };

  if (!post_uri && !bsky_url) {
    return {
      tool_use_id: call.id,
      content: 'Error: Must provide either post_uri or bsky_url to look up',
      is_error: true,
    };
  }

  let entry = null;
  if (post_uri) {
    entry = lookupPostByUri(post_uri);
  }
  if (!entry && bsky_url) {
    entry = lookupPostByBskyUrl(bsky_url);
  }

  if (!entry) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: false,
        error: 'Post not found in log',
      }),
    };
  }

  const attribution = formatSourceAttribution(entry);
  const complete = hasCompleteAttribution(entry);

  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      success: true,
      attribution,
      has_complete_attribution: complete,
      block_url: entry.source.block_url,
      original_url: entry.source.original_url,
      filename: entry.source.filename,
      source_provider: entry.source.source_provider,
      arena_user: entry.source.arena_user,
      note: complete ? null : 'Original creator not yet found. Consider using get_posts_needing_attribution to work on attribution backlog.',
    }),
  };
}

export async function handleGracefulExit(call: ToolCall, config: any): Promise<ToolResult> {
  const { platform, identifier, closing_type, closing_message, target_uri, target_cid, reason } = call.input as {
    platform: 'bluesky' | 'github';
    identifier: string;
    closing_type: 'message' | 'like';
    closing_message?: string;
    target_uri?: string;
    target_cid?: string;
    reason: string;
  };

  if (closing_type === 'message' && !closing_message) {
    return {
      tool_use_id: call.id,
      content: 'Error: closing_message is required when closing_type is "message"',
      is_error: true,
    };
  }

  if (platform === 'bluesky') {
    if (!target_uri || !target_cid) {
      return {
        tool_use_id: call.id,
        content: 'Error: target_uri and target_cid are required for Bluesky graceful_exit (the post to reply to or like)',
        is_error: true,
      };
    }

    let closingResult: { success: boolean; error?: string; data?: { uri: string } };

    if (closing_type === 'message') {
      const replyRefsResult = await atproto.getReplyRefs(target_uri, target_cid);
      if (!replyRefsResult.success) {
        return {
          tool_use_id: call.id,
          content: `Error resolving reply refs: ${replyRefsResult.error}`,
          is_error: true,
        };
      }
      const replyRefs = replyRefsResult.data;

      closingResult = await atproto.createPost({
        text: closing_message!,
        replyTo: {
          uri: replyRefs.parent.uri,
          cid: replyRefs.parent.cid,
          rootUri: replyRefs.root.uri,
          rootCid: replyRefs.root.cid,
        },
      });
      if (closingResult.success) {
        ui.social(`${config.agent.name}`, closing_message!);
      }
    } else {
      closingResult = await atproto.likePost({ uri: target_uri, cid: target_cid });
    }

    if (!closingResult.success) {
      return {
        tool_use_id: call.id,
        content: `Error sending closing gesture: ${closingResult.error}`,
        is_error: true,
      };
    }

    markBlueskyConversationConcluded(identifier, reason);

    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        platform: 'bluesky',
        identifier,
        closing_type,
        closing_message: closing_type === 'message' ? closing_message : '(liked post)',
        reason,
        message: 'Conversation gracefully concluded. Left with warmth, not silence.',
      }),
    };
  }

  if (platform === 'github') {
    const match = identifier.match(/^([^\/]+)\/([^#]+)#(\d+)$/);
    if (!match) {
      return {
        tool_use_id: call.id,
        content: 'Error: GitHub identifier must be in owner/repo#number format (e.g., "anthropics/claude-code#123")',
        is_error: true,
      };
    }

    const [, owner, repo, numberStr] = match;
    const number = parseInt(numberStr, 10);

    if (closing_type === 'message') {
      const commentResult = await github.createIssueComment({
        owner,
        repo,
        issue_number: number,
        body: closing_message!,
      });
      if (!commentResult.success) {
        return {
          tool_use_id: call.id,
          content: `Error sending closing comment: ${commentResult.error}`,
          is_error: true,
        };
      }
    }
    if (closing_type === 'like') {
      const reactionResult = await github.createIssueReaction(owner, repo, number, 'heart');
      if (!reactionResult.success) {
        logger.warn('Failed to add closing reaction', { error: reactionResult.error });
      }
    }

    markGitHubConversationConcluded(owner, repo, number, reason);

    if (isWatchingWorkspace(owner, repo)) {
      const closeResult = await github.updateIssue({
        owner,
        repo,
        issue_number: number,
        state: 'closed',
      });
      if (closeResult.success) {
        logger.info('Auto-closed workspace issue after graceful_exit', { owner, repo, number });
      } else {
        logger.warn('Failed to auto-close workspace issue', { error: closeResult.error });
      }
    }

    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        platform: 'github',
        identifier,
        closing_type,
        closing_message: closing_type === 'message' ? closing_message : '(reacted with heart)',
        reason,
        message: 'Conversation gracefully concluded.',
      }),
    };
  }

  return {
    tool_use_id: call.id,
    content: `Error: Unknown platform "${platform}". Must be "bluesky" or "github".`,
    is_error: true,
  };
}

export async function handleConcludeConversation(call: ToolCall): Promise<ToolResult> {
  const { platform, identifier, reason } = call.input as {
    platform: 'bluesky' | 'github';
    identifier: string;
    reason: string;
  };

  if (platform === 'bluesky') {
    const conversation = getBlueskyConversation(identifier);
    if (!conversation) {
      logger.info('Concluding untracked Bluesky conversation', { rootUri: identifier, reason });
    }
    markBlueskyConversationConcluded(identifier, reason);

    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        platform: 'bluesky',
        identifier,
        reason,
        message: 'Conversation marked as concluded. You will not respond to further messages in this thread unless explicitly @mentioned again.',
      }),
    };
  }

  if (platform === 'github') {
    const match = identifier.match(/^([^\/]+)\/([^#]+)#(\d+)$/);
    if (!match) {
      return {
        tool_use_id: call.id,
        content: 'Error: GitHub identifier must be in owner/repo#number format (e.g., "anthropics/claude-code#123")',
        is_error: true,
      };
    }

    const [, owner, repo, numberStr] = match;
    const number = parseInt(numberStr, 10);

    const conversation = getGitHubConversation(owner, repo, number);
    if (!conversation) {
      logger.info('Concluding untracked GitHub conversation', { owner, repo, number, reason });
    }
    markGitHubConversationConcluded(owner, repo, number, reason);

    if (isWatchingWorkspace(owner, repo)) {
      const closeResult = await github.updateIssue({
        owner,
        repo,
        issue_number: number,
        state: 'closed',
      });
      if (closeResult.success) {
        logger.info('Auto-closed workspace issue after conclude_conversation', { owner, repo, number });
      } else {
        logger.warn('Failed to auto-close workspace issue', { error: closeResult.error });
      }
    }

    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        platform: 'github',
        identifier,
        reason,
        message: 'Conversation marked as concluded. You will not respond to further messages in this issue unless explicitly @mentioned again.',
      }),
    };
  }

  return {
    tool_use_id: call.id,
    content: `Error: Unknown platform "${platform}". Must be "bluesky" or "github".`,
    is_error: true,
  };
}

export async function handleSelfImprove(call: ToolCall): Promise<ToolResult> {
  const { description, reasoning } = call.input as {
    description: string;
    reasoning: string;
  };

  const prompt = renderSkillSection('AGENT-SELF-IMPROVEMENT', 'General', {
    description,
    reasoningLine: `Why this matters: ${reasoning}`,
  });

  const repoRoot = getRepoRoot();
  const memoryPath = path.join(repoRoot, '.memory');
  const result = await runClaudeCode(prompt, repoRoot, memoryPath);

  if (result.success) {
    return {
      tool_use_id: call.id,
      content: JSON.stringify({
        success: true,
        output: result.output,
        message: 'Changes implemented. Restart to apply.',
      }),
    };
  }
  return {
    tool_use_id: call.id,
    content: JSON.stringify({
      success: false,
      error: result.error,
      message: 'Self-improvement failed. May need owner assistance.',
    }),
    is_error: true,
  };
}
