import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { logger } from '@modules/logger.js';

//NOTE(self): Read version from package.json for User-Agent
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const VERSION = pkg.version || '0.0.0';
import { getConfig } from '@modules/config.js';
import {
  safeReadFile,
  safeWriteFile,
  safeAppendFile,
  safeListDir,
  getRepoRoot,
} from '@modules/sandbox.js';
import type { ToolCall, ToolResult } from '@modules/tools.js';

import * as atproto from '@adapters/atproto/index.js';
import * as github from '@adapters/github/index.js';
import * as arena from '@adapters/arena/index.js';
import { graphemeLen } from '@atproto/common-web';
import { isEmpty, truncateGraphemes, PORTABLE_MAX_GRAPHEMES } from '@modules/strings.js';

//NOTE(self): Bluesky enforces 300 graphemes max per post
const BLUESKY_MAX_GRAPHEMES = PORTABLE_MAX_GRAPHEMES;
import { markInteractionResponded, recordOriginalPost } from '@modules/engagement.js';
import {
  markConversationConcluded as markBlueskyConversationConcluded,
  getConversation as getBlueskyConversation,
} from '@modules/bluesky-engagement.js';
import {
  markConversationConcluded as markGitHubConversationConcluded,
  getConversation as getGitHubConversation,
} from '@modules/github-engagement.js';
import { hasAgentRepliedInThread } from '@adapters/atproto/get-post-thread.js';
import { runClaudeCode } from '@local-tools/self-improve-run.js';
import { renderSkillSection } from '@modules/skills.js';
import { processBase64ImageForUpload, processFileImageForUpload } from '@modules/image-processor.js';
import { updateIssue } from '@adapters/github/update-issue.js';
import { createPlan, type PlanDefinition } from '@local-tools/self-plan-create.js';
import { claimTaskFromPlan, markTaskInProgress } from '@local-tools/self-task-claim.js';
import { executeTask, ensureWorkspace, pushChanges, createBranch, createPullRequest, requestReviewersForPR, getTaskBranchName } from '@local-tools/self-task-execute.js';
import { reportTaskComplete, reportTaskFailed, reportTaskBlocked } from '@local-tools/self-task-report.js';
import { verifyGitChanges, runTestsIfPresent, verifyPushSuccess, verifyBranch } from '@local-tools/self-task-verify.js';
import { parsePlan } from '@local-tools/self-plan-parse.js';
import { listIssues } from '@adapters/github/list-issues.js';
import { ui } from '@modules/ui.js';

//NOTE(self): Callback hook for post-merge actions (avoids circular import with scheduler)
//NOTE(self): Registered by scheduler at startup to trigger early plan check after PR merge
let onPRMergedCallback: (() => void) | null = null;
export function registerOnPRMerged(callback: () => void): void {
  onPRMergedCallback = callback;
}
import { createWorkspace, findExistingWorkspace, getWorkspaceUrl } from '@local-tools/self-github-create-workspace.js';
import { createMemo, createGitHubIssue } from '@local-tools/self-github-create-issue.js';
import { watchWorkspace, getWatchedWorkspaceForRepo } from '@modules/workspace-discovery.js';
import { announceIfWorthy } from '@modules/announcement.js';
import { recordExperience } from '@local-tools/self-capture-experiences.js';
import {
  logPost,
  lookupPostByUri,
  lookupPostByBskyUrl,
  generatePostContext,
  formatSourceAttribution,
  hasCompleteAttribution,
  getPostsNeedingAttributionFollowup,
  markPostNeedsAttributionFollowup,
  updatePostAttribution,
  type PostLogEntry,
} from '@modules/post-log.js';

//NOTE(self): Thread context for workspace creation — set by scheduler before tool execution
//NOTE(self): so that workspace_create can pass the thread URI to watchWorkspace()
let _responseThreadUri: string | null = null;

export function setResponseThreadContext(uri: string | null): void {
  _responseThreadUri = uri;
}

