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
import { markInteractionResponded } from '@modules/engagement.js';
import { runClaudeCode } from '@skills/self-improvement.js';
import { processBase64ImageForUpload, processFileImageForUpload } from '@modules/image-processor.js';

export interface ActionQueueItem {
  id: string;
  action: string;
  priority: 'high' | 'normal' | 'low';
  timestamp: number;
}

let actionQueue: ActionQueueItem[] = [];
let queueIdCounter = 0;

export function getActionQueue(): ActionQueueItem[] {
  return [...actionQueue];
}

export function clearActionQueue(): void {
  actionQueue = [];
}

export function addToQueue(action: string, priority: 'high' | 'normal' | 'low' = 'normal'): string {
  const id = `action-${++queueIdCounter}`;
  actionQueue.push({
    id,
    action,
    priority,
    timestamp: Date.now(),
  });

  //NOTE(self): Sort by priority (high first)
  const priorityOrder = { high: 0, normal: 1, low: 2 };
  actionQueue.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return id;
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
        const result = await atproto.createPost({
          text,
          replyTo: {
            uri: post_uri,
            cid: post_cid,
            rootUri: root_uri,
            rootCid: root_cid,
          },
        });
        if (result.success) {
          //NOTE(self): Mark the interaction as responded in engagement tracking
          markInteractionResponded(post_uri, result.data.uri);
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
          //NOTE(self): Simplify PR data for easier consumption
          const simplified = result.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            user: pr.user?.login,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            html_url: pr.html_url,
            body: pr.body?.slice(0, 500),
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
              try { fs.unlinkSync(tempFile); } catch { /* ignore */ }

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
              try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
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
                  try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
                  resolve({
                    tool_use_id: call.id,
                    content: 'Error: URL returned HTML/XML instead of binary data (likely an error page)',
                    is_error: true,
                  });
                  return;
                }
              } catch {
                //NOTE(self): Failed to read magic bytes, use server-provided mime type
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
            try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
            resolve({
              tool_use_id: call.id,
              content: `Error: ${err.message}`,
              is_error: true,
            });
          });
        });
      }

      //NOTE(self): Memory tools
      case 'memory_write': {
        const { path: relativePath, content, append = false } = call.input as {
          path: string;
          content: string;
          append?: boolean;
        };
        const fullPath = path.join(repoRoot, '.memory', relativePath);

        const success = append
          ? safeAppendFile(fullPath, content)
          : safeWriteFile(fullPath, content);

        if (success) {
          return { tool_use_id: call.id, content: JSON.stringify({ success: true, path: relativePath }) };
        }
        return { tool_use_id: call.id, content: 'Error: Failed to write to memory', is_error: true };
      }

      case 'memory_read': {
        const relativePath = call.input.path as string;
        const fullPath = path.join(repoRoot, '.memory', relativePath);
        const content = safeReadFile(fullPath);

        if (content !== null) {
          return { tool_use_id: call.id, content };
        }
        return { tool_use_id: call.id, content: 'Error: File not found or not readable', is_error: true };
      }

      case 'memory_list': {
        const relativePath = (call.input.path as string) || '';
        const fullPath = path.join(repoRoot, '.memory', relativePath);
        const files = safeListDir(fullPath);

        if (files !== null) {
          return { tool_use_id: call.id, content: JSON.stringify(files) };
        }
        return { tool_use_id: call.id, content: 'Error: Directory not found or not readable', is_error: true };
      }

      //NOTE(self): Self tools
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

      //NOTE(self): Queue tools
      case 'queue_add': {
        const { action, priority = 'normal' } = call.input as {
          action: string;
          priority?: 'high' | 'normal' | 'low';
        };
        const id = addToQueue(action, priority);
        return { tool_use_id: call.id, content: JSON.stringify({ success: true, id, queueLength: actionQueue.length }) };
      }

      case 'queue_clear': {
        clearActionQueue();
        return { tool_use_id: call.id, content: JSON.stringify({ success: true }) };
      }

      //NOTE(self): Self-improvement tools
      case 'self_improve': {
        const { description, reasoning } = call.input as {
          description: string;
          reasoning: string;
        };

        //NOTE(self): The agent prompts Claude Code like a human would
        //NOTE(self): Full agency to make substantial changes, guided by SOUL
        const prompt = `${description}

Context: ${reasoning}

Read AGENTS.md and SOUL.md first - my soul guides everything I do.`;

        const memoryPath = path.join(repoRoot, '.memory');
        const result = await runClaudeCode(prompt, repoRoot, memoryPath);

        if (result.success) {
          return {
            tool_use_id: call.id,
            content: JSON.stringify({
              success: true,
              output: result.output?.slice(0, 2000),
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
    results.push(result);
  }

  return results;
}
