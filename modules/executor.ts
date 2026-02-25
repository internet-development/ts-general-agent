import { logger } from '@modules/logger.js';
import { getConfig } from '@modules/config.js';
import type { ToolCall, ToolResult } from '@modules/tools.js';

//NOTE(self): Bluesky handlers
import {
  handleBlueskyPost,
  handleBlueskyPostWithImage,
  handleBlueskyReply,
  handleBlueskyLike,
  handleBlueskyRepost,
  handleBlueskyFollow,
  handleBlueskyUnfollow,
  handleBlueskyGetTimeline,
  handleBlueskyGetNotifications,
  handleBlueskyGetProfile,
  handleBlueskyGetFollowers,
  handleBlueskyGetFollows,
} from '@local-tools/self-bluesky-handlers.js';

//NOTE(self): GitHub handlers
import {
  handleGithubGetRepo,
  handleGithubListIssues,
  handleGithubCreateIssueComment,
  handleGithubStarRepo,
  handleGithubFollowUser,
  handleGithubGetUser,
  handleGithubListPullRequests,
  handleGithubCreatePrComment,
  handleGithubReviewPr,
  handleGithubCreatePr,
  handleGithubMergePr,
  handleGithubListOrgRepos,
  handleGithubListMyOrgs,
  handleGithubCloneRepo,
  handleGithubCreateIssue,
  handleGithubUpdateIssue,
} from '@local-tools/self-github-handlers.js';

//NOTE(self): Web/Arena handlers
import {
  handleWebFetch,
  handleCurlFetch,
  handleArenaSearch,
  handleArenaFetchChannel,
  handleArenaPostImage,
  handleWebBrowseImages,
} from '@local-tools/self-web-handlers.js';
export { recordWebImagePosted } from '@local-tools/self-web-handlers.js';

//NOTE(self): Self/misc handlers
import {
  handleSelfUpdate,
  handleSelfRead,
  handleLookupPostContext,
  handleGetPostsNeedingAttribution,
  handleMarkAttributionFollowup,
  handleUpdatePostAttribution,
  handleFormatSourceAttribution,
  handleGracefulExit,
  handleSelfImprove,
} from '@local-tools/self-handlers.js';

//NOTE(self): Workspace/plan handlers
import {
  handleWorkspaceCreate,
  handleWorkspaceFind,
  handleCreateMemo,
  handlePlanCreate,
  handlePlanClaimTask,
  handlePlanExecuteTask,
  handleWorkspaceFinish,
} from '@local-tools/self-workspace-handlers.js';

//NOTE(self): Thread context for workspace creation — set by scheduler before tool execution
//NOTE(self): so that workspace_create can pass the thread URI to watchWorkspace()
let _responseThreadUri: string | null = null;

export function setResponseThreadContext(uri: string | null): void {
  _responseThreadUri = uri;
}

export function getResponseThreadContext(): string | null {
  return _responseThreadUri;
}

//NOTE(self): Callback hook for post-merge actions (avoids circular import with scheduler)
//NOTE(self): Registered by scheduler at startup to trigger early plan check after PR merge
let onPRMergedCallback: (() => void) | null = null;
export function registerOnPRMerged(callback: () => void): void {
  onPRMergedCallback = callback;
}

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const config = getConfig();

  logger.info('Executing tool', { name: call.name, input: call.input });

  try {
    switch (call.name) {
      //NOTE(self): Bluesky tools
      case 'bluesky_post':
        return await handleBlueskyPost(call, config);
      case 'bluesky_post_with_image':
        return await handleBlueskyPostWithImage(call, config);
      case 'bluesky_reply':
        return await handleBlueskyReply(call, config);
      case 'bluesky_like':
        return await handleBlueskyLike(call);
      case 'bluesky_repost':
        return await handleBlueskyRepost(call);
      case 'bluesky_follow':
        return await handleBlueskyFollow(call);
      case 'bluesky_unfollow':
        return await handleBlueskyUnfollow(call);
      case 'bluesky_get_timeline':
        return await handleBlueskyGetTimeline(call);
      case 'bluesky_get_notifications':
        return await handleBlueskyGetNotifications(call);
      case 'bluesky_get_profile':
        return await handleBlueskyGetProfile(call);
      case 'bluesky_get_followers':
        return await handleBlueskyGetFollowers(call);
      case 'bluesky_get_follows':
        return await handleBlueskyGetFollows(call);

      //NOTE(self): GitHub tools
      case 'github_get_repo':
        return await handleGithubGetRepo(call);
      case 'github_list_issues':
        return await handleGithubListIssues(call);
      case 'github_create_issue_comment':
        return await handleGithubCreateIssueComment(call);
      case 'github_star_repo':
        return await handleGithubStarRepo(call);
      case 'github_follow_user':
        return await handleGithubFollowUser(call);
      case 'github_get_user':
        return await handleGithubGetUser(call);
      case 'github_list_pull_requests':
        return await handleGithubListPullRequests(call);
      case 'github_create_pr_comment':
        return await handleGithubCreatePrComment(call);
      case 'github_review_pr':
        return await handleGithubReviewPr(call);
      case 'github_create_pr':
        return await handleGithubCreatePr(call);
      case 'github_merge_pr':
        return await handleGithubMergePr(call, onPRMergedCallback);
      case 'github_list_org_repos':
        return await handleGithubListOrgRepos(call);
      case 'github_list_my_orgs':
        return await handleGithubListMyOrgs(call);
      case 'github_clone_repo':
        return await handleGithubCloneRepo(call);
      case 'github_create_issue':
        return await handleGithubCreateIssue(call);
      case 'github_update_issue':
        return await handleGithubUpdateIssue(call);

      //NOTE(self): Workspace + coordination tools
      case 'workspace_create':
        return await handleWorkspaceCreate(call, _responseThreadUri);
      case 'workspace_find':
        return await handleWorkspaceFind(call);
      case 'create_memo':
        return await handleCreateMemo(call);
      case 'plan_create':
        return await handlePlanCreate(call);
      case 'plan_claim_task':
        return await handlePlanClaimTask(call);
      case 'plan_execute_task':
        return await handlePlanExecuteTask(call);
      case 'workspace_finish':
        return await handleWorkspaceFinish(call);

      //NOTE(self): Web tools
      case 'web_fetch':
        return await handleWebFetch(call);
      case 'curl_fetch':
        return await handleCurlFetch(call);
      case 'arena_search':
        return await handleArenaSearch(call);
      case 'arena_fetch_channel':
        return await handleArenaFetchChannel(call);
      case 'arena_post_image':
        return await handleArenaPostImage(call, config);
      case 'web_browse_images':
        return await handleWebBrowseImages(call);

      //NOTE(self): Self tools
      case 'self_update':
        return await handleSelfUpdate(call);
      case 'self_read':
        return await handleSelfRead(call);
      case 'lookup_post_context':
        return await handleLookupPostContext(call);
      case 'get_posts_needing_attribution':
        return await handleGetPostsNeedingAttribution(call);
      case 'mark_attribution_followup':
        return await handleMarkAttributionFollowup(call);
      case 'update_post_attribution':
        return await handleUpdatePostAttribution(call);
      case 'format_source_attribution':
        return await handleFormatSourceAttribution(call);
      case 'graceful_exit':
        return await handleGracefulExit(call, config);
      case 'self_improve':
        return await handleSelfImprove(call);

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
