//NOTE(self): Announcement Module
//NOTE(self): Extracted from scheduler.ts for dual enforcement (scheduler + executor paths)
//NOTE(self): Decides whether a PR or issue completion is worth announcing on Bluesky,
//NOTE(self): then composes and posts the announcement (or replies to the originating thread)

import { logger } from '@modules/logger.js';
import { getConfig } from '@modules/config.js';
import { readSoul, readSelf } from '@modules/memory.js';
import { chatWithTools } from '@modules/llm-gateway.js';
import { executeTools } from '@modules/executor.js';
import { renderSkillSection } from '@modules/skills.js';
import { getPostThread } from '@adapters/atproto/get-post-thread.js';
import { recordSignificantEvent } from '@modules/engagement.js';
import type { ToolCall } from '@modules/tools.js';

/**
 * Decides whether a completed PR or issue is worth announcing on Bluesky,
 * then composes and posts the announcement. If a thread URI is provided,
 * replies there to close the feedback loop.
 *
 * This function is used by both scheduler.ts and executor.ts to ensure
 * identical post-completion behavior (dual enforcement per AGENTS.md).
 */
export async function announceIfWorthy(
  context: { url: string; title: string; repo: string },
  announcementType: 'pr' | 'issue',
  replyToThreadUri?: string
): Promise<void> {
  try {
    const config = getConfig();
    const soul = readSoul(config.paths.soul);
    const selfContent = readSelf(config.paths.selfmd);

    const contextStr = `**${announcementType === 'pr' ? 'Pull Request' : 'Issue'}:** ${context.title}\n**Repository:** ${context.repo}\n**URL:** ${context.url}`;

    //NOTE(self): Decision gate — SOUL decides yes/no with no tools
    const decisionPrompt = renderSkillSection('AGENT-GITHUB-ANNOUNCEMENT', 'Announcement Decision', {
      context: contextStr,
      announcementType,
    });

    const decisionSystem = `${soul}\n\n---\n\n${selfContent}`;
    const decisionResult = await chatWithTools({
      system: decisionSystem,
      messages: [{ role: 'user', content: decisionPrompt }],
    });

    const decision = (decisionResult.text || '').trim().toLowerCase();
    if (!decision.startsWith('yes')) {
      logger.info('Announcement declined by SOUL', { announcementType, title: context.title });
      return;
    }

    //NOTE(self): Compose the Bluesky post
    const composePrompt = renderSkillSection('AGENT-GITHUB-ANNOUNCEMENT', 'Bluesky Post', {
      context: contextStr,
    });

    const composeResult = await chatWithTools({
      system: decisionSystem,
      messages: [{ role: 'user', content: composePrompt }],
    });

    const postText = (composeResult.text || '').trim();
    if (!postText) {
      logger.warn('Empty announcement post composed');
      return;
    }

    //NOTE(self): Post to Bluesky via the tool executor
    //NOTE(self): If we have the originating thread URI, reply there to close the feedback loop
    let postToolCall: ToolCall;

    if (replyToThreadUri) {
      try {
        const threadResult = await getPostThread(replyToThreadUri, 0, 0);
        if (threadResult.success && threadResult.data) {
          const parentPost = threadResult.data.thread.post;
          postToolCall = {
            id: `announce-${Date.now()}`,
            name: 'bluesky_reply',
            input: {
              text: postText,
              post_uri: parentPost.uri,
              post_cid: parentPost.cid,
            },
          };
          logger.info('Replying to originating thread', { replyToThreadUri });
        } else {
          //NOTE(self): Thread lookup failed — fall back to top-level post
          logger.warn('Could not resolve thread for reply, falling back to top-level post', { replyToThreadUri });
          postToolCall = {
            id: `announce-${Date.now()}`,
            name: 'bluesky_post',
            input: { text: postText },
          };
        }
      } catch (threadError) {
        logger.warn('Thread lookup error, falling back to top-level post', { error: String(threadError) });
        postToolCall = {
          id: `announce-${Date.now()}`,
          name: 'bluesky_post',
          input: { text: postText },
        };
      }
    } else {
      postToolCall = {
        id: `announce-${Date.now()}`,
        name: 'bluesky_post',
        input: { text: postText },
      };
    }

    const results = await executeTools([postToolCall]);
    if (results[0] && !results[0].is_error) {
      logger.info('Announced on Bluesky', { announcementType, title: context.title, isReply: !!replyToThreadUri });
      recordSignificantEvent('expression');
    } else {
      logger.warn('Failed to post announcement', { error: results[0]?.content });
    }
  } catch (error) {
    logger.error('Announcement error', { error: String(error) });
    //NOTE(self): Non-fatal — don't let announcement failures break task flow
  }
}
