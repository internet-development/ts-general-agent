import * as path from 'path';
import { logger } from '@modules/logger.js';
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

      //NOTE(self): Web tools
      case 'web_fetch': {
        const { url, extract = 'text' } = call.input as {
          url: string;
          extract?: 'text' | 'html' | 'json';
        };

        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'ts-general-agent/0.0.2 (Autonomous Agent)',
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