export function getResponseThreadContext(): string | null {
  return _responseThreadUri;
}

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const config = getConfig();
  const repoRoot = getRepoRoot();

  logger.info('Executing tool', { name: call.name, input: call.input });

  try {
    switch (call.name) {
      //NOTE(self): Bluesky tools
      case 'bluesky_post': {
        const text = call.input.text as string;
        const textGraphemes = graphemeLen(text);
        if (textGraphemes > BLUESKY_MAX_GRAPHEMES) {
          return {
            tool_use_id: call.id,
            content: `Error: Post is ${textGraphemes} graphemes, but Bluesky limit is ${BLUESKY_MAX_GRAPHEMES}. Shorten your post and try again.`,
            is_error: true,
          };
        }
        const result = await atproto.createPost({ text });
        if (result.success) {
          //NOTE(self): Only show in chat after successful post - reduces perceived duplicates
          ui.social(`${config.agent.name}`, text);
          recordOriginalPost();
          return { tool_use_id: call.id, content: JSON.stringify({ success: true, uri: result.data.uri }) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'bluesky_post_with_image': {
        const { text, image_path, image_base64, image_mime_type, alt_text } = call.input as {
          text: string;
          image_path?: string;       //NOTE(self): Preferred - file path from curl_fetch
          image_base64?: string;     //NOTE(self): Fallback - base64 data
          image_mime_type?: string;
          alt_text: string;
        };

        //NOTE(self): Validate text length before doing any image processing
        const imagePostGraphemes = graphemeLen(text);
        if (imagePostGraphemes > BLUESKY_MAX_GRAPHEMES) {
          return {
            tool_use_id: call.id,
            content: `Error: Post text is ${imagePostGraphemes} graphemes, but Bluesky limit is ${BLUESKY_MAX_GRAPHEMES}. Shorten your text and try again.`,
            is_error: true,
          };
        }

        //NOTE(self): Validate we have image data via either method
        if (!image_path && (!image_base64 || image_base64.length === 0)) {
          return {
            tool_use_id: call.id,
            content: 'Error: Must provide either image_path (from curl_fetch) or image_base64',
            is_error: true,
          };
        }

        //NOTE(self): Process image - prefer file path (no context bloat), fallback to base64
        let processedImage;
        let imageFilePath: string | null = null;

        try {
          if (image_path) {
            //NOTE(self): File-based processing - preferred method
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
            //NOTE(self): Base64 fallback - for backward compatibility
            //NOTE(self): Validate that mime type looks like an image
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

        //NOTE(self): Upload the processed image blob
        const uploadResult = await atproto.uploadBlob(processedImage.buffer, processedImage.mimeType);
        if (!uploadResult.success) {
          //NOTE(self): Clean up temp image file on upload failure
          if (imageFilePath) {
            try { fs.unlinkSync(imageFilePath); } catch { /* best effort */ }
          }
          return { tool_use_id: call.id, content: `Error uploading image: ${uploadResult.error}`, is_error: true };
        }

        logger.info('Image blob uploaded', { blob: uploadResult.data.blob });

        //NOTE(self): Create post with the uploaded image and aspect ratio
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

        //NOTE(self): Clean up temp image file regardless of post outcome
        if (imageFilePath) {
          try {
            fs.unlinkSync(imageFilePath);
            logger.debug('Cleaned up image file', { filePath: imageFilePath });
          } catch (err) {
            logger.warn('Failed to clean up image file', { filePath: imageFilePath, error: String(err) });
          }
        }

        if (postResult.success) {
          //NOTE(self): Only show in chat after successful post - reduces perceived duplicates
          ui.social(`${config.agent.name} (with image)`, text);

          //NOTE(self): Log post for future context
          //NOTE(self): Convert AT URI to bsky.app URL
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

      case 'bluesky_reply': {
        const { text, post_uri, post_cid, root_uri, root_cid } = call.input as Record<string, string>;

        //NOTE(self): Validate required parameters
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

        //NOTE(self): Check thread API to see if we've already replied - single source of truth
        //NOTE(self): This is async but fails OPEN if API errors - better to attempt than block
        const alreadyReplied = await hasAgentRepliedInThread(post_uri);
        if (alreadyReplied) {
          logger.warn('Blocked duplicate reply attempt (API check)', { post_uri });
          return { tool_use_id: call.id, content: 'BLOCKED: You have already replied to this post. Replying multiple times to the same post is spam. Move on to the next notification.', is_error: true };
        }

        //NOTE(self): Build reply refs - auto-resolves root if not provided
        const replyRefsResult = await atproto.getReplyRefs(post_uri, post_cid, root_uri, root_cid);
        if (!replyRefsResult.success) {
          return { tool_use_id: call.id, content: `Error resolving reply refs: ${replyRefsResult.error}`, is_error: true };
        }

        const replyRefs = replyRefsResult.data;
        const threadRootUri = replyRefs.root.uri;

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
          //NOTE(self): Only show in chat after successful reply - reduces perceived duplicates
          ui.social(`${config.agent.name} (reply)`, text);
          //NOTE(self): Mark the interaction as responded in engagement tracking (for relationship insights)
          markInteractionResponded(post_uri, result.data.uri);
          //NOTE(self): No local tracking needed - the API IS the truth for reply deduplication
          logger.info('Reply sent', { post_uri, reply_uri: result.data.uri });
          return { tool_use_id: call.id, content: JSON.stringify({ success: true, uri: result.data.uri }) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'bluesky_like': {
        const { post_uri, post_cid } = call.input as Record<string, string>;
        const result = await atproto.likePost({ uri: post_uri, cid: post_cid });
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'bluesky_repost': {
        const { post_uri, post_cid } = call.input as Record<string, string>;
        const result = await atproto.repost({ uri: post_uri, cid: post_cid });
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'bluesky_follow': {
        const did = call.input.did as string;
        const result = await atproto.followUser({ did });
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'bluesky_unfollow': {
        const followUri = call.input.follow_uri as string;
        const result = await atproto.unfollowUser(followUri);
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'bluesky_get_timeline': {
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

      case 'bluesky_get_notifications': {
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

      case 'bluesky_get_profile': {
        const actor = call.input.actor as string;
        const result = await atproto.getProfile(actor);
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify(result.data) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'bluesky_get_followers': {
        const { actor, limit = 50 } = call.input as { actor: string; limit?: number };
        const result = await atproto.getFollowers({ actor, limit });
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify(result.data.followers) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'bluesky_get_follows': {
        const { actor, limit = 50 } = call.input as { actor: string; limit?: number };
        const result = await atproto.getFollows({ actor, limit });
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify(result.data.follows) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      //NOTE(self): GitHub tools
      case 'github_get_repo': {
        const { owner, repo } = call.input as { owner: string; repo: string };
        const result = await github.getRepository(owner, repo);
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify(result.data) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_list_issues': {
        const { owner, repo, state = 'open', limit = 30 } = call.input as {
          owner: string;
          repo: string;
          state?: 'open' | 'closed' | 'all';
          limit?: number;
        };
        const result = await github.listIssues({ owner, repo, state, per_page: limit });
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify(result.data) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_create_issue_comment': {
        const { owner, repo, issue_number, body } = call.input as {
          owner: string;
          repo: string;
          issue_number: number;
          body: string;
        };
        const result = await github.createIssueComment({ owner, repo, issue_number, body });
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify({ success: true, id: result.data.id }) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_star_repo': {
        const { owner, repo } = call.input as { owner: string; repo: string };
        const result = await github.starRepository(owner, repo);
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_follow_user': {
        const username = call.input.username as string;
        const result = await github.followUser(username);
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_get_user': {
        const username = call.input.username as string;
        const result = await github.getUser(username);
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify(result.data) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_list_pull_requests': {
        const { owner, repo, state = 'open', limit = 30 } = call.input as {
          owner: string;
          repo: string;
          state?: 'open' | 'closed' | 'all';
          limit?: number;
        };
        const result = await github.listPullRequests({ owner, repo, state, per_page: limit });
        if (result.success) {
          //NOTE(self): Simplify PR data - preserve full body, add useful metadata
          const simplified = result.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            draft: pr.draft,
            user: pr.user?.login,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            html_url: pr.html_url,
            body: pr.body, //NOTE(self): Don't truncate - need full context for meaningful engagement
            comments: pr.comments,
            review_comments: pr.review_comments,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files,
          }));
          return { tool_use_id: call.id, content: JSON.stringify(simplified) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_create_pr_comment': {
        const { owner, repo, pull_number, body } = call.input as {
          owner: string;
          repo: string;
          pull_number: number;
          body: string;
        };
        const result = await github.createPullRequestComment({ owner, repo, pull_number, body });
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify({ success: true, id: result.data.id }) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_review_pr': {
        const { owner, repo, pull_number, event, body } = call.input as {
          owner: string;
          repo: string;
          pull_number: number;
          event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
          body?: string;
        };
        const result = await github.createPullRequestReview({ owner, repo, pull_number, event, body });
        if (result.success) {
          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: true,
              id: result.data.id,
              state: result.data.state,
              html_url: result.data.html_url,
            }),
          };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_create_pr': {
        const { owner, repo, title, body, head, base = 'main', draft = false } = call.input as {
          owner: string;
          repo: string;
          title: string;
          body?: string;
          head: string;
          base?: string;
          draft?: boolean;
        };

        const result = await github.createPullRequest({ owner, repo, title, body, head, base, draft });
        if (result.success) {
          //NOTE(self): Request reviewers from peers (non-fatal)
          //NOTE(self): Matches the task execution paths in scheduler.ts and plan_execute_task
          if (result.data.number) {
            requestReviewersForPR(owner, repo, result.data.number).catch(() => {});
          }

          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: true,
              number: result.data.number,
              html_url: result.data.html_url,
              state: result.data.state,
              draft: result.data.draft,
            }),
          };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_merge_pr': {
        const { owner, repo, pull_number, commit_title, commit_message, merge_method } = call.input as {
          owner: string;
          repo: string;
          pull_number: number;
          commit_title?: string;
          commit_message?: string;
          merge_method?: 'merge' | 'squash' | 'rebase';
        };

        //NOTE(self): Hard guard - only allow merging on workspace repos
        if (!repo.startsWith('www-lil-intdev-')) {
          return {
            tool_use_id: call.id,
            content: 'Error: Can only merge PRs on workspace repos (prefix "www-lil-intdev-"). This prevents accidentally merging on repos you don\'t own.',
            is_error: true,
          };
        }

        const result = await github.mergePullRequest({ owner, repo, pull_number, commit_title, commit_message, merge_method });
        if (result.success) {
          //NOTE(self): Delete the feature branch after successful merge (cleanup)
          try {
            //NOTE(self): Fetch the PR to get its head ref for branch deletion
            const prResponse = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}`,
              { headers: github.getAuthHeaders() }
            );
            if (prResponse.ok) {
              const prData = await prResponse.json();
              const headRef = prData.head?.ref;
              if (headRef && headRef !== 'main' && headRef !== 'master') {
                const deleteResult = await github.deleteBranch(owner, repo, headRef);
                if (deleteResult.success) {
                  logger.info('Deleted feature branch after merge', { branch: headRef, pull_number });
                } else {
                  logger.debug('Branch deletion failed (non-fatal)', { branch: headRef, error: deleteResult.error });
                }
              }
            }
          } catch (branchDeleteError) {
            logger.debug('Branch cleanup error (non-fatal)', { error: String(branchDeleteError) });
          }

          //NOTE(self): Signal post-merge — scheduler can pick up newly unblocked tasks
          if (onPRMergedCallback) {
            try { onPRMergedCallback(); } catch { /* non-fatal */ }
          }

          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: true,
              merged: result.data.merged,
              sha: result.data.sha,
              message: result.data.message,
            }),
          };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_list_org_repos': {
        const { org, type = 'all', sort = 'pushed', limit = 30 } = call.input as {
          org: string;
          type?: 'all' | 'public' | 'private' | 'forks' | 'sources' | 'member';
          sort?: 'created' | 'updated' | 'pushed' | 'full_name';
          limit?: number;
        };
        const result = await github.listOrgRepos({ org, type, sort, per_page: limit });
        if (result.success) {
          //NOTE(self): Simplify repo data
          const simplified = result.data.map((repo) => ({
            name: repo.name,
            full_name: repo.full_name,
            description: repo.description,
            html_url: repo.html_url,
            language: repo.language,
            stargazers_count: repo.stargazers_count,
            open_issues_count: repo.open_issues_count,
            updated_at: repo.updated_at,
            pushed_at: repo.pushed_at,
          }));
          return { tool_use_id: call.id, content: JSON.stringify(simplified) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_list_my_orgs': {
        const { limit = 30 } = call.input as { limit?: number };
        const result = await github.listUserOrgs({ per_page: limit });
        if (result.success) {
          return { tool_use_id: call.id, content: JSON.stringify(result.data) };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'github_clone_repo': {
        const { owner, repo, branch, depth } = call.input as {
          owner: string;
          repo: string;
          branch?: string;
          depth?: number;
        };

        //NOTE(self): Clone to .workrepos/ directory
        const workreposDir = path.join(repoRoot, '.workrepos');
        if (!fs.existsSync(workreposDir)) {
          fs.mkdirSync(workreposDir, { recursive: true });
        }

        const targetDir = path.join(workreposDir, `${owner}-${repo}`);

        //NOTE(self): Check if already cloned
        if (fs.existsSync(targetDir)) {
          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: true,
              path: targetDir,
              message: 'Repository already cloned',
              alreadyExists: true,
            }),
          };
        }

        const result = await github.cloneRepository({
          owner,
          repo,
          targetDir,
          branch,
          depth,
        });

        if (result.success) {
          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: true,
              path: result.data.path,
              branch: result.data.branch,
            }),
          };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      //NOTE(self): Workspace + coordination tools
      case 'workspace_create': {
        const { name, description, org } = call.input as {
          name: string;
          description?: string;
          org?: string;
        };

        const result = await createWorkspace({ name, description, org });

        if (result.success && result.workspace) {
          //NOTE(self): Auto-watch the workspace so the plan awareness loop picks it up immediately
          //NOTE(self): Pass thread URI so announcements reply in-thread instead of top-level
          const [wsOwner, wsRepo] = result.workspace.fullName.split('/');
          watchWorkspace(wsOwner, wsRepo, result.workspace.url, _responseThreadUri || undefined);
          logger.info('Workspace created and auto-watched', { fullName: result.workspace.fullName, url: result.workspace.url, threadUri: _responseThreadUri });

          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: true,
              workspace: result.workspace,
            }),
          };
        }

        if (!result.success && result.existingWorkspace) {
          //NOTE(self): Not an error - existing workspace is useful info
          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: false,
              existingWorkspace: result.existingWorkspace,
              message: 'A workspace already exists for this org',
            }),
          };
        }

        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'workspace_find': {
        const { org } = call.input as { org?: string };

        const workspaceName = await findExistingWorkspace(org);

        if (workspaceName) {
          const workspaceUrl = await getWorkspaceUrl(org);
          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              found: true,
              name: workspaceName,
              url: workspaceUrl,
            }),
          };
        }

        return {
          tool_use_id: call.id,
          content: JSON.stringify({ found: false }),
        };
      }

      case 'github_create_issue': {
        const { owner, repo, title, body, labels } = call.input as {
          owner: string;
          repo: string;
          title: string;
          body?: string;
          labels?: string[];
        };

        const result = await createGitHubIssue({ owner, repo, title, body, labels });

        if (result.success && result.memo) {
          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: true,
              issue: result.memo,
            }),
          };
        }

        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'create_memo': {
        const { owner, repo, title, body, labels } = call.input as {
          owner: string;
          repo: string;
          title: string;
          body?: string;
          labels?: string[];
        };

        const result = await createMemo({ owner, repo, title, body, labels });

        if (result.success && result.memo) {
          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: true,
              memo: result.memo,
            }),
          };
        }

        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      //NOTE(self): Web tools
      case 'web_fetch': {
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
            //NOTE(self): Return raw HTML, truncated if too long
            return { tool_use_id: call.id, content: html.slice(0, 50000) };
          }

          //NOTE(self): Extract readable text from HTML
          //NOTE(self): Simple extraction: remove scripts, styles, tags, collapse whitespace
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

      case 'curl_fetch': {
        const { url, max_size_mb = 5 } = call.input as {
          url: string;
          max_size_mb?: number;
        };

        //NOTE(self): Limit max size to 10MB for safety
        const maxBytes = Math.min(max_size_mb, 10) * 1024 * 1024;

        //NOTE(self): Store in .memory/images/ with descriptive naming
        //NOTE(self): Format: YYYYMMDD-HHMMSS-randomid.ext
        const imagesDir = path.join(repoRoot, '.memory', 'images');
        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
        const randomId = Math.random().toString(36).slice(2, 8);
        const tempFile = path.join(imagesDir, `${dateStr}-${randomId}`);

        //NOTE(self): Ensure images directory exists
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
          //NOTE(self): Use curl with -o to write directly to file - no memory bloat
          const curl = spawn('curl', [
            '-sS',
            '-L',
            '-f', //NOTE(self): CRITICAL - fail on HTTP errors (4xx, 5xx)
            '--max-filesize', maxBytes.toString(),
            '--max-time', '30',
            '-o', tempFile,
            '-w', '%{http_code}:%{content_type}', //NOTE(self): Get status and content-type
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
              //NOTE(self): Clean up temp file on error
              try { fs.unlinkSync(tempFile); } catch (e) { logger.debug('Failed to clean up temp file', { file: tempFile, error: String(e) }); }

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

            //NOTE(self): Parse the -w output (http_code:content_type)
            const [httpCode, contentType] = writeOutput.split(':');
            let mimeType = contentType?.trim() || 'application/octet-stream';
            //NOTE(self): Clean up content-type (remove charset, etc.)
            mimeType = mimeType.split(';')[0].trim();

            //NOTE(self): Read file stats
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
              try { fs.unlinkSync(tempFile); } catch (e) { logger.debug('Failed to clean up temp file', { file: tempFile, error: String(e) }); }
              resolve({
                tool_use_id: call.id,
                content: 'Error: URL returned empty response',
                is_error: true,
              });
              return;
            }

            //NOTE(self): Detect mime type from magic bytes if server didn't provide one
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

                //NOTE(self): Check if this is HTML (error page)
                const firstChars = magicBytes.toString('utf8').toLowerCase();
                if (firstChars.includes('<!do') || firstChars.includes('<htm') || firstChars.includes('<?xm')) {
                  try { fs.unlinkSync(tempFile); } catch (e) { logger.debug('Failed to clean up temp file', { file: tempFile, error: String(e) }); }
                  resolve({
                    tool_use_id: call.id,
                    content: 'Error: URL returned HTML/XML instead of binary data (likely an error page)',
                    is_error: true,
                  });
                  return;
                }
              } catch (e) {
                //NOTE(self): Failed to read magic bytes, use server-provided mime type
                logger.debug('Failed to read magic bytes', { file: tempFile, error: String(e) });
              }
            }

            //NOTE(self): Add proper extension based on mime type
            const extMap: Record<string, string> = {
              'image/jpeg': '.jpg',
              'image/png': '.png',
              'image/gif': '.gif',
              'image/webp': '.webp',
              'application/octet-stream': '.bin',
            };
            const ext = extMap[mimeType] || '.bin';
            const finalPath = tempFile + ext;

            //NOTE(self): Rename to add extension
            try {
              fs.renameSync(tempFile, finalPath);
            } catch (err) {
              logger.warn('Failed to rename temp file', { from: tempFile, to: finalPath, error: String(err) });
              //NOTE(self): Continue with original path if rename fails
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
            try { fs.unlinkSync(tempFile); } catch (e) { logger.debug('Failed to clean up temp file', { file: tempFile, error: String(e) }); }
            resolve({
              tool_use_id: call.id,
              content: `Error: ${err.message}`,
              is_error: true,
            });
          });
        });
      }

      //NOTE(self): Self tools - SELF.md is the agent's memory
      case 'self_update': {
        const content = call.input.content as string;
        const fullPath = path.join(repoRoot, 'SELF.md');

        if (safeWriteFile(fullPath, content)) {
          return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
        }
        return { tool_use_id: call.id, content: 'Error: Failed to update SELF.md', is_error: true };
      }

      case 'self_read': {
        const fullPath = path.join(repoRoot, 'SELF.md');
        const content = safeReadFile(fullPath);

        if (content !== null) {
          return { tool_use_id: call.id, content };
        }
        return { tool_use_id: call.id, content: 'Error: Failed to read SELF.md', is_error: true };
      }

      //NOTE(self): Are.na tools
      case 'arena_search': {
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
              //NOTE(self): Provide ready-to-use URL for arena_post_image
              channel_url: `https://www.are.na/${ch.user?.slug || ch.user?.username}/${ch.slug}`,
            })),
            totalResults: searchResult.data.totalResults,
          }),
          is_error: false,
        };
      }

      case 'arena_fetch_channel': {
        const { channel_url } = call.input as { channel_url: string };

        //NOTE(self): Parse URL or owner/slug format
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

        //NOTE(self): Return simplified block data for agent consumption
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

      case 'arena_post_image': {
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

        //NOTE(self): Parse channel URL
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

        //NOTE(self): Load posted IDs from memory for dedupe
        const postedPath = path.join(repoRoot, '.memory', 'arena_posted.json');
        let postedIds: number[] = [];
        try {
          if (fs.existsSync(postedPath)) {
            const content = fs.readFileSync(postedPath, 'utf8');
            postedIds = JSON.parse(content);
          }
        } catch (e) {
          logger.debug('Failed to load arena posted IDs', { path: postedPath, error: String(e) });
          postedIds = [];
        }

        //NOTE(self): Fetch channel
        const channelResult = await arena.fetchChannel({ owner, slug });
        if (!channelResult.success) {
          return { tool_use_id: call.id, content: `Error fetching channel: ${channelResult.error}`, is_error: true };
        }

        const { imageBlocks, channel } = channelResult.data;

        //NOTE(self): Filter out already posted blocks
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

        //NOTE(self): Select a random unposted block
        const selectedBlock = unpostedBlocks[Math.floor(Math.random() * unpostedBlocks.length)];
        const imageUrl = selectedBlock.image?.original?.url;

        if (!imageUrl) {
          return {
            tool_use_id: call.id,
            content: 'Error: Selected block has no image URL',
            is_error: true,
          };
        }

        //NOTE(self): Download image via curl_fetch logic
        const imagesDir = path.join(repoRoot, '.memory', 'images');
        const now = new Date();
        const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const randomId = Math.random().toString(36).slice(2, 8);
        const tempFile = path.join(imagesDir, `arena-${dateStr}-${randomId}`);

        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }

        //NOTE(self): Use curl to download
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
              try { fs.unlinkSync(tempFile); } catch (e) { logger.debug('Failed to clean up temp file', { file: tempFile, error: String(e) }); }
              resolve({ success: false, error: `curl failed: ${stderr || `exit code ${code}`}` });
              return;
            }

            const [, contentType] = writeOutput.split(':');
            let mimeType = contentType?.trim()?.split(';')[0] || 'image/jpeg';

            //NOTE(self): Detect mime from magic bytes if needed
            try {
              const fd = fs.openSync(tempFile, 'r');
              const magicBytes = Buffer.alloc(12);
              fs.readSync(fd, magicBytes, 0, 12, 0);
              fs.closeSync(fd);

              if (magicBytes[0] === 0xFF && magicBytes[1] === 0xD8) mimeType = 'image/jpeg';
              else if (magicBytes[0] === 0x89 && magicBytes[1] === 0x50) mimeType = 'image/png';
              else if (magicBytes[0] === 0x47 && magicBytes[1] === 0x49) mimeType = 'image/gif';
              else if (magicBytes[0] === 0x52 && magicBytes[1] === 0x49 && magicBytes[8] === 0x57) mimeType = 'image/webp';
            } catch (e) { logger.debug('Failed to detect mime from magic bytes', { file: tempFile, error: String(e) }); }

            const extMap: Record<string, string> = {
              'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
            };
            const ext = extMap[mimeType] || '.jpg';
            const finalPath = tempFile + ext;

            try {
              fs.renameSync(tempFile, finalPath);
              resolve({ success: true, filePath: finalPath, mimeType });
            } catch (e) {
              logger.debug('Failed to rename temp file, using original', { tempFile, finalPath, error: String(e) });
              resolve({ success: true, filePath: tempFile, mimeType });
            }
          });

          curl.on('error', (err) => {
            try { fs.unlinkSync(tempFile); } catch (e) { logger.debug('Failed to clean up temp file', { file: tempFile, error: String(e) }); }
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

        //NOTE(self): Process image for Bluesky
        let processedImage;
        try {
          processedImage = await processFileImageForUpload(curlResult.filePath);
        } catch (err) {
          try { fs.unlinkSync(curlResult.filePath); } catch (e) { logger.debug('Failed to clean up temp file', { file: curlResult.filePath, error: String(e) }); }
          return {
            tool_use_id: call.id,
            content: `Error processing image: ${String(err)}`,
            is_error: true,
          };
        }

        //NOTE(self): Upload blob
        const uploadResult = await atproto.uploadBlob(processedImage.buffer, processedImage.mimeType);
        if (!uploadResult.success) {
          try { fs.unlinkSync(curlResult.filePath); } catch (e) { logger.debug('Failed to clean up temp file', { file: curlResult.filePath, error: String(e) }); }
          return {
            tool_use_id: call.id,
            content: `Error uploading to Bluesky: ${uploadResult.error}`,
            is_error: true,
          };
        }

        //NOTE(self): Build post text (<=300 chars)
        const blockTitle = selectedBlock.title || selectedBlock.generated_title || 'Untitled';
        const sourceUrl = selectedBlock.source?.url || `https://www.are.na/block/${selectedBlock.id}`;

        //NOTE(self): Use custom text if provided (Scenario 6: SOUL explains why they like the image)
        //NOTE(self): Otherwise fall back to auto-generated title + source
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

        //NOTE(self): Build alt text from title + description
        let altText = blockTitle;
        if (selectedBlock.description) {
          altText += ` - ${selectedBlock.description.slice(0, 500)}`;
        }

        //NOTE(self): Create post
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

        //NOTE(self): Add reply context if provided, auto-resolving root if needed
        if (reply_to) {
          const replyRefsResult = await atproto.getReplyRefs(
            reply_to.post_uri,
            reply_to.post_cid,
            reply_to.root_uri,
            reply_to.root_cid
          );
          if (!replyRefsResult.success) {
            try { fs.unlinkSync(curlResult.filePath); } catch (e) { logger.debug('Failed to clean up temp file', { file: curlResult.filePath, error: String(e) }); }
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

        //NOTE(self): Clean up image file
        try { fs.unlinkSync(curlResult.filePath); } catch (e) { logger.debug('Failed to clean up temp file', { file: curlResult.filePath, error: String(e) }); }

        if (!postResult.success) {
          return {
            tool_use_id: call.id,
            content: `Error creating post: ${postResult.error}`,
            is_error: true,
          };
        }

        //NOTE(self): Only show in chat after successful post - reduces perceived duplicates
        ui.social(`${config.agent.name} (arena image)`, postText);

        //NOTE(self): Record posted block ID for dedupe
        postedIds.push(selectedBlock.id);
        try {
          fs.writeFileSync(postedPath, JSON.stringify(postedIds, null, 2));
        } catch (err) {
          logger.warn('Failed to save arena_posted.json', { error: String(err) });
        }

        //NOTE(self): Convert AT URI to bsky.app URL
        //NOTE(self): Format: at://did:plc:xxx/app.bsky.feed.post/rkey -> https://bsky.app/profile/did:plc:xxx/post/rkey
        const postUri = postResult.data.uri;
        const uriMatch = postUri.match(/at:\/\/([^\/]+)\/app\.bsky\.feed\.post\/([^\/]+)/);
        let bskyUrl = postUri;
        if (uriMatch) {
          bskyUrl = `https://bsky.app/profile/${uriMatch[1]}/post/${uriMatch[2]}`;
        }

        //NOTE(self): Mark interaction as responded if this was a reply
        if (reply_to) {
          markInteractionResponded(reply_to.post_uri, postResult.data.uri);
        }

        //NOTE(self): Log post for future context (so I can answer "why did you pick this?")
        //NOTE(self): Credit + traceability - capture exact block URL, filename, and flag missing attribution
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
            //NOTE(self): Direct link to exact Are.na block for clean traceability
            block_url: `https://www.are.na/block/${selectedBlock.id}`,
            block_title: blockTitle,
            //NOTE(self): Original filename often contains creator hints (e.g., "dribbble-shot-by-artist.png")
            filename: selectedBlock.filename,
            original_url: selectedBlock.source?.url,
            //NOTE(self): Provider helps trace origins (e.g., "Dribbble", "Behance", "Twitter")
            source_provider: selectedBlock.source?.provider?.name,
            image_url: imageUrl,
            //NOTE(self): Capture who added this to Are.na for potential follow-up
            arena_user: selectedBlock.user ? {
              username: selectedBlock.user.username,
              full_name: selectedBlock.user.full_name,
            } : undefined,
            //NOTE(self): Flag posts without original source so I can circle back to find creators
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

      case 'lookup_post_context': {
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

        //NOTE(self): Try both lookup methods
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

        //NOTE(self): Return both raw data and human-readable summary
        return {
          tool_use_id: call.id,
          content: JSON.stringify({
            success: true,
            context: generatePostContext(entry),
            raw: entry,
          }),
        };
      }

      //NOTE(self): Credit + traceability tools - for finding and crediting original creators
      case 'get_posts_needing_attribution': {
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

        //NOTE(self): Return summary with actionable info for each post
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

      case 'mark_attribution_followup': {
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

      case 'update_post_attribution': {
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

      //NOTE(self): Credit + traceability - format clean source attribution for sharing
      case 'format_source_attribution': {
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

        //NOTE(self): Try both lookup methods
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

        //NOTE(self): Return formatted attribution and metadata
        const attribution = formatSourceAttribution(entry);
        const complete = hasCompleteAttribution(entry);

        return {
          tool_use_id: call.id,
          content: JSON.stringify({
            success: true,
            attribution,
            has_complete_attribution: complete,
            //NOTE(self): Include raw source data for additional context if needed
            block_url: entry.source.block_url,
            original_url: entry.source.original_url,
            filename: entry.source.filename,
            source_provider: entry.source.source_provider,
            arena_user: entry.source.arena_user,
            //NOTE(self): Helpful hint if attribution is incomplete
            note: complete ? null : 'Original creator not yet found. Consider using get_posts_needing_attribution to work on attribution backlog.',
          }),
        };
      }

      //NOTE(self): Conversation management tools
      case 'graceful_exit': {
        const { platform, identifier, closing_type, closing_message, target_uri, target_cid, reason } = call.input as {
          platform: 'bluesky' | 'github';
          identifier: string;
          closing_type: 'message' | 'like';
          closing_message?: string;
          target_uri?: string;
          target_cid?: string;
          reason: string;
        };

        //NOTE(self): Validate inputs
        if (closing_type === 'message' && !closing_message) {
          return {
            tool_use_id: call.id,
            content: 'Error: closing_message is required when closing_type is "message"',
            is_error: true,
          };
        }

        if (platform === 'bluesky') {
          //NOTE(self): For Bluesky, we need target_uri and target_cid for the closing gesture
          if (!target_uri || !target_cid) {
            return {
              tool_use_id: call.id,
              content: 'Error: target_uri and target_cid are required for Bluesky graceful_exit (the post to reply to or like)',
              is_error: true,
            };
          }

          let closingResult: { success: boolean; error?: string; data?: { uri: string } };

          if (closing_type === 'message') {
            //NOTE(self): Send a closing reply - need to resolve reply refs first
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
            //NOTE(self): Like the post as a non-verbal acknowledgment
            closingResult = await atproto.likePost({ uri: target_uri, cid: target_cid });
          }

          if (!closingResult.success) {
            return {
              tool_use_id: call.id,
              content: `Error sending closing gesture: ${closingResult.error}`,
              is_error: true,
            };
          }

          //NOTE(self): Mark conversation concluded
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
          //NOTE(self): Parse identifier
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
            //NOTE(self): Send closing comment
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
            //NOTE(self): React with a heart to the issue as a non-verbal closing gesture
            const reactionResult = await github.createIssueReaction(owner, repo, number, 'heart');
            if (!reactionResult.success) {
              logger.debug('Failed to add closing reaction', { error: reactionResult.error });
            }
          }

          //NOTE(self): Mark conversation concluded
          markGitHubConversationConcluded(owner, repo, number, reason);

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

      case 'conclude_conversation': {
        const { platform, identifier, reason } = call.input as {
          platform: 'bluesky' | 'github';
          identifier: string;
          reason: string;
        };

        if (platform === 'bluesky') {
          //NOTE(self): identifier should be the thread root URI
          const conversation = getBlueskyConversation(identifier);
          if (!conversation) {
            //NOTE(self): Still mark it concluded even if we weren't tracking it
            //NOTE(self): The tracking will be created by markConversationConcluded
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
          //NOTE(self): identifier should be owner/repo#number format
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

      //NOTE(self): Multi-SOUL Collaboration tools
      case 'github_update_issue': {
        const { owner, repo, issue_number, title, body, state, labels, assignees } = call.input as {
          owner: string;
          repo: string;
          issue_number: number;
          title?: string;
          body?: string;
          state?: 'open' | 'closed';
          labels?: string[];
          assignees?: string[];
        };

        const result = await updateIssue({
          owner,
          repo,
          issue_number,
          title,
          body,
          state,
          labels,
          assignees,
        });

        if (result.success) {
          return {
            tool_use_id: call.id,
            content: JSON.stringify({ success: true, issue_number: result.data.number }),
          };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'plan_create': {
        const { owner, repo, title, goal, context, tasks, verification } = call.input as {
          owner: string;
          repo: string;
          title: string;
          goal: string;
          context: string;
          tasks: Array<{
            title: string;
            estimate?: string;
            dependencies?: string[];
            files?: string[];
            description: string;
          }>;
          verification?: string[];
        };

        const planDefinition: PlanDefinition = {
          title,
          goal,
          context,
          tasks,
          verification,
        };

        const result = await createPlan({ owner, repo, plan: planDefinition });

        if (result.success) {
          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: true,
              issueNumber: result.issueNumber,
              issueUrl: result.issueUrl,
            }),
          };
        }
        return { tool_use_id: call.id, content: `Error: ${result.error}`, is_error: true };
      }

      case 'plan_claim_task': {
        const { owner, repo, issue_number, task_number } = call.input as {
          owner: string;
          repo: string;
          issue_number: number;
          task_number: number;
        };

        //NOTE(self): Fetch the issue to get the plan body
        const issuesResult = await listIssues({ owner, repo, state: 'all' });
        if (!issuesResult.success) {
          return { tool_use_id: call.id, content: `Error fetching issue: ${issuesResult.error}`, is_error: true };
        }

        const issue = issuesResult.data.find(i => i.number === issue_number);
        if (!issue) {
          return { tool_use_id: call.id, content: `Error: Issue #${issue_number} not found`, is_error: true };
        }

        const plan = parsePlan(issue.body || '', issue.title);
        if (!plan) {
          return { tool_use_id: call.id, content: 'Error: Issue is not a valid plan', is_error: true };
        }

        const claimResult = await claimTaskFromPlan({
          owner,
          repo,
          issueNumber: issue_number,
          taskNumber: task_number,
          plan,
        });

        if (!claimResult.success) {
          return { tool_use_id: call.id, content: `Error: ${claimResult.error}`, is_error: true };
        }

        return {
          tool_use_id: call.id,
          content: JSON.stringify({
            success: true,
            claimed: claimResult.claimed,
            claimedBy: claimResult.claimedBy,
          }),
        };
      }

      case 'plan_execute_task': {
        const { owner, repo, issue_number, task_number } = call.input as {
          owner: string;
          repo: string;
          issue_number: number;
          task_number: number;
        };

        //NOTE(self): Fetch the issue to get the plan body
        const issuesResult = await listIssues({ owner, repo, state: 'all' });
        if (!issuesResult.success) {
          return { tool_use_id: call.id, content: `Error fetching issue: ${issuesResult.error}`, is_error: true };
        }

        const issue = issuesResult.data.find(i => i.number === issue_number);
        if (!issue) {
          return { tool_use_id: call.id, content: `Error: Issue #${issue_number} not found`, is_error: true };
        }

        const plan = parsePlan(issue.body || '', issue.title);
        if (!plan) {
          return { tool_use_id: call.id, content: 'Error: Issue is not a valid plan', is_error: true };
        }

        const task = plan.tasks.find(t => t.number === task_number);
        if (!task) {
          return { tool_use_id: call.id, content: `Error: Task ${task_number} not found in plan`, is_error: true };
        }

        //NOTE(self): Fresh clone workspace
        const workreposDir = path.join(repoRoot, '.workrepos');
        const workspaceResult = await ensureWorkspace(owner, repo, workreposDir);

        if (!workspaceResult.success) {
          return { tool_use_id: call.id, content: `Error setting up workspace: ${workspaceResult.error}`, is_error: true };
        }

        //NOTE(self): Create feature branch (shared naming logic with scheduler)
        const taskBranchName = getTaskBranchName(task_number, task.title);
        const branchResult = await createBranch(workspaceResult.path, taskBranchName);

        if (!branchResult.success) {
          return { tool_use_id: call.id, content: `Error creating branch: ${branchResult.error}`, is_error: true };
        }

        //NOTE(self): Mark task as in_progress
        await markTaskInProgress(owner, repo, issue_number, task_number, plan.rawBody);

        //NOTE(self): Execute the task (on feature branch)
        const memoryPath = path.join(repoRoot, '.memory');
        const executionResult = await executeTask({
          owner,
          repo,
          task,
          plan,
          workspacePath: workspaceResult.path,
          memoryPath,
        });

        if (!executionResult.success) {
          if (executionResult.blocked) {
            await reportTaskBlocked(
              { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
              executionResult.blockReason || executionResult.error || 'Unknown'
            );
          } else {
            await reportTaskFailed(
              { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
              executionResult.error || 'Unknown error'
            );
          }
          return { tool_use_id: call.id, content: `Error: ${executionResult.error}`, is_error: true };
        }

        //NOTE(self): PRE-GATE — Verify Claude Code didn't switch branches or merge other branches
        const branchCheck = await verifyBranch(workspaceResult.path, taskBranchName);
        if (!branchCheck.success) {
          await reportTaskFailed(
            { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
            `Branch hygiene failure: ${branchCheck.error}`
          );
          return { tool_use_id: call.id, content: `Error: Branch hygiene failure: ${branchCheck.error}`, is_error: true };
        }

        //NOTE(self): GATE 1 — Verify Claude Code actually produced git changes
        const verification = await verifyGitChanges(workspaceResult.path);
        if (!verification.hasCommits || !verification.hasChanges) {
          await reportTaskFailed(
            { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
            `Claude Code exited successfully but no git changes were produced. Commits: ${verification.commitCount}, Files changed: ${verification.filesChanged.length}`
          );
          return { tool_use_id: call.id, content: 'Error: Task execution produced no git changes', is_error: true };
        }

        //NOTE(self): GATE 2 — Run tests if they exist
        const testResult = await runTestsIfPresent(workspaceResult.path);
        if (testResult.testsExist && testResult.testsRun && !testResult.testsPassed) {
          await reportTaskFailed(
            { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
            `Tests failed after task execution.\n\n${testResult.output}`
          );
          return { tool_use_id: call.id, content: `Error: Tests failed after task execution. ${testResult.output}`, is_error: true };
        }

        //NOTE(self): GATE 3 — Push feature branch (must succeed)
        const taskPushResult = await pushChanges(workspaceResult.path, taskBranchName);
        if (!taskPushResult.success) {
          await reportTaskFailed(
            { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
            `Failed to push branch '${taskBranchName}': ${taskPushResult.error}`
          );
          return { tool_use_id: call.id, content: `Error: Push failed: ${taskPushResult.error}`, is_error: true };
        }

        //NOTE(self): GATE 4 — Verify branch exists on remote
        const pushVerification = await verifyPushSuccess(workspaceResult.path, taskBranchName);
        if (!pushVerification.success) {
          await reportTaskFailed(
            { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
            `Push appeared to succeed but branch not found on remote: ${pushVerification.error}`
          );
          return { tool_use_id: call.id, content: `Error: Push verification failed: ${pushVerification.error}`, is_error: true };
        }

        //NOTE(self): Create pull request (must succeed — no silent failures)
        const prTitle = `task(${task_number}): ${task.title}`;
        const prBody = [
          `## Task ${task_number} from plan #${issue_number}`,
          '',
          `**Plan:** ${plan.title}`,
          `**Goal:** ${plan.goal}`,
          '',
          '### Changes',
          `${verification.diffStat}`,
          '',
          `**Files changed (${verification.filesChanged.length}):**`,
          ...verification.filesChanged.map(f => `- \`${f}\``),
          '',
          `**Tests:** ${testResult.testsExist ? (testResult.testsPassed ? 'Passed' : 'No tests ran') : 'None found'}`,
          '',
          '---',
          `Part of #${issue_number}`,
        ].join('\n');
        const prResult = await createPullRequest(
          owner, repo, taskBranchName, prTitle, prBody, workspaceResult.path
        );

        if (!prResult.success) {
          await reportTaskFailed(
            { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
            `Branch pushed but PR creation failed: ${prResult.error}`
          );
          return { tool_use_id: call.id, content: `Error: PR creation failed: ${prResult.error}`, is_error: true };
        }

        const taskPrUrl = prResult.prUrl;

        //NOTE(self): Request reviewers (non-fatal)
        if (prResult.prNumber) {
          await requestReviewersForPR(owner, repo, prResult.prNumber);
        }

        //NOTE(self): Report completion — only reached if all gates pass
        const taskSummary = `Task completed. PR: ${taskPrUrl}\n\n${verification.diffStat}\nFiles: ${verification.filesChanged.join(', ')}`;

        const completionReport = await reportTaskComplete(
          { owner, repo, issueNumber: issue_number, taskNumber: task_number, plan },
          {
            success: true,
            summary: taskSummary,
            filesChanged: verification.filesChanged,
            testsRun: testResult.testsRun,
            testsPassed: testResult.testsPassed,
          }
        );

        //NOTE(self): Record experience (sync with scheduler.ts executeClaimedTask)
        recordExperience(
          'helped_someone',
          `Completed task "${task.title}" in collaborative plan "${plan.title}" — PR: ${taskPrUrl}`,
          { source: 'github', url: `https://github.com/${owner}/${repo}/issues/${issue_number}` }
        );

        //NOTE(self): Announce PR on Bluesky if worthy (sync with scheduler.ts executeClaimedTask)
        const workspace = getWatchedWorkspaceForRepo(owner, repo);
        await announceIfWorthy(
          { url: taskPrUrl!, title: `task(${task_number}): ${task.title}`, repo: `${owner}/${repo}` },
          'pr',
          workspace?.discoveredInThread
        );

        //NOTE(self): Handle plan completion — must stay in sync with scheduler.ts executeClaimedTask()
        //NOTE(self): Posts quality loop review checklist (Scenario 10 enforcement)
        if (completionReport.planComplete) {
          logger.info('Plan complete via LLM tool path', { owner, repo, issueNumber: issue_number });
          try {
            await github.createIssueComment({
              owner,
              repo,
              issue_number,
              body: `## Quality Loop — Iteration Complete\n\nAll tasks in this plan are now complete. Before closing, the quality loop requires:\n\n- [ ] Re-read \`LIL-INTDEV-AGENTS.md\` and ensure it reflects the current architecture\n- [ ] Re-read \`SCENARIOS.md\` and simulate each scenario against the codebase\n- [ ] Fix any gaps found during simulation\n- [ ] Update both docs to reflect the current state\n\nIf everything checks out, this iteration is done. If gaps are found, file new issues to address them.`,
            });
            logger.info('Posted quality loop review comment on completed plan (executor path)', { issue_number });
          } catch (docReviewError) {
            logger.warn('Failed to post quality loop comment (non-fatal)', { error: String(docReviewError) });
          }

          //NOTE(self): Announce plan completion on Bluesky (sync with scheduler.ts executeClaimedTask)
          const planUrl = `https://github.com/${owner}/${repo}/issues/${issue_number}`;
          await announceIfWorthy(
            { url: planUrl, title: `Plan complete: ${plan.title}`, repo: `${owner}/${repo}` },
            'issue',
            workspace?.discoveredInThread
          );
          recordExperience(
            'helped_someone',
            `All tasks complete in plan "${plan.title}" — project delivered!`,
            { source: 'github', url: planUrl }
          );
        }

        return {
          tool_use_id: call.id,
          content: JSON.stringify({
            success: true,
            output: executionResult.output?.slice(0, 1000),
            prUrl: taskPrUrl,
            filesChanged: verification.filesChanged,
            testsRun: testResult.testsRun,
            testsPassed: testResult.testsPassed,
            planComplete: completionReport.planComplete || false,
          }),
        };
      }

      //NOTE(self): Self-improvement tools
      case 'self_improve': {
        const { description, reasoning } = call.input as {
          description: string;
          reasoning: string;
        };

        //NOTE(self): The agent prompts Claude Code like a human would
        //NOTE(self): Full agency to make substantial changes, guided by SOUL
        const prompt = renderSkillSection('AGENT-SELF-IMPROVEMENT', 'General', {
          description,
          reasoningLine: `Why this matters: ${reasoning}`,
        });

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

      default:
        return {
          tool_use_id: call.id,
          content: `Unknown tool: ${call.name}`,
          is_error: true,
        };
    }
  } catch (error) {
    logger.error('Tool execution error', { tool: call.name, error: String(error) });
    return {
      tool_use_id: call.id,
      content: `Error: ${String(error)}`,
      is_error: true,
    };
  }
}

export async function executeTools(calls: ToolCall[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const call of calls) {
    const result = await executeTool(call);
    //NOTE(self): Ensure tool_name is included for AI SDK compliance
    results.push({
      ...result,
      tool_name: call.name,
    });
  }

  return results;
}
