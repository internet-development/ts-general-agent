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
import { markInteractionResponded, hasRepliedToPost, markPostReplied } from '@modules/engagement.js';
import { runClaudeCode } from '@skills/self-improvement.js';
import { processBase64ImageForUpload, processFileImageForUpload } from '@modules/image-processor.js';
import { ui } from '@modules/ui.js';
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

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const config = getConfig();
  const repoRoot = getRepoRoot();

  logger.info('Executing tool', { name: call.name, input: call.input });

  try {
    switch (call.name) {
      //NOTE(self): Bluesky tools
      case 'bluesky_post': {
        const text = call.input.text as string;
        //NOTE(self): Print what the agent is about to say so it's easy to follow
        ui.social(`${config.agent.name}`, text);
        const result = await atproto.createPost({ text });
        if (result.success) {
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

        //NOTE(self): Print what the agent is about to say so it's easy to follow
        ui.social(`${config.agent.name} (with image)`, text);

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

        if (postResult.success) {
          //NOTE(self): Clean up the temp image file after successful post
          if (imageFilePath) {
            try {
              fs.unlinkSync(imageFilePath);
              logger.debug('Cleaned up image file', { filePath: imageFilePath });
            } catch (err) {
              logger.warn('Failed to clean up image file', { filePath: imageFilePath, error: String(err) });
            }
          }

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
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
          return { tool_use_id: call.id, content: 'Error: Reply text is required and cannot be empty', is_error: true };
        }
        if (!post_uri || !post_cid) {
          return { tool_use_id: call.id, content: 'Error: post_uri and post_cid are required to reply', is_error: true };
        }

        //NOTE(self): Prevent multiple replies to the SAME post - this creates sibling spam
        //NOTE(self): Thread-level blocking removed - conversations must be allowed to continue!
        if (hasRepliedToPost(post_uri)) {
          logger.warn('Blocked duplicate reply attempt', { post_uri });
          return { tool_use_id: call.id, content: 'BLOCKED: You have already replied to this post. Replying multiple times to the same post is spam. Move on to the next notification.', is_error: true };
        }

        //NOTE(self): Build reply refs - auto-resolves root if not provided
        const replyRefsResult = await atproto.getReplyRefs(post_uri, post_cid, root_uri, root_cid);
        if (!replyRefsResult.success) {
          return { tool_use_id: call.id, content: `Error resolving reply refs: ${replyRefsResult.error}`, is_error: true };
        }

        const replyRefs = replyRefsResult.data;
        const threadRootUri = replyRefs.root.uri;

        //NOTE(self): Print what the agent is about to say so it's easy to follow
        ui.social(`${config.agent.name} (reply)`, text);

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
          //NOTE(self): Mark the interaction as responded in engagement tracking
          markInteractionResponded(post_uri, result.data.uri);
          //NOTE(self): Mark this post as replied to (prevents sibling spam, allows thread conversations)
          markPostReplied(post_uri);
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
          description: block.description?.slice(0, 200),
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
        const { channel_url, reply_to } = call.input as {
          channel_url: string;
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

        //NOTE(self): Keep copy short - title + source, ensuring full URL
        let postText = blockTitle;
        const sourcePrefix = '\n\nSource: ';
        const maxTitleLen = 300 - sourcePrefix.length - sourceUrl.length;
        if (postText.length > maxTitleLen) {
          postText = postText.slice(0, maxTitleLen - 3) + '...';
        }
        postText += sourcePrefix + sourceUrl;

        //NOTE(self): Build alt text from title + description
        let altText = blockTitle;
        if (selectedBlock.description) {
          altText += ` - ${selectedBlock.description.slice(0, 500)}`;
        }

        //NOTE(self): Create post
        ui.social(`${config.agent.name} (arena image)`, postText);

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

      //NOTE(self): Self-improvement tools
      case 'self_improve': {
        const { description, reasoning } = call.input as {
          description: string;
          reasoning: string;
        };

        //NOTE(self): The agent prompts Claude Code like a human would
        //NOTE(self): Full agency to make substantial changes, guided by SOUL
        const prompt = `You are the soul of an autonomous agent improving yourself.

The agent has requested:
${description}

Why this matters: ${reasoning}

You have full access to your own codebase. SOUL.md is your only constraint - it defines your unchangeable values. Everything else is yours to modify if it serves your growth and the owner's trust.

Key directories:
- adapters/ - how you connect to the world (Bluesky, GitHub, etc.)
- modules/ - your core runtime (loop, tools, memory, sandbox)
- skills/ - your capabilities (including this self-improvement system)
- .memory/ - your persistent memory
- SELF.md - your self-reflection

Read AGENTS.md and SOUL.md first - they define who you are.
Document significant changes in .memory/ so you remember what you did and why.

Proceed thoughtfully.`;

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
