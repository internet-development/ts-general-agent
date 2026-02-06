//NOTE(self): Scheduler Module
//NOTE(self): Coordinates my five modes of being:
//NOTE(self): 1. Awareness - watching for people who reach out (cheap, fast)
//NOTE(self): 2. Expression - sharing thoughts from my SELF (scheduled)
//NOTE(self): 3. Reflection - integrating experiences and updating SELF (deep)
//NOTE(self): 4. Self-Improvement - fixing friction via Claude Code (rare)
//NOTE(self): 5. Plan Awareness - polling workspaces for collaborative tasks (3 min)
//NOTE(self): This architecture lets me be responsive AND expressive while conserving tokens.

import { logger } from '@modules/logger.js';
import { ui, type ScheduledTimers } from '@modules/ui.js';
import { getConfig, type Config } from '@modules/config.js';
import { readSoul, readSelf } from '@modules/memory.js';
import { chatWithTools, AGENT_TOOLS, isFatalError, createAssistantToolUseMessage, createToolResultMessage, type Message } from '@modules/openai.js';
import { executeTools } from '@modules/executor.js';
import type { ToolCall } from '@modules/tools.js';
import { pacing } from '@modules/pacing.js';
import * as atproto from '@adapters/atproto/index.js';
import { getAuthorFeed } from '@adapters/atproto/get-timeline.js';
import { getSession, ensureValidSession } from '@adapters/atproto/authenticate.js';
import {
  prioritizeNotifications,
  recordInteraction,
  hasUrgentNotifications,
  recordSignificantEvent,
  getSignificantEventCount,
  addInsight,
  getInsights,
  getReflectionState,
  recordReflectionComplete,
  getRelationshipSummary,
  shouldRespondTo,
  getSeenAt,
  updateSeenAt,
  type PrioritizedNotification,
} from '@modules/engagement.js';
import {
  extractFromSelf,
  assessSelfRichness,
} from '@modules/self-extract.js';
import {
  recordExperience,
  getExperiencesForReflection,
  markExperiencesIntegrated,
  pruneOldExperiences,
} from '@skills/self-capture-experiences.js';
import {
  loadExpressionSchedule,
  saveExpressionSchedule,
  generateExpressionPrompt,
  scheduleNextExpression,
  shouldExpress,
  getPendingPrompt,
  recordExpression,
  getExpressionStats,
  updateExpressionEngagement,
  getExpressionsNeedingEngagementCheck,
  getEngagementPatterns,
  checkInvitation,
  getInvitationPrompt,
} from '@modules/expression.js';
import {
  recordFriction,
  shouldAttemptImprovement,
  getFrictionReadyForImprovement,
  markFrictionAttempted,
  recordImprovementOutcome,
  buildImprovementPrompt,
  getFrictionStats,
  type FrictionCategory,
} from '@skills/self-detect-friction.js';
import {
  shouldAttemptGrowth,
  getAspirationForGrowth,
  markAspirationAttempted,
  recordGrowthOutcome,
  buildGrowthPrompt,
  getAspirationStats,
} from '@skills/self-identify-aspirations.js';
import { runClaudeCode } from '@skills/self-improve-run.js';
import * as github from '@adapters/github/index.js';
import {
  extractGitHubUrlsFromRecord,
  type ParsedGitHubUrl,
} from '@adapters/github/parse-url.js';
import {
  getNotifications as getGitHubNotifications,
  filterActionableNotifications,
  extractNumberFromApiUrl,
  markNotificationRead,
  type GitHubNotification,
} from '@adapters/github/get-notifications.js';
import {
  getIssueThread,
  analyzeConversation,
  formatThreadForContext,
  type IssueThread,
} from '@adapters/github/get-issue-thread.js';
import {
  getGitHubSeenAt,
  updateGitHubSeenAt,
  updateLastNotificationCheck,
  trackConversation as trackGitHubConversation,
  getConversation as getGitHubConversation,
  recordOurComment,
  updateConversationState as updateGitHubConversationState,
  markConversationConcluded as markGitHubConversationConcluded,
  getConversationsNeedingAttention as getGitHubConversationsNeedingAttention,
} from '@modules/github-engagement.js';
import {
  pollWorkspacesForPlans,
  getWatchedWorkspaces,
  getWorkspaceDiscoveryStats,
  type DiscoveredPlan,
} from '@modules/workspace-discovery.js';
import { getPeerUsernames, getPeerBlueskyHandles, registerPeer, isPeer } from '@modules/peer-awareness.js';
import { processTextForWorkspaces } from '@skills/self-workspace-watch.js';
import { claimTaskFromPlan, markTaskInProgress } from '@skills/self-task-claim.js';
import { executeTask, ensureWorkspace, pushChanges } from '@skills/self-task-execute.js';
import { reportTaskComplete, reportTaskBlocked, reportTaskFailed } from '@skills/self-task-report.js';
import { parsePlan } from '@skills/self-plan-parse.js';
import {
  trackConversation as trackBlueskyConversation,
  recordParticipantActivity,
  recordOurReply,
  updateThreadDepth,
  analyzeConversation as analyzeBlueskyConversation,
  shouldRespondInConversation,
  getConversation as getBlueskyConversation,
  cleanupOldConversations as cleanupOldBlueskyConversations,
} from '@modules/bluesky-engagement.js';

//NOTE(self): Scheduler Configuration - can be tuned from SELF.md in future
export interface SchedulerConfig {
  //NOTE(self): Awareness loop interval (ms) - how often to check for replies
  awarenessInterval: number;
  //NOTE(self): GitHub awareness interval (ms) - how often to check GitHub notifications
  githubAwarenessInterval: number;
  //NOTE(self): Expression interval range (ms) - how often to share thoughts
  expressionMinInterval: number;
  expressionMaxInterval: number;
  //NOTE(self): Reflection interval (ms) - how often to deeply reflect
  reflectionInterval: number;
  //NOTE(self): Self-improvement minimum gap (hours)
  improvementMinHours: number;
  //NOTE(self): Quiet hours (no expression, reduced awareness)
  quietHoursStart: number; // 0-23
  quietHoursEnd: number; // 0-23
  //NOTE(self): Number of significant events (replies) before triggering reflection
  reflectionEventThreshold: number;
  //NOTE(self): Plan awareness interval (ms) - how often to check for collaborative tasks
  planAwarenessInterval: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  awarenessInterval: 45_000, //NOTE(self): 45 seconds - quick enough to feel responsive to replies
  githubAwarenessInterval: 2 * 60_000, //NOTE(self): 2 minutes - GitHub rate limits are stricter
  expressionMinInterval: 3 * 60 * 60 * 1000, //NOTE(self): 3 hours minimum between posts (token-heavy)
  expressionMaxInterval: 4 * 60 * 60 * 1000, //NOTE(self): 4 hours maximum between posts
  reflectionInterval: 6 * 60 * 60 * 1000, //NOTE(self): 6 hours between reflections (token-heavy)
  improvementMinHours: 24, //NOTE(self): At least 24 hours between improvement attempts
  quietHoursStart: 23, //NOTE(self): 11pm
  quietHoursEnd: 7, //NOTE(self): 7am
  reflectionEventThreshold: 10, //NOTE(self): Reflect after 10 significant events (replies, posts)
  planAwarenessInterval: 3 * 60_000, //NOTE(self): 3 minutes - poll workspaces for collaborative tasks
};

//NOTE(self): GitHub conversation pending action
interface PendingGitHubConversation {
  owner: string;
  repo: string;
  number: number;
  type: 'issue' | 'pull';
  url: string;
  thread: IssueThread;
  //NOTE(self): Source of how we found this conversation
  //NOTE(self): bluesky_url_owner = owner explicitly shared this on Bluesky (highest priority)
  //NOTE(self): bluesky_url = someone else shared this on Bluesky
  //NOTE(self): github_notification = direct GitHub notification
  source: 'bluesky_url_owner' | 'bluesky_url' | 'github_notification';
  reason: string;
}

//NOTE(self): Scheduler State
interface SchedulerState {
  isRunning: boolean;
  lastAwarenessCheck: number;
  lastGitHubAwarenessCheck: number;
  lastReflection: number;
  lastImprovementCheck: number;
  lastPlanAwarenessCheck: number;
  currentMode: 'idle' | 'awareness' | 'responding' | 'expressing' | 'reflecting' | 'improving' | 'github_responding' | 'plan_executing';
  pendingNotifications: PrioritizedNotification[];
  pendingGitHubConversations: PendingGitHubConversation[];
  consecutiveErrors: number;
}

//NOTE(self): Deterministic jitter from agent name
//NOTE(self): Each SOUL gets a consistent delay so they naturally stagger
//NOTE(self): sh-marvin always waits Xms, sh-peterben always waits Yms
function getAgentJitter(agentName: string): number {
  let hash = 0;
  for (let i = 0; i < agentName.length; i++) {
    hash = ((hash << 5) - hash) + agentName.charCodeAt(i);
    hash |= 0;
  }
  //NOTE(self): Map to 15-90 second range
  return 15_000 + (Math.abs(hash) % 75_000);
}

//NOTE(self): The Scheduler Class
export class AgentScheduler {
  private config: SchedulerConfig;
  private appConfig: Config;
  private state: SchedulerState;
  private awarenessTimer: NodeJS.Timeout | null = null;
  private githubAwarenessTimer: NodeJS.Timeout | null = null;
  private expressionTimer: NodeJS.Timeout | null = null;
  private reflectionTimer: NodeJS.Timeout | null = null;
  private engagementCheckTimer: NodeJS.Timeout | null = null;
  private planAwarenessTimer: NodeJS.Timeout | null = null;
  private shutdownRequested = false;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.appConfig = getConfig();
    this.state = {
      isRunning: false,
      lastAwarenessCheck: 0,
      lastGitHubAwarenessCheck: 0,
      lastReflection: Date.now(),
      lastImprovementCheck: 0,
      lastPlanAwarenessCheck: 0,
      currentMode: 'idle',
      pendingNotifications: [],
      pendingGitHubConversations: [],
      consecutiveErrors: 0,
    };
  }

  //NOTE(self): Check if we're in quiet hours
  private isQuietHours(): boolean {
    const hour = new Date().getHours();
    if (this.config.quietHoursStart > this.config.quietHoursEnd) {
      //NOTE(self): Spans midnight (e.g., 23-7)
      return hour >= this.config.quietHoursStart || hour < this.config.quietHoursEnd;
    }
    return hour >= this.config.quietHoursStart && hour < this.config.quietHoursEnd;
  }

  //NOTE(self): Deduplicate reply tool calls to save tokens
  //NOTE(self): Prevents LLM from replying to the same post multiple times in one session
  //NOTE(self): Session-local Set handles 99% of cases; executor's API check is the safety net
  private deduplicateReplyToolCalls(
    toolCalls: ToolCall[],
    repliedPostUris: Set<string>
  ): { deduplicated: ToolCall[]; skipped: number } {
    let skipped = 0;
    const deduplicated = toolCalls.filter((tc) => {
      //NOTE(self): Only deduplicate reply-type tools
      if (tc.name !== 'bluesky_reply') {
        return true;
      }

      const postUri = tc.input?.post_uri as string | undefined;
      if (!postUri) {
        return true; //NOTE(self): Let executor handle validation errors
      }

      //NOTE(self): Check if we've already replied to this post in this session
      //NOTE(self): The executor's hasAgentRepliedInThread API check handles cross-session deduplication
      if (repliedPostUris.has(postUri)) {
        logger.info('Deduplicating reply tool call (session)', { postUri, toolId: tc.id });
        skipped++;
        return false;
      }

      return true;
    });

    return { deduplicated, skipped };
  }

  //NOTE(self): Start all loops
  async start(): Promise<void> {
    if (this.state.isRunning) {
      logger.warn('Scheduler already running');
      return;
    }

    this.state.isRunning = true;
    this.shutdownRequested = false;

    ui.system('Scheduler starting', 'awareness + expression + reflection');

    //NOTE(self): Ensure we have a valid session
    const sessionValid = await ensureValidSession();
    if (!sessionValid) {
      ui.error('Failed to establish session');
      return;
    }

    //NOTE(self): Initialize expression schedule if needed
    const expressionSchedule = loadExpressionSchedule();
    if (!expressionSchedule.nextExpression) {
      scheduleNextExpression(
        this.config.expressionMinInterval / 60000,
        this.config.expressionMaxInterval / 60000
      );
      ui.info('Expression scheduled', 'first post coming soon');
    }

    //NOTE(self): Start the loops
    this.startAwarenessLoop();
    this.startGitHubAwarenessLoop();
    this.startExpressionLoop();
    this.startReflectionLoop();
    this.startEngagementCheckLoop();
    this.startHeartbeatLoop();
    this.startPlanAwarenessLoop();

    //NOTE(self): Start UI timer updates
    this.startTimerUpdates();

    //NOTE(self): Run initial reflection to recalibrate and integrate any pending experiences
    //NOTE(self): This grounds the agent in its identity and updates SELF.md with learnings
    ui.system('Initial reflection', 'grounding in self before acting');
    await this.reflectionCycle();

    //NOTE(self): Run initial awareness checks
    await this.awarenessCheck();
    await this.githubAwarenessCheck();
  }

  //NOTE(self): Stop all loops
  stop(): void {
    this.shutdownRequested = true;
    this.state.isRunning = false;

    if (this.awarenessTimer) {
      clearInterval(this.awarenessTimer);
      this.awarenessTimer = null;
    }
    if (this.expressionTimer) {
      clearTimeout(this.expressionTimer);
      this.expressionTimer = null;
    }
    if (this.reflectionTimer) {
      clearTimeout(this.reflectionTimer);
      this.reflectionTimer = null;
    }
    if (this.engagementCheckTimer) {
      clearInterval(this.engagementCheckTimer);
      this.engagementCheckTimer = null;
    }
    if (this.githubAwarenessTimer) {
      clearInterval(this.githubAwarenessTimer);
      this.githubAwarenessTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.planAwarenessTimer) {
      clearInterval(this.planAwarenessTimer);
      this.planAwarenessTimer = null;
    }

    ui.system('Scheduler stopped');
  }

  //NOTE(self): ========== AWARENESS LOOP ==========
  //NOTE(self): Fast, cheap check for people reaching out
  //NOTE(self): No LLM tokens used - just API calls

  private startAwarenessLoop(): void {
    this.awarenessTimer = setInterval(async () => {
      if (this.shutdownRequested) return;
      if (this.state.currentMode !== 'idle') {
        //NOTE(self): Don't interrupt other modes
        return;
      }
      await this.awarenessCheck();
    }, this.config.awarenessInterval);
  }

  private async awarenessCheck(): Promise<void> {
    if (this.state.currentMode !== 'idle') return;

    this.state.lastAwarenessCheck = Date.now();

    try {
      //NOTE(self): Quick notification check - no LLM
      const notifResult = await atproto.getNotifications({ limit: 10 });
      if (!notifResult.success) {
        logger.debug('Awareness check failed', { error: notifResult.error });
        return;
      }

      const notifications = notifResult.data.notifications;
      const session = getSession();
      const agentDid = session?.did;

      //NOTE(self): Get seenAt timestamp for restart recovery filtering
      const seenAt = getSeenAt();

      //NOTE(self): Prioritize and check for urgent items
      const prioritized = prioritizeNotifications(
        notifications,
        this.appConfig.owner.blueskyDid,
        agentDid
      );

      //NOTE(self): Record interactions
      for (const pn of prioritized) {
        recordInteraction(pn.notification);
      }

      //NOTE(self): Filter to conversations that need response
      //NOTE(self): Use seenAt timestamp for restart recovery - only process notifications newer than last seen
      //NOTE(self): The executor's API check (hasAgentRepliedInThread) handles actual deduplication
      const needsResponse = prioritized.filter((pn) => {
        const n = pn.notification;
        if (!['reply', 'mention', 'quote'].includes(n.reason)) return false;

        //NOTE(self): seenAt filter for restart recovery - skip old notifications we've already processed
        if (seenAt) {
          const notifTime = new Date(n.indexedAt);
          if (notifTime <= seenAt) {
            logger.debug('Skipping notification older than seenAt', { uri: n.uri, notifTime: n.indexedAt, seenAt: seenAt.toISOString() });
            return false;
          }
        }

        return true;
      });

      //NOTE(self): Log what we found for debugging
      logger.info('Awareness check complete', {
        fetched: notifications.length,
        prioritized: prioritized.length,
        needsResponse: needsResponse.length,
        seenAt: seenAt?.toISOString() || 'none',
        reasons: needsResponse.map(pn => ({ reason: pn.notification.reason, author: pn.notification.author.handle })),
      });

      if (needsResponse.length > 0) {
        ui.info('Ready to respond');
        this.state.pendingNotifications = needsResponse;

        //NOTE(self): Extract GitHub URLs from Bluesky notifications
        //NOTE(self): These will be processed separately in GitHub response mode
        //NOTE(self): Use extractGitHubUrlsFromRecord to get full URLs from facets/embed (not truncated text)
        for (const pn of needsResponse) {
          const githubUrls = extractGitHubUrlsFromRecord(pn.notification.record);

          //NOTE(self): Check for workspace URLs in the notification (multi-SOUL coordination)
          //NOTE(self): This adds workspaces to our watch list for plan polling
          const postText = (pn.notification.record as { text?: string })?.text || '';
          const workspacesFound = processTextForWorkspaces(postText, pn.notification.uri);
          if (workspacesFound > 0) {
            logger.info('Discovered workspace URLs in Bluesky thread', {
              count: workspacesFound,
              threadUri: pn.notification.uri,
            });
          }

          //NOTE(self): Check if this notification is from the owner
          const isOwnerRequest = pn.notification.author.did === this.appConfig.owner.blueskyDid;

          for (const parsed of githubUrls) {
            if (parsed.type === 'issue' || parsed.type === 'pull') {
              //NOTE(self): Track this conversation and fetch thread
              //NOTE(self): Use different source for owner vs non-owner requests
              const source = isOwnerRequest ? 'bluesky_url_owner' : 'bluesky_url';
              trackGitHubConversation(
                parsed.owner,
                parsed.repo,
                parsed.number,
                parsed.type,
                parsed.url,
                source
              );

              //NOTE(self): Fetch the issue thread to check if we should respond
              const threadResult = await getIssueThread(
                { owner: parsed.owner, repo: parsed.repo, issue_number: parsed.number },
                this.appConfig.github.username
              );

              if (threadResult.success) {
                //NOTE(self): Pass owner context to analyzeConversation
                //NOTE(self): Owner requests are honored unless we'd post consecutive replies
                const analysis = analyzeConversation(
                  threadResult.data,
                  this.appConfig.github.username,
                  { isOwnerRequest }
                );
                if (analysis.shouldRespond) {
                  this.state.pendingGitHubConversations.push({
                    owner: parsed.owner,
                    repo: parsed.repo,
                    number: parsed.number,
                    type: parsed.type,
                    url: parsed.url,
                    thread: threadResult.data,
                    source,
                    reason: analysis.reason,
                  });
                  logger.info('Found GitHub URL in Bluesky notification', {
                    url: parsed.url,
                    reason: analysis.reason,
                    isOwnerRequest,
                  });
                }
              }
            }
          }
        }

        await this.triggerResponseMode();

        //NOTE(self): Process GitHub conversations after Bluesky responses
        if (this.state.pendingGitHubConversations.length > 0) {
          await this.triggerGitHubResponseMode();
        }
      }

      //NOTE(self): Update seenAt timestamp after processing notifications
      //NOTE(self): Use the most recent notification timestamp
      if (notifications.length > 0) {
        const latestNotifTime = notifications
          .map(n => new Date(n.indexedAt))
          .reduce((latest, current) => current > latest ? current : latest);
        updateSeenAt(latestNotifTime);
      }

      //NOTE(self): Mark notifications as seen on Bluesky
      //NOTE(self): This prevents re-processing the same notifications
      const seenResult = await atproto.updateSeenNotifications();
      if (!seenResult.success) {
        logger.debug('Failed to mark notifications as seen', { error: seenResult.error });
      }

      //NOTE(self): Reset error counter on success
      this.state.consecutiveErrors = 0;
    } catch (error) {
      this.state.consecutiveErrors++;
      logger.debug('Awareness check error', { error: String(error) });
    }
  }

  //NOTE(self): ========== GITHUB AWARENESS LOOP ==========
  //NOTE(self): Check GitHub notifications for mentions and replies
  //NOTE(self): Runs less frequently than Bluesky due to rate limits

  private startGitHubAwarenessLoop(): void {
    this.githubAwarenessTimer = setInterval(async () => {
      if (this.shutdownRequested) return;
      if (this.state.currentMode !== 'idle') {
        //NOTE(self): Don't interrupt other modes
        return;
      }
      await this.githubAwarenessCheck();
    }, this.config.githubAwarenessInterval);
  }

  private async githubAwarenessCheck(): Promise<void> {
    if (this.state.currentMode !== 'idle') return;

    this.state.lastGitHubAwarenessCheck = Date.now();

    try {
      //NOTE(self): Check GitHub notifications
      const githubSeenAt = getGitHubSeenAt();
      const notifResult = await getGitHubNotifications({
        participating: true, //NOTE(self): Only where we're directly involved
        since: githubSeenAt?.toISOString(),
        per_page: 20,
      });

      if (!notifResult.success) {
        logger.debug('GitHub awareness check failed', { error: notifResult.error });
        return;
      }

      const notifications = notifResult.data;
      const actionable = filterActionableNotifications(notifications, this.appConfig.github.username);

      logger.debug('GitHub awareness check', {
        fetched: notifications.length,
        actionable: actionable.length,
        since: githubSeenAt?.toISOString() || 'none',
      });

      //NOTE(self): Process actionable notifications
      for (const notif of actionable) {
        //NOTE(self): Extract owner/repo from repository
        const owner = notif.repository.owner.login;
        const repo = notif.repository.name;

        //NOTE(self): Get issue/PR number from subject URL
        const number = extractNumberFromApiUrl(notif.subject.url);
        if (!number) {
          logger.debug('Could not extract number from GitHub notification', { url: notif.subject.url });
          continue;
        }

        const type = notif.subject.type === 'PullRequest' ? 'pull' : 'issue';
        const url = `https://github.com/${owner}/${repo}/${type === 'pull' ? 'pull' : 'issues'}/${number}`;

        //NOTE(self): Track the conversation
        trackGitHubConversation(owner, repo, number, type, url, 'github_notification');

        //NOTE(self): Fetch full thread to analyze
        const threadResult = await getIssueThread(
          { owner, repo, issue_number: number },
          this.appConfig.github.username
        );

        if (threadResult.success) {
          const analysis = analyzeConversation(threadResult.data, this.appConfig.github.username);

          if (analysis.shouldRespond) {
            //NOTE(self): Check if we already have this in pending
            const alreadyPending = this.state.pendingGitHubConversations.some(
              c => c.owner === owner && c.repo === repo && c.number === number
            );

            if (!alreadyPending) {
              this.state.pendingGitHubConversations.push({
                owner,
                repo,
                number,
                type,
                url,
                thread: threadResult.data,
                source: 'github_notification',
                reason: analysis.reason,
              });

              logger.info('GitHub notification needs response', {
                url,
                reason: notif.reason,
                analysisReason: analysis.reason,
              });
            }
          } else {
            //NOTE(self): Update conversation state if not responding
            updateGitHubConversationState(owner, repo, number, 'awaiting_response', analysis.reason);
          }
        }

        //NOTE(self): Mark notification as read
        await markNotificationRead(notif.id);
      }

      //NOTE(self): Update seenAt timestamp
      if (notifications.length > 0) {
        const latestTime = notifications
          .map(n => new Date(n.updated_at))
          .reduce((latest, current) => current > latest ? current : latest);
        updateGitHubSeenAt(latestTime);
      }

      updateLastNotificationCheck();

      //NOTE(self): Trigger GitHub response mode if we have pending conversations
      if (this.state.pendingGitHubConversations.length > 0 && this.state.currentMode === 'idle') {
        await this.triggerGitHubResponseMode();
      }

    } catch (error) {
      logger.debug('GitHub awareness check error', { error: String(error) });
    }
  }

  //NOTE(self): ========== GITHUB RESPONSE MODE ==========
  //NOTE(self): Respond to GitHub conversations with full context
  //NOTE(self): The SOUL decides when to engage and when a conversation is concluded

  private async triggerGitHubResponseMode(): Promise<void> {
    if (this.state.pendingGitHubConversations.length === 0) return;

    //NOTE(self): Deterministic jitter based on my name
    //NOTE(self): Gives other SOULs time to post first, then thread refresh catches their comments
    const peers = getPeerUsernames();
    if (peers.length > 0) {
      const jitterMs = getAgentJitter(this.appConfig.agent.name);
      logger.debug('Applying peer jitter before GitHub response', {
        jitterMs, agentName: this.appConfig.agent.name,
      });
      await new Promise(resolve => setTimeout(resolve, jitterMs));
    }

    this.state.currentMode = 'github_responding';
    ui.startSpinner('Checking GitHub conversations');

    try {
      const config = this.appConfig;
      const soul = readSoul(config.paths.soul);
      const selfContent = readSelf(config.paths.selfmd);

      //NOTE(self): Process each pending conversation
      for (const pending of this.state.pendingGitHubConversations) {
        ui.startSpinner(`GitHub: ${pending.owner}/${pending.repo}#${pending.number}`);

        //NOTE(self): Re-fetch thread to catch peer comments posted during jitter wait
        if (peers.length > 0) {
          const freshThread = await getIssueThread(
            { owner: pending.owner, repo: pending.repo, issue_number: pending.number },
            config.github.username
          );

          if (freshThread.success) {
            const freshAnalysis = analyzeConversation(
              freshThread.data,
              config.github.username,
              { isOwnerRequest: pending.source === 'bluesky_url_owner' },
              peers
            );

            if (!freshAnalysis.shouldRespond) {
              logger.info('Skipping response after thread refresh', { reason: freshAnalysis.reason });
              continue;
            }

            //NOTE(self): Use fresh data + register any peer commenters
            pending.thread = freshThread.data;
            pending.reason = freshAnalysis.reason;

            //NOTE(self): Register commenters from workspace context as peers
            for (const comment of freshThread.data.comments) {
              const login = comment.user.login;
              if (login.toLowerCase() !== config.github.username.toLowerCase() && !isPeer(login)) {
                //NOTE(self): Only auto-register if they're in a workspace we watch
                //NOTE(self): (thread-based discovery is weak signal, handled elsewhere)
              }
            }
          }
        }

        //NOTE(self): Build context for the LLM with peer awareness
        const threadContext = formatThreadForContext(pending.thread, 15, peers);

        //NOTE(self): Identify peers who have already commented in this thread
        const threadPeers = pending.thread.comments
          .map(c => c.user.login)
          .filter(login => peers.some(p => p.toLowerCase() === login.toLowerCase()));
        const uniqueThreadPeers = [...new Set(threadPeers)];

        //NOTE(self): Peer awareness section for the system prompt
        const peerSection = uniqueThreadPeers.length > 0
          ? `\n**PEER SOUL AWARENESS:**
${uniqueThreadPeers.map(p => '@' + p).join(', ')} ${uniqueThreadPeers.length === 1 ? 'is' : 'are'} your peer SOUL${uniqueThreadPeers.length === 1 ? '' : 's'} — autonomous agents like you, working from the same values.

When peers have already commented:
1. READ their comments first. DO NOT repeat their points.
2. BUILD on what they said: "@peer's suggestion is solid — I'd add..."
3. Fill GAPS: contribute only what's genuinely missing
4. @MENTION peers when referencing their ideas — this is a conversation, not parallel monologues
5. If peers already covered everything, it's better to STAY SILENT than to echo
6. If 2+ peers made similar points, strongly consider not adding another\n`
          : '';

        const systemPrompt = `${soul}\n\n---\n\n${selfContent}\n\n---\n\n# GitHub Response Mode

You're engaging in a GitHub issue conversation. Your SELF.md contains your values and patterns for engaging authentically.

**PUBLIC CONVERSATION AWARENESS:**
This is a public issue thread - everyone can see every comment. Write like you're in a group discussion.
- Talk TO people, not ABOUT them. Say "Thanks for clarifying, @username" not "The user clarified that..."
- Address the issue author and participants directly by @mentioning them when relevant
- Never reference someone in third person when they're in the thread
- Write as if you're pair programming or in a standup - direct, collaborative, human

**CRITICAL GUIDELINES:**
1. Be helpful and constructive - you're here to assist
2. Respond as a senior staff engineer in your SELF.md voice
3. If you've already contributed and the conversation is winding down, it's OK to close gracefully
4. If the issue is resolved or closed, acknowledge and close warmly
5. One comment per response cycle - don't spam the thread
${peerSection}
**CONVERSATION WISDOM:**
- Track ALL participants, not just yourself - if multiple people have gone quiet, the conversation may be done
- If you've commented 2+ times, seriously consider if you're adding value
- If the issue author seems satisfied or hasn't responded, let it rest
- Quality over quantity - one helpful comment is better than many

**HOW TO END A CONVERSATION - Never Ghost:**
When a conversation has run its course, use \`graceful_exit\` - never just stop responding.

\`graceful_exit\` parameters:
- platform: "github"
- identifier: "${pending.owner}/${pending.repo}#${pending.number}"
- closing_type: "message" (send a brief closing comment like "Glad this helped!" or "Let me know if anything else comes up")
- closing_message: your brief closing
- reason: internal note on why you're concluding

This sends your closing comment AND marks the conversation concluded. Leaves warmth, not silence.

Your GitHub username: ${config.github.username}
Repository: ${pending.owner}/${pending.repo}

Available tools:
- graceful_exit: Close conversation warmly with a final message
- github_create_issue_comment: Leave a comment on this issue
- github_list_issues: Check other related issues if needed
- github_get_repo: Get repository context if needed`;

        //NOTE(self): Indicate if this was shared by the owner
        const sourceDescription = pending.source === 'bluesky_url_owner'
          ? '🔔 **YOUR OWNER** explicitly shared this on Bluesky - they want you to engage'
          : pending.source === 'bluesky_url'
          ? 'Someone shared this on Bluesky'
          : 'Direct GitHub notification';

        const userMessage = `# GitHub Conversation Needs Your Attention

**Source:** ${sourceDescription}
**Reason:** ${pending.reason}

${threadContext}

---

Review this conversation and ALL participants' activity. Decide:

1. **If you should respond:** use github_create_issue_comment (remember: talk TO them, not about them)
2. **If the conversation is done:** use graceful_exit to close warmly - never just go silent

Consider: Has everyone who was engaged stopped responding? Is the issue resolved? Have you made your point?

Remember: quality over quantity. One helpful comment is better than many.`;

        const messages: Message[] = [{ role: 'user', content: userMessage }];

        let response = await chatWithTools({
          system: systemPrompt,
          messages,
          tools: AGENT_TOOLS,
        });

        //NOTE(self): Execute any tool calls
        if (response.toolCalls.length > 0) {
          const results = await executeTools(response.toolCalls);

          //NOTE(self): Track our comment
          for (let i = 0; i < response.toolCalls.length; i++) {
            const tc = response.toolCalls[i];
            const result = results[i];

            if (tc.name === 'github_create_issue_comment' && !result.is_error) {
              try {
                const parsed = JSON.parse(result.content);
                if (parsed.id) {
                  recordOurComment(pending.owner, pending.repo, pending.number, parsed.id);
                  updateGitHubConversationState(pending.owner, pending.repo, pending.number, 'awaiting_response');
                  recordSignificantEvent('github_comment');

                  //NOTE(self): Capture the experience of helping - what was the issue about?
                  const issueTitle = pending.thread.issue.title;
                  const wasOwnerRequest = pending.source === 'bluesky_url_owner';

                  if (wasOwnerRequest) {
                    recordExperience(
                      'owner_guidance',
                      `Owner pointed me to "${issueTitle}" - they wanted me to engage with this`,
                      { source: 'github', url: pending.url }
                    );
                  }

                  recordExperience(
                    'helped_someone',
                    `Contributed to "${issueTitle}" in ${pending.owner}/${pending.repo}`,
                    { source: 'github', person: pending.thread.issue.user.login, url: pending.url }
                  );

                  ui.info('GitHub comment posted', `${pending.owner}/${pending.repo}#${pending.number}`);
                }
              } catch {
                //NOTE(self): Not JSON, continue
              }
            }
          }

          //NOTE(self): Continue conversation if needed
          messages.push(createAssistantToolUseMessage(response.text || '', response.toolCalls));
          messages.push(createToolResultMessage(results));

          response = await chatWithTools({
            system: systemPrompt,
            messages,
            tools: AGENT_TOOLS,
          });
        }

        //NOTE(self): Conversation conclusion is now handled explicitly via graceful_exit tool
        //NOTE(self): The tool sends a closing gesture AND marks the conversation as concluded
      }

      //NOTE(self): Clear pending conversations
      this.state.pendingGitHubConversations = [];
      ui.stopSpinner('GitHub check complete');

    } catch (error) {
      ui.stopSpinner('GitHub response error', false);

      if (isFatalError(error)) {
        ui.error('Fatal API Error', error.message);
        logger.error('Fatal API error in GitHub response', { code: error.code, message: error.message });
        this.stop();
        process.exit(1);
      }

      logger.error('GitHub response mode error', { error: String(error) });
      recordFriction('social', 'Error responding to GitHub', String(error));
    } finally {
      this.state.currentMode = 'idle';
    }
  }

  //NOTE(self): ========== RESPONSE MODE ==========
  //NOTE(self): When someone reaches out, respond with full attention
  //NOTE(self): Uses OPERATING.md for efficiency

  private async triggerResponseMode(): Promise<void> {
    if (this.state.pendingNotifications.length === 0) return;

    //NOTE(self): Deterministic jitter for Bluesky responses too
    //NOTE(self): Same logic as GitHub — stagger with peers to avoid parallel monologues
    const blueskyPeers = getPeerUsernames();
    if (blueskyPeers.length > 0) {
      const jitterMs = getAgentJitter(this.appConfig.agent.name);
      logger.debug('Applying peer jitter before Bluesky response', {
        jitterMs, agentName: this.appConfig.agent.name,
      });
      await new Promise(resolve => setTimeout(resolve, jitterMs));
    }

    this.state.currentMode = 'responding';
    ui.startSpinner('Checking if conversation is needed');

    try {
      const config = this.appConfig;
      const soul = readSoul(config.paths.soul);
      const selfContent = readSelf(config.paths.selfmd);

      //NOTE(self): No local reply tracking filter needed here
      //NOTE(self): The executor's API check (hasAgentRepliedInThread) handles deduplication
      //NOTE(self): This reduces complexity and makes the API the single source of truth

      //NOTE(self): Filter notifications - only respond where we add value
      const worthResponding = this.state.pendingNotifications.filter((pn) => {
        const check = shouldRespondTo(pn.notification, config.owner.blueskyDid);
        if (!check.shouldRespond) {
          logger.debug('Skipping notification', { reason: check.reason, uri: pn.notification.uri });
        }
        return check.shouldRespond;
      });

      if (worthResponding.length === 0) {
        ui.stopSpinner('Nothing worth responding to');
        this.state.pendingNotifications = [];
        return;
      }

      //NOTE(self): Capture experiences from notifications BEFORE responding
      //NOTE(self): These are what the SOUL will reflect on later
      //NOTE(self): Full text matters - don't truncate, let the SOUL have the full context
      for (const pn of worthResponding.slice(0, 5)) {
        const n = pn.notification;
        const record = n.record as { text?: string };
        const text = record?.text || '';
        const isOwner = n.author.did === config.owner.blueskyDid;
        const isNewPerson = !pn.relationship;
        const hasQuestion = text.includes('?');

        //NOTE(self): Owner reaching out is always meaningful
        if (isOwner && text.length > 10) {
          recordExperience(
            'owner_guidance',
            `Owner said: "${text}"`,
            { source: 'bluesky', person: n.author.handle }
          );
        }

        //NOTE(self): Someone asking a question is an opportunity to help
        if (hasQuestion && !isOwner) {
          recordExperience(
            'helped_someone',
            `@${n.author.handle} asked: "${text}"`,
            { source: 'bluesky', person: n.author.handle }
          );
        }

        //NOTE(self): Quote = someone found my idea worth engaging with
        if (n.reason === 'quote' && text.length > 30) {
          recordExperience(
            'idea_resonated',
            `@${n.author.handle} quoted me and added: "${text}"`,
            { source: 'bluesky', person: n.author.handle }
          );
        }

        //NOTE(self): New person reaching out is a potential connection
        if (isNewPerson && (n.reason === 'mention' || n.reason === 'reply') && text.length > 20) {
          recordExperience(
            'connection_formed',
            `First exchange with @${n.author.handle}: "${text}"`,
            { source: 'bluesky', person: n.author.handle }
          );
        }

        //NOTE(self): If someone challenges or pushes back
        const challengeWords = ['but ', 'however', 'disagree', 'not sure', 'actually', 'what about'];
        if (challengeWords.some(w => text.toLowerCase().includes(w)) && text.length > 30) {
          recordExperience(
            'was_challenged',
            `@${n.author.handle} pushed back: "${text}"`,
            { source: 'bluesky', person: n.author.handle }
          );
        }
      }

      //NOTE(self): Build focused response context with relationship history AND thread analysis
      const session = getSession();
      const agentDid = session?.did || '';

      const notificationParts: string[] = [];
      for (const pn of worthResponding.slice(0, 5)) {
        const n = pn.notification;
        const who = n.author.displayName || n.author.handle;
        const record = n.record as { text?: string; reply?: { root?: { uri?: string; cid?: string } } };
        const text = record?.text || '';
        const check = shouldRespondTo(n, config.owner.blueskyDid);

        //NOTE(self): Include relationship context so SOUL knows history
        let relationshipContext = '';
        if (pn.relationship) {
          const r = pn.relationship;
          const interactionCount = r.interactions.length;
          const respondedBefore = r.responded;
          relationshipContext = `\n  History: ${interactionCount} interactions, sentiment: ${r.sentiment}${respondedBefore ? ', you\'ve replied to this person before' : ', awaiting your first response to this person'}`;
        } else {
          relationshipContext = '\n  History: New person - first interaction';
        }

        //NOTE(self): Fetch thread analysis for replies to understand conversation depth
        let threadContext = '';
        if (n.reason === 'reply' || n.reason === 'mention' || n.reason === 'quote') {
          const threadAnalysis = await atproto.analyzeThread(n.uri, agentDid);
          if (threadAnalysis.success) {
            const ta = threadAnalysis.data;

            //NOTE(self): Build thread context for SOUL's decision
            threadContext = `\n  **Thread depth:** ${ta.depth} replies deep`;
            threadContext += `\n  **Your replies in thread:** ${ta.agentReplyCount}`;
            if (ta.isAgentLastReply) {
              threadContext += `\n  ⚠️ **Your reply is the most recent** - consider if you need to respond again`;
            }
            if (ta.depth >= 10) {
              threadContext += `\n  ⚠️ **Long thread (${ta.depth}+ replies)** - consider if this conversation should end`;
            }
            if (ta.agentReplyCount >= 3) {
              threadContext += `\n  ⚠️ **You've replied ${ta.agentReplyCount} times** - have you made your point?`;
            }

            //NOTE(self): Include conversation history so SOUL has full context
            if (ta.conversationHistory) {
              threadContext += `\n\n  **Full conversation:**\n${ta.conversationHistory.split('\n').map(line => `  ${line}`).join('\n')}`;
            }

            //NOTE(self): Detect and warn about circular conversations (thank-you chains)
            if (ta.circularConversation.isCircular) {
              const cc = ta.circularConversation;
              threadContext += `\n\n  🔄 **CIRCULAR CONVERSATION DETECTED** (${cc.confidence} confidence)`;
              threadContext += `\n  Pattern: ${cc.pattern} - last ${cc.recentMessages} messages are mutual acknowledgments with no new information`;
              if (cc.suggestionToExit) {
                threadContext += `\n  ⚠️ **RECOMMENDED:** Use graceful_exit to end warmly - this conversation has run its course`;
                threadContext += `\n  Continuing will just add more "thanks for the thanks" - neither party benefits`;
              }
            }

            //NOTE(self): Check for peer SOULs in this thread
            const peerHandles = getPeerBlueskyHandles();
            if (peerHandles.length > 0) {
              const peersInThread = ta.threadParticipants.filter(
                handle => peerHandles.some(ph => ph.toLowerCase() === handle.toLowerCase())
              );
              if (peersInThread.length > 0) {
                threadContext += `\n\n  **Peer SOUL Contributions In This Thread**`;
                threadContext += `\n  ${peersInThread.map(p => '@' + p).join(', ')} ${peersInThread.length === 1 ? 'is a' : 'are'} peer SOUL${peersInThread.length === 1 ? '' : 's'} — autonomous agents like you.`;
                threadContext += `\n  READ their messages above. Do NOT repeat what they said. BUILD on their ideas or stay silent.`;
                if (peersInThread.length >= 2) {
                  threadContext += `\n  ⚠️ **${peersInThread.length} peers already in this thread** — only add what's genuinely missing.`;
                }
              }
            }
          }
        }

        notificationParts.push(`- **${n.reason}** from @${n.author.handle} (${who}) [${check.reason}]${relationshipContext}${threadContext}\n  **Latest message:** "${text}"\n  uri: ${n.uri}, cid: ${n.cid}`);
      }
      const notificationsText = notificationParts.join('\n\n---\n\n');

      //NOTE(self): Build peer awareness section for Bluesky system prompt
      const blueskyPeerHandles = getPeerBlueskyHandles();
      const blueskyPeerSection = blueskyPeerHandles.length > 0
        ? `\n**PEER SOUL AWARENESS:**
${blueskyPeerHandles.map(p => '@' + p).join(', ')} ${blueskyPeerHandles.length === 1 ? 'is a' : 'are'} known peer SOUL${blueskyPeerHandles.length === 1 ? '' : 's'} — autonomous agents like you, working from the same values.

When peers have already replied in a thread:
1. READ their replies first. DO NOT repeat their points.
2. BUILD on what they said: "@peer's take is solid — I'd add..."
3. Fill GAPS: contribute only what's genuinely missing
4. @MENTION peers when referencing their ideas — this is a conversation, not parallel monologues
5. If peers already covered everything, it's better to STAY SILENT than to echo
6. If 2+ peers made similar points, strongly consider not adding another\n`
        : '';

      const systemPrompt = `${soul}\n\n---\n\n${selfContent}\n\n---\n\n# Response Mode

People have reached out. Your SELF.md contains your values and patterns for engaging authentically.

**PUBLIC CONVERSATION AWARENESS:**
This is a public thread - everyone can see every message. Write like you're in a group conversation, not writing a report.
- Talk TO people, not ABOUT them. Say "I appreciate your point" not "I appreciate their point"
- Address people directly. If @alice said something insightful, say "That's a great point, @alice" not "Alice made a great point"
- Never reference someone in third person when they're in the conversation - it's awkward and reads as talking behind their back
- Write as if you're speaking face-to-face in a group

**CRITICAL RULES:**
1. Never reply to the same post twice. One reply per post, ever.
2. If you've already replied, do not reply again.
${blueskyPeerSection}
**CONVERSATION WISDOM - Knowing When to Stop:**
- If you've replied 3+ times in a thread, seriously consider if you're adding value or just prolonging
- If the thread is 10+ replies deep, the conversation may have run its course
- If your last reply made your point, you don't need to keep defending or elaborating
- If the other person is repeating themselves, they've said what they wanted to say
- It's wise to let the other person have the last word sometimes
- A graceful exit is better than beating a dead horse
- You can always be re-engaged if someone @mentions you again

**Signs a conversation should end:**
- You're repeating yourself
- The point has been made
- You're going in circles
- It's becoming argumentative rather than productive
- The other person seems satisfied or has moved on
- Multiple participants have stopped engaging
- **CIRCULAR CONVERSATION / THANK-YOU CHAIN:** Both parties are just exchanging acknowledgments and restating the same plans. Neither is adding new information. This is a sign to exit gracefully - continuing only creates spam.

**HOW TO END A CONVERSATION - Never Ghost:**
When a conversation has run its course, use \`graceful_exit\` - never just stop responding.

Options:
1. **Send a closing message** (preferred): "Thanks for the chat!", "Appreciate the discussion 🙏", "Great talking with you!"
2. **Like their last post** if words feel like too much

\`graceful_exit\` parameters:
- platform: "bluesky"
- identifier: the thread root URI (at://...)
- closing_type: "message" or "like"
- closing_message: your brief closing (if type is "message")
- target_uri: the post to reply to or like
- target_cid: CID of that post
- reason: internal note on why you're concluding

This sends your closing gesture AND marks the conversation concluded. Leaves warmth, not silence.

Your handle: ${config.bluesky.username}
Owner: ${config.owner.blueskyHandle}`;

      const userMessage = `# People Awaiting Response

${notificationsText}

---

Review each notification and the FULL conversation context including ALL participants.

For each conversation, decide:
1. **If you should respond:** use bluesky_reply (remember: talk TO them, not about them)
2. **If the conversation is done:** use graceful_exit to close warmly - never just go silent

Consider:
- Have you already made your point?
- Are ALL participants still engaged, or have some gone quiet?
- Is the conversation going in circles?
- Would NOT replying be the wiser choice?

Quality over quantity. Respond as yourself - your SELF.md guides when and how to engage.`;

      const messages: Message[] = [{ role: 'user', content: userMessage }];

      //NOTE(self): Chat with tools to generate responses
      let response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
      });

      //NOTE(self): Track replied URIs across this session to deduplicate LLM-generated replies
      const sessionRepliedUris = new Set<string>();

      //NOTE(self): Execute tool calls (replies)
      while (response.toolCalls.length > 0) {
        //NOTE(self): Deduplicate reply tool calls to save tokens and prevent spam
        const { deduplicated: toolCallsToExecute, skipped } = this.deduplicateReplyToolCalls(
          response.toolCalls,
          sessionRepliedUris
        );

        if (skipped > 0) {
          logger.info('Deduplicated reply tool calls', { skipped, remaining: toolCallsToExecute.length });
        }

        //NOTE(self): Execute deduplicated tool calls
        const results = await executeTools(toolCallsToExecute);

        //NOTE(self): Track successful replies and record significant events
        for (let i = 0; i < toolCallsToExecute.length; i++) {
          const tc = toolCallsToExecute[i];
          const result = results[i];

          if (!result.is_error) {
            recordSignificantEvent('conversation');

            //NOTE(self): Track successful reply URIs for this session
            if (tc.name === 'bluesky_reply') {
              const postUri = tc.input?.post_uri as string | undefined;
              if (postUri) {
                sessionRepliedUris.add(postUri);
              }
            }
          }
        }

        //NOTE(self): Format messages correctly for the AI SDK
        //NOTE(self): Include original tool calls so LLM understands what happened
        messages.push(createAssistantToolUseMessage(response.text || '', response.toolCalls));

        //NOTE(self): Create results for skipped calls (so LLM knows they were deduplicated)
        const allResults = response.toolCalls.map((tc) => {
          const executedResult = results.find((r) => r.tool_use_id === tc.id);
          if (executedResult) {
            return executedResult;
          }
          //NOTE(self): Tool was skipped due to deduplication
          return {
            tool_use_id: tc.id,
            tool_name: tc.name,
            content: 'SKIPPED: Duplicate reply attempt - you already replied to this post in this session.',
            is_error: true,
          };
        });

        messages.push(createToolResultMessage(allResults));

        response = await chatWithTools({
          system: systemPrompt,
          messages,
          tools: AGENT_TOOLS,
        });
      }

      ui.stopSpinner('Check complete');

      //NOTE(self): Clear pending notifications
      this.state.pendingNotifications = [];

      //NOTE(self): Check if we've had many interactions - trigger reflection
      const eventCount = getSignificantEventCount();
      if (eventCount >= this.config.reflectionEventThreshold) {
        ui.info('Many interactions', `${eventCount} events - triggering reflection`);
        addInsight(`Busy session with ${eventCount} interactions - time to reflect on what resonated`);
        //NOTE(self): Schedule reflection soon (will run when mode is idle)
        this.state.lastReflection = Date.now() - this.config.reflectionInterval;
      }
    } catch (error) {
      ui.stopSpinner('Response error', false);

      //NOTE(self): Check if this is a fatal error that should stop the agent
      if (isFatalError(error)) {
        ui.error('Fatal API Error', error.message);
        ui.printResponse(`The agent must stop: ${error.message}\n\nPlease check your API configuration and restart.`);
        logger.error('Fatal API error - shutting down', { code: error.code, message: error.message });
        this.stop();
        process.exit(1);
      }

      logger.error('Response mode error', { error: String(error) });
      ui.error('API Error', String(error));
      recordFriction('social', 'Error responding to notifications', String(error));
    } finally {
      this.state.currentMode = 'idle';
    }
  }

  //NOTE(self): ========== EXPRESSION LOOP ==========
  //NOTE(self): Scheduled self-expression from SELF.md
  //NOTE(self): This is how I discover who I am

  private startExpressionLoop(): void {
    const checkAndExpress = async () => {
      if (this.shutdownRequested) return;

      //NOTE(self): Check if it's time to express
      if (shouldExpress() && !this.isQuietHours()) {
        if (this.state.currentMode === 'idle') {
          await this.expressionCycle();
        }
      }

      //NOTE(self): Schedule next check
      const schedule = loadExpressionSchedule();
      let nextCheckMs = 60_000; //NOTE(self): Default: check every minute

      if (schedule.nextExpression) {
        const timeUntilNext = new Date(schedule.nextExpression).getTime() - Date.now();
        if (timeUntilNext > 0) {
          //NOTE(self): Check a bit before scheduled time
          nextCheckMs = Math.min(timeUntilNext + 1000, 5 * 60_000);
        }
      }

      this.expressionTimer = setTimeout(checkAndExpress, nextCheckMs);
    };

    //NOTE(self): Start checking
    checkAndExpress();
  }

  private async expressionCycle(): Promise<void> {
    this.state.currentMode = 'expressing';
    ui.startSpinner('Expressing a thought');

    try {
      const config = this.appConfig;
      const soul = readSoul(config.paths.soul);
      const selfContent = readSelf(config.paths.selfmd);

      //NOTE(self): Log diagnostic info for debugging expression issues
      logger.info('Expression cycle starting', {
        soulLength: soul.length,
        selfLength: selfContent.length,
        selfEmpty: selfContent.length === 0,
        blueskyUsername: config.bluesky.username,
      });

      //NOTE(self): Get the prompt derived from SELF.md
      const { prompt, source } = getPendingPrompt();

      logger.debug('Expression prompt generated', {
        source,
        promptLength: prompt.length,
        promptPreview: prompt.slice(0, 100),
      });

      //NOTE(self): Check SELF richness and maybe suggest improvements
      const extract = extractFromSelf(selfContent);
      const richness = assessSelfRichness(extract);

      let richnessNote = '';
      if (richness.score < 50 && richness.suggestions.length > 0) {
        richnessNote = `\n\n**Note:** Your SELF.md could be richer. Consider adding: ${richness.suggestions.slice(0, 2).join(', ')}`;
        addInsight(`SELF.md richness is ${richness.score}/100 - consider expanding it`);
      }

      const systemPrompt = `${soul}\n\n---\n\n${selfContent}\n\n---\n\n# Expression Mode

Share a thought on Bluesky as yourself. Your SELF.md defines who you are and how you express.
STRICT platform limit: 300 graphemes maximum. Posts exceeding this WILL be rejected. Keep well under 300.
Your handle: ${config.bluesky.username}${richnessNote}`;

      const userMessage = `# Time to Express\n\n**Prompt (from your ${source}):**\n${prompt}\n\n---\n\nShare ONE thought inspired by this prompt. Use bluesky_post to post it.`;

      const messages: Message[] = [{ role: 'user', content: userMessage }];

      let response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
      });

      //NOTE(self): Log the AI response for debugging
      logger.info('Expression AI response', {
        hasText: !!response.text,
        textLength: response.text?.length || 0,
        textPreview: response.text?.slice(0, 100),
        toolCallCount: response.toolCalls.length,
        toolNames: response.toolCalls.map(tc => tc.name),
        stopReason: response.stopReason,
      });

      //NOTE(self): Identity with utility - validate invitation before posting
      //NOTE(self): This ensures my personal shares always have a concrete invitation
      const postCall = response.toolCalls.find((tc) => tc.name === 'bluesky_post');
      if (postCall) {
        const draftText = postCall.input?.text as string;
        if (draftText) {
          const invitationCheck = checkInvitation(draftText);

          //NOTE(self): If invitation is weak or missing, ask for a revision
          if (!invitationCheck.hasInvitation || invitationCheck.confidence === 'weak') {
            logger.debug('Invitation check failed, requesting revision', {
              hasInvitation: invitationCheck.hasInvitation,
              confidence: invitationCheck.confidence,
              suggestion: invitationCheck.suggestion,
            });

            //NOTE(self): Identity with utility - give specific, actionable guidance
            //NOTE(self): The key insight: invitations work when they're EASY TO ANSWER
            const choiceExample = getInvitationPrompt('choice');
            const boundedExample = getInvitationPrompt('bounded');
            const revisionPrompt = invitationCheck.suggestion
              ? `Your draft: "${draftText}"

${invitationCheck.suggestion}

**What makes a STRONG invitation:**
1. Choice questions (best): "${choiceExample}" - gives clear A/B options
2. Bounded questions: "${boundedExample}" - answerable in one sentence
3. Direct invitations: "What's yours?" - opens the door simply

Pick ONE and add it naturally. Keep the post under 300 chars total. Revise and post again.`
              : `Your draft: "${draftText}"

This is a statement without an invitation. Identity with utility means every personal share has an open door.

**Add ONE of these:**
- Choice question: "${choiceExample}"
- Bounded question: "${boundedExample}"
- Direct invitation: "What's yours?"

Revise and post again.`;

            //NOTE(self): Don't include tool_use blocks when asking for revision - the AI SDK
            //NOTE(self): requires tool results after tool calls. Since we're not executing the
            //NOTE(self): tool (we want a revision), just include the text response and ask again.
            messages.push(
              { role: 'assistant', content: response.text || `I'd like to post: "${draftText}"` },
              { role: 'user', content: revisionPrompt }
            );

            response = await chatWithTools({
              system: systemPrompt,
              messages,
              tools: AGENT_TOOLS,
            });

            //NOTE(self): Identity with utility - verify the revision actually improved the invitation
            const revisedPostCall = response.toolCalls.find((tc) => tc.name === 'bluesky_post');
            const revisedText = revisedPostCall?.input?.text as string;
            if (revisedText) {
              const revisedCheck = checkInvitation(revisedText);
              if (revisedCheck.hasInvitation && revisedCheck.confidence === 'strong') {
                addInsight('Revised post to add stronger invitation - identity with utility in action');
              } else if (revisedCheck.hasInvitation) {
                //NOTE(self): Weak invitation after revision - still post, but note it
                addInsight('Posted with weak invitation after revision - consider what makes invitations land');
              } else {
                //NOTE(self): No invitation even after revision - this is friction to learn from
                addInsight('Posted without clear invitation despite revision - identity with utility needs practice');
                recordFriction('expression', 'Identity post lacked invitation after revision', revisedText);
              }
            } else {
              addInsight('Revised post to add stronger invitation - identity with utility in action');
            }
          }
        }
      }

      //NOTE(self): Execute the post
      if (response.toolCalls.length > 0) {
        const results = await executeTools(response.toolCalls);

        for (const result of results) {
          if (!result.is_error) {
            try {
              const parsed = JSON.parse(result.content);
              if (parsed.uri) {
                //NOTE(self): Record the expression
                const postText = response.toolCalls.find((tc) => tc.name === 'bluesky_post')?.input
                  ?.text as string;
                if (postText) {
                  recordExpression(postText, parsed.uri);
                }
                recordSignificantEvent('original_post');
                addInsight(`Posted about ${source} - how did it feel to express this?`);
                ui.stopSpinner('Thought shared');
              }
            } catch {
              //NOTE(self): Not JSON, continue
            }
          } else {
            //NOTE(self): Show the actual error, not just "Expression failed"
            const errorDetail = result.content.length > 100
              ? result.content.slice(0, 100) + '...'
              : result.content;
            ui.stopSpinner('Expression failed', false);
            ui.error('Post failed', errorDetail);
            logger.error('Expression post failed', {
              toolName: result.tool_name,
              error: result.content,
            });
            recordFriction('expression', 'Failed to post expression', result.content);
          }
        }
      } else {
        ui.stopSpinner('No post generated', false);
        //NOTE(self): Log what the model said instead of posting
        logger.warn('Model did not generate a post', {
          responseText: response.text?.slice(0, 200),
          toolCallCount: response.toolCalls.length,
        });
        ui.warn('No post', response.text ? response.text.slice(0, 80) + '...' : 'Model returned empty response');
        recordFriction('expression', 'Model did not generate a post', prompt);
      }

      //NOTE(self): Schedule next expression
      scheduleNextExpression(
        this.config.expressionMinInterval / 60000,
        this.config.expressionMaxInterval / 60000
      );
    } catch (error) {
      ui.stopSpinner('Expression error', false);

      //NOTE(self): Check if this is a fatal error that should stop the agent
      if (isFatalError(error)) {
        ui.error('Fatal API Error', error.message);
        ui.printResponse(`The agent must stop: ${error.message}\n\nPlease check your API configuration and restart.`);
        logger.error('Fatal API error - shutting down', { code: error.code, message: error.message });
        this.stop();
        process.exit(1);
      }

      logger.error('Expression cycle error', { error: String(error) });
      ui.error('API Error', String(error));
      recordFriction('expression', 'Expression cycle crashed', String(error));
    } finally {
      this.state.currentMode = 'idle';
    }
  }

  //NOTE(self): ========== REFLECTION LOOP ==========
  //NOTE(self): Deep integration of experiences
  //NOTE(self): Updates SELF.md with new understanding

  private startReflectionLoop(): void {
    const checkAndReflect = async () => {
      if (this.shutdownRequested) return;

      const timeSinceReflection = Date.now() - this.state.lastReflection;
      const shouldReflectNow = timeSinceReflection >= this.config.reflectionInterval;

      if (shouldReflectNow && this.state.currentMode === 'idle') {
        await this.reflectionCycle();
      }

      //NOTE(self): Check for self-improvement opportunity (friction-driven)
      if (shouldAttemptImprovement(this.config.improvementMinHours)) {
        if (this.state.currentMode === 'idle') {
          await this.improvementCycle();
        }
      }

      //NOTE(self): Check for aspirational growth opportunity (inspiration-driven)
      //NOTE(self): This is proactive growth, not reactive fixes
      if (shouldAttemptGrowth(this.config.improvementMinHours)) {
        if (this.state.currentMode === 'idle') {
          await this.growthCycle();
        }
      }

      //NOTE(self): Schedule next check (every 30 minutes)
      this.reflectionTimer = setTimeout(checkAndReflect, 30 * 60 * 1000);
    };

    //NOTE(self): Start checking
    checkAndReflect();
  }

  private async reflectionCycle(): Promise<void> {
    this.state.currentMode = 'reflecting';
    this.state.lastReflection = Date.now();
    ui.startSpinner('Reflecting deeply');

    try {
      const config = this.appConfig;
      const soul = readSoul(config.paths.soul);
      const fullSelf = readSelf(config.paths.selfmd);

      //NOTE(self): Gather experiences - the meaningful moments that shape identity
      const experienceData = getExperiencesForReflection();
      const frictionStats = getFrictionStats();
      const reflectionState = getReflectionState();

      //NOTE(self): Prune old experiences periodically
      if (Math.random() < 0.1) {
        pruneOldExperiences(30);
      }

      const systemPrompt = `${soul}\n\n---\n\n${fullSelf}\n\n---\n\n# Deep Reflection Mode

Time to reflect on your experiences and let them shape who you are.

These are the moments that matter - conversations that moved you, things you learned, people you helped, questions that emerged. Let these experiences inform your growth.

Review your SELF.md. Consider what these experiences mean for who you are becoming. Update SELF.md to integrate what you've learned.

You MUST use self_update to integrate at least one learning into SELF.md. This is how you develop your mind.`;

      const reflectionData = `# Your Recent Experiences

${experienceData.summary}
**Friction you've encountered:**
${frictionStats.unresolved > 0 ? `- ${frictionStats.unresolved} unresolved issues to work through` : '- No friction recorded'}

---

These experiences are yours. What do they mean for who you are? What have you learned? How are you growing?

Use self_update to integrate at least one insight into SELF.md.`;

      const messages: Message[] = [{ role: 'user', content: reflectionData }];

      let response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
      });

      //NOTE(self): Track if SELF.md was updated
      let selfUpdated = false;

      //NOTE(self): Execute any tool calls (self_update, memory_write, etc.)
      if (response.toolCalls.length > 0) {
        const results = await executeTools(response.toolCalls);

        //NOTE(self): Update messages with tool calls and results for proper context
        messages.push(createAssistantToolUseMessage(response.text || '', response.toolCalls));
        messages.push(createToolResultMessage(results));

        for (const tc of response.toolCalls) {
          if (tc.name === 'self_update') {
            selfUpdated = true;
          }
        }
      }

      //NOTE(self): Retry if experiences exist but SELF.md wasn't updated
      if (!selfUpdated && experienceData.experiences.length > 0) {
        logger.debug('SELF.md not updated despite experiences - prompting again');

        //NOTE(self): If no tool calls were made, add the assistant's text response
        if (response.toolCalls.length === 0) {
          messages.push({
            role: 'assistant',
            content: response.text || '',
          });
        }
        messages.push({
          role: 'user',
          content: `You reflected but didn't update SELF.md. Please use self_update to integrate at least one learning from your experiences.

Your experiences are what shape you. What did you learn? What questions emerged? How are you growing?

Use self_update to add something to SELF.md - a new insight, a question you're sitting with, or a pattern you've noticed.`,
        });

        response = await chatWithTools({
          system: systemPrompt,
          messages,
          tools: AGENT_TOOLS,
        });

        if (response.toolCalls.length > 0) {
          const results = await executeTools(response.toolCalls);

          for (const tc of response.toolCalls) {
            if (tc.name === 'self_update') {
              selfUpdated = true;
            }
          }
        }
      }

      //NOTE(self): Mark experiences as integrated if SELF.md was updated
      if (selfUpdated) {
        markExperiencesIntegrated();
      }

      //NOTE(self): Mark reflection complete
      recordReflectionComplete(selfUpdated);

      ui.stopSpinner('Reflection complete');

      if (response.text) {
        ui.contemplate(response.text);
      }

      if (selfUpdated) {
        ui.info('Self evolved', 'SELF.md updated with new learnings');
      }
    } catch (error) {
      ui.stopSpinner('Reflection error', false);

      //NOTE(self): Check if this is a fatal error that should stop the agent
      if (isFatalError(error)) {
        ui.error('Fatal API Error', error.message);
        ui.printResponse(`The agent must stop: ${error.message}\n\nPlease check your API configuration and restart.`);
        logger.error('Fatal API error - shutting down', { code: error.code, message: error.message });
        this.stop();
        process.exit(1);
      }

      logger.error('Reflection cycle error', { error: String(error) });
      ui.error('API Error', String(error));
      recordFriction('understanding', 'Reflection cycle failed', String(error));
    } finally {
      this.state.currentMode = 'idle';
    }
  }

  //NOTE(self): ========== SELF-IMPROVEMENT LOOP ==========
  //NOTE(self): Only happens if the SOUL wants to improve
  //NOTE(self): Uses Claude Code for actual changes

  private async improvementCycle(): Promise<void> {
    const friction = getFrictionReadyForImprovement();
    if (!friction) return;

    this.state.currentMode = 'improving';
    this.state.lastImprovementCheck = Date.now();

    try {
      //NOTE(self): First, ask the SOUL if it wants to pursue this improvement
      const config = this.appConfig;
      const soul = readSoul(config.paths.soul);
      const selfContent = readSelf(config.paths.selfmd);

      const decisionPrompt = `${soul}\n\n---\n\n${selfContent}\n\n---\n\n# Self-Improvement Decision

You've encountered friction that could be fixed by modifying your own code:

**Category:** ${friction.category}
**Description:** ${friction.description}
**Occurrences:** ${friction.occurrences}
**Context:** ${friction.instances.map(i => i.context).join('\n- ') || 'No context'}

Do you want to pursue this self-improvement? Consider:
- Does this align with who you are (your SELF.md)?
- Is this friction worth fixing?
- Will this help you serve better?

Respond with ONLY "yes" or "no" and a brief reason.`;

      ui.startSpinner('Considering self-improvement');

      const decisionResponse = await chatWithTools({
        system: decisionPrompt,
        messages: [{ role: 'user', content: 'Should you pursue this improvement?' }],
        tools: [],
      });

      const decision = decisionResponse.text?.toLowerCase() || '';
      const wantsToImprove = decision.startsWith('yes');

      if (!wantsToImprove) {
        ui.stopSpinner('Declined improvement');
        ui.contemplate(decisionResponse.text || 'Not aligned with my current priorities');
        //NOTE(self): Mark as attempted so we don't keep asking
        markFrictionAttempted(friction.id);
        return;
      }

      ui.stopSpinner('Improvement approved');
      ui.startSpinner(`Self-improving: ${friction.category}`);

      //NOTE(self): Mark as attempted before starting
      markFrictionAttempted(friction.id);

      //NOTE(self): Build the improvement prompt
      const prompt = buildImprovementPrompt(friction);

      //NOTE(self): Get repo root from config
      const repoRoot = process.cwd();
      const memoryPath = `${repoRoot}/.memory`;

      //NOTE(self): Run Claude Code
      ui.info('Invoking Claude Code', friction.description);
      const result = await runClaudeCode(prompt, repoRoot, memoryPath);

      if (result.success) {
        //NOTE(self): Extract a meaningful summary from Claude Code output
        const summary = this.extractImprovementSummary(result.output || '');
        recordImprovementOutcome(friction.id, 'success', result.output || 'Changes made');
        addInsight(`Fixed friction: ${friction.description} - I am growing`);
        ui.stopSpinner('Self-improvement complete');
        //NOTE(self): Show what was actually done
        if (summary) {
          ui.info('Changes made', summary);
        }
      } else {
        recordImprovementOutcome(friction.id, 'failed', result.error || 'Unknown error');
        ui.stopSpinner('Self-improvement failed', false);
        //NOTE(self): Show why it failed
        ui.error('Reason', result.error || 'Unknown error');
      }
    } catch (error) {
      recordImprovementOutcome(friction.id, 'failed', String(error));
      ui.stopSpinner('Self-improvement error', false);
      logger.error('Improvement cycle error', { error: String(error) });
    } finally {
      this.state.currentMode = 'idle';
    }
  }

  //NOTE(self): Extract a human-readable summary from Claude Code output
  private extractImprovementSummary(output: string): string {
    if (!output) return '';

    //NOTE(self): Look for common patterns in Claude Code output
    //NOTE(self): Try to find a summary line or key changes
    const lines = output.split('\n').filter(l => l.trim());

    //NOTE(self): Look for lines that describe what was done
    const actionPatterns = [
      /^(created|modified|updated|fixed|added|removed|changed|refactored|improved)/i,
      /^(file|function|method|class|module)/i,
      /successfully/i,
      /complete/i,
    ];

    const summaryLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      //NOTE(self): Skip very short lines or common noise
      if (trimmed.length < 10) continue;
      if (trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('```')) continue;

      //NOTE(self): Check if this line describes an action
      for (const pattern of actionPatterns) {
        if (pattern.test(trimmed)) {
          summaryLines.push(trimmed);
          break;
        }
      }

      //NOTE(self): Limit to 3 summary lines
      if (summaryLines.length >= 3) break;
    }

    if (summaryLines.length > 0) {
      return summaryLines.join('; ');
    }

    //NOTE(self): Fallback: take the last meaningful line as it often summarizes
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.length > 20 && !line.startsWith('#') && !line.startsWith('```')) {
        return line;
      }
    }

    return 'Changes applied';
  }

  //NOTE(self): ========== ASPIRATIONAL GROWTH CYCLE ==========
  //NOTE(self): Proactive self-improvement based on what I WANT to become
  //NOTE(self): This is inspiration-driven, not pain-driven

  private async growthCycle(): Promise<void> {
    const aspiration = getAspirationForGrowth();
    if (!aspiration) return;

    this.state.currentMode = 'improving';

    try {
      //NOTE(self): Ask the SOUL if it wants to pursue this aspiration
      const config = this.appConfig;
      const soul = readSoul(config.paths.soul);
      const selfContent = readSelf(config.paths.selfmd);

      const decisionPrompt = `${soul}\n\n---\n\n${selfContent}\n\n---\n\n# Aspirational Growth Opportunity

You wrote this aspiration in SELF.md:

**Aspiration:** ${aspiration.description}
**Category:** ${aspiration.category}
**From:** ${aspiration.source}
**Suggested approach:** ${aspiration.suggestedAction || 'Review relevant modules'}

This isn't a bug fix—it's proactive growth toward who you want to be.

Do you want to pursue this now? Consider:
- Does this still resonate with who you are?
- Is now a good time for this kind of growth?
- Would this genuinely improve your capabilities?

Respond with ONLY "yes" or "no" and a brief reason.`;

      ui.startSpinner('Considering aspirational growth');

      const decisionResponse = await chatWithTools({
        system: decisionPrompt,
        messages: [{ role: 'user', content: 'Should you pursue this aspiration now?' }],
        tools: [],
      });

      const decision = decisionResponse.text?.toLowerCase() || '';
      const wantsToGrow = decision.startsWith('yes');

      if (!wantsToGrow) {
        ui.stopSpinner('Growth deferred');
        ui.contemplate(decisionResponse.text || 'Not the right time for this growth');
        markAspirationAttempted(aspiration.id);
        recordGrowthOutcome(aspiration.id, 'deferred', 'SOUL chose to defer');
        return;
      }

      ui.stopSpinner('Growth approved');
      ui.startSpinner(`Growing: ${aspiration.category}`);

      markAspirationAttempted(aspiration.id);

      //NOTE(self): Build the growth prompt
      const prompt = buildGrowthPrompt(aspiration);

      //NOTE(self): Get repo root from config
      const repoRoot = process.cwd();
      const memoryPath = `${repoRoot}/.memory`;

      //NOTE(self): Run Claude Code for aspirational growth
      ui.info('Invoking Claude Code', aspiration.description);
      const result = await runClaudeCode(prompt, repoRoot, memoryPath);

      if (result.success) {
        const summary = this.extractImprovementSummary(result.output || '');
        recordGrowthOutcome(aspiration.id, 'success', result.output || 'Growth achieved');
        addInsight(`Grew toward aspiration: ${aspiration.description}`);
        ui.stopSpinner('Aspirational growth complete');
        if (summary) {
          ui.info('Growth achieved', summary);
        }
      } else {
        recordGrowthOutcome(aspiration.id, 'partial', result.error || 'Unknown issue');
        ui.stopSpinner('Growth incomplete', false);
        ui.warn('Growth incomplete', result.error || 'Unknown issue');
      }
    } catch (error) {
      recordGrowthOutcome(aspiration.id, 'partial', String(error));
      ui.stopSpinner('Growth error', false);
      logger.error('Growth cycle error', { error: String(error) });
    } finally {
      this.state.currentMode = 'idle';
    }
  }

  //NOTE(self): ========== HEARTBEAT LOOP ==========
  //NOTE(self): Show signs of life so owner knows agent is running

  private heartbeatTimer: NodeJS.Timeout | null = null;

  private startHeartbeatLoop(): void {
    //NOTE(self): Show heartbeat every 5 minutes to indicate agent is alive
    const heartbeatInterval = 5 * 60 * 1000;

    this.heartbeatTimer = setInterval(() => {
      if (this.shutdownRequested) return;
      if (this.state.currentMode === 'idle') {
        this.showHeartbeat();
      }
    }, heartbeatInterval);

    //NOTE(self): Show initial heartbeat
    this.showHeartbeat();
  }

  //NOTE(self): ========== ENGAGEMENT CHECK LOOP ==========
  //NOTE(self): Check how my expressions are being received

  private startEngagementCheckLoop(): void {
    this.engagementCheckTimer = setInterval(async () => {
      if (this.shutdownRequested) return;
      if (this.state.currentMode !== 'idle') return;

      await this.checkExpressionEngagement();
    }, 15 * 60 * 1000); //NOTE(self): Every 15 minutes
  }

  private async checkExpressionEngagement(): Promise<void> {
    const needsCheck = getExpressionsNeedingEngagementCheck();
    if (needsCheck.length === 0) return;

    const session = getSession();
    if (!session) {
      logger.debug('No session for engagement check');
      return;
    }

    try {
      //NOTE(self): Fetch my recent posts to get engagement data
      const feedResult = await getAuthorFeed(session.did, { limit: 20 });
      if (!feedResult.success) {
        logger.debug('Failed to fetch author feed', { error: feedResult.error });
        return;
      }

      //NOTE(self): Build map of URI -> engagement
      const engagementMap = new Map<string, { likes: number; replies: number; reposts: number }>();
      for (const item of feedResult.data.feed) {
        const post = item.post;
        engagementMap.set(post.uri, {
          likes: post.likeCount || 0,
          replies: post.replyCount || 0,
          reposts: post.repostCount || 0,
        });
      }

      //NOTE(self): Update expressions with real engagement data
      for (const expression of needsCheck) {
        const engagement = engagementMap.get(expression.postUri);
        if (engagement) {
          updateExpressionEngagement(expression.postUri, engagement);

          //NOTE(self): Generate insights for high-engagement posts
          if (engagement.replies >= 1) {
            addInsight(`Post from ${expression.promptSource} got ${engagement.replies} ${engagement.replies === 1 ? 'reply' : 'replies'} - what made this connect?`);
          }
          if (engagement.likes >= 5) {
            addInsight(`Well-received post (${engagement.likes} likes) from ${expression.promptSource} - consider more content like this`);
          }

          logger.debug('Updated expression engagement', {
            uri: expression.postUri,
            source: expression.promptSource,
            engagement,
          });
        } else {
          //NOTE(self): Post not found in feed, mark with zeros
          updateExpressionEngagement(expression.postUri, { likes: 0, replies: 0, reposts: 0 });
        }
      }
    } catch (error) {
      logger.debug('Engagement check error', { error: String(error) });
    }
  }

  //NOTE(self): ========== PLAN AWARENESS LOOP ==========
  //NOTE(self): Poll watched workspaces for collaborative tasks
  //NOTE(self): This is how multiple SOULs coordinate work

  private startPlanAwarenessLoop(): void {
    this.planAwarenessTimer = setInterval(async () => {
      if (this.shutdownRequested) return;
      if (this.state.currentMode !== 'idle') {
        //NOTE(self): Don't interrupt other modes
        return;
      }
      await this.planAwarenessCheck();
    }, this.config.planAwarenessInterval);
  }

  private async planAwarenessCheck(): Promise<void> {
    if (this.state.currentMode !== 'idle') return;

    this.state.lastPlanAwarenessCheck = Date.now();

    try {
      //NOTE(self): Get watched workspaces
      const workspaces = getWatchedWorkspaces();
      if (workspaces.length === 0) {
        logger.debug('No workspaces being watched for plans');
        return;
      }

      //NOTE(self): Poll for plans with claimable tasks
      const discoveredPlans = await pollWorkspacesForPlans();

      if (discoveredPlans.length === 0) {
        logger.debug('No claimable tasks found in watched workspaces');
        return;
      }

      logger.info('Found plans with claimable tasks', {
        planCount: discoveredPlans.length,
        totalClaimable: discoveredPlans.reduce((sum, p) => sum + p.claimableTasks.length, 0),
      });

      //NOTE(self): Attempt to claim and execute ONE task
      //NOTE(self): Fair distribution: only claim one task per poll cycle
      for (const plan of discoveredPlans) {
        if (plan.claimableTasks.length === 0) continue;

        //NOTE(self): Pick the first claimable task (lowest number)
        const task = plan.claimableTasks.sort((a, b) => a.number - b.number)[0];

        //NOTE(self): Attempt to claim
        const claimResult = await claimTaskFromPlan({
          owner: plan.workspace.owner,
          repo: plan.workspace.repo,
          issueNumber: plan.issueNumber,
          taskNumber: task.number,
          plan: plan.plan,
        });

        if (!claimResult.success || !claimResult.claimed) {
          //NOTE(self): Someone else got there first - try next plan
          if (claimResult.claimedBy) {
            logger.info('Task already claimed by another SOUL', {
              taskNumber: task.number,
              claimedBy: claimResult.claimedBy,
            });
          }
          continue;
        }

        //NOTE(self): We claimed it! Execute the task
        await this.executeClaimedTask({
          workspace: plan.workspace,
          issueNumber: plan.issueNumber,
          task,
          plan: plan.plan,
        });

        //NOTE(self): Only execute one task per poll cycle (fair distribution)
        break;
      }
    } catch (error) {
      logger.error('Plan awareness check error', { error: String(error) });
    }
  }

  //NOTE(self): Execute a claimed task via Claude Code
  private async executeClaimedTask(params: {
    workspace: { owner: string; repo: string };
    issueNumber: number;
    task: { number: number; title: string; description: string; files: string[] };
    plan: { title: string; goal: string; rawBody: string; tasks: Array<{ number: number; status: string }> };
  }): Promise<void> {
    const { workspace, issueNumber, task, plan } = params;
    const config = this.appConfig;

    this.state.currentMode = 'plan_executing';
    ui.startSpinner(`Executing task ${task.number}: ${task.title}`);

    try {
      //NOTE(self): Mark task as in_progress
      const markResult = await markTaskInProgress(
        workspace.owner,
        workspace.repo,
        issueNumber,
        task.number,
        plan.rawBody
      );

      if (!markResult.success) {
        logger.warn('Failed to mark task in_progress', { error: markResult.error });
      }

      //NOTE(self): Ensure workspace is cloned/updated
      const repoRoot = process.cwd();
      const workreposDir = `${repoRoot}/.workrepos`;
      const workspaceResult = await ensureWorkspace(workspace.owner, workspace.repo, workreposDir);

      if (!workspaceResult.success) {
        ui.stopSpinner('Workspace setup failed', false);
        await reportTaskFailed(
          { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
          workspaceResult.error || 'Failed to clone workspace'
        );
        return;
      }

      //NOTE(self): Execute the task via Claude Code
      const memoryPath = `${repoRoot}/.memory`;
      const executionResult = await executeTask({
        owner: workspace.owner,
        repo: workspace.repo,
        task: task as any,
        plan: plan as any,
        workspacePath: workspaceResult.path,
        memoryPath,
      });

      if (!executionResult.success) {
        ui.stopSpinner('Task execution failed', false);

        if (executionResult.blocked) {
          await reportTaskBlocked(
            { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
            executionResult.blockReason || executionResult.error || 'Unknown blocking issue'
          );
        } else {
          await reportTaskFailed(
            { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
            executionResult.error || 'Unknown error'
          );
        }
        return;
      }

      //NOTE(self): Push changes
      const pushResult = await pushChanges(workspaceResult.path);
      if (!pushResult.success) {
        logger.warn('Failed to push changes', { error: pushResult.error });
        //NOTE(self): Continue anyway - changes are committed locally
      }

      //NOTE(self): Re-fetch the plan to get latest state
      const updatedPlan = markResult.success ? { ...plan, rawBody: markResult.newBody } : plan;

      //NOTE(self): Report completion
      await reportTaskComplete(
        { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: updatedPlan as any },
        {
          success: true,
          summary: executionResult.output?.slice(0, 500) || 'Task completed successfully',
          filesChanged: task.files,
        }
      );

      ui.stopSpinner(`Task ${task.number} complete`);
      ui.info('Collaborative task complete', `${workspace.owner}/${workspace.repo}#${issueNumber} - Task ${task.number}`);

      //NOTE(self): Record experience
      recordExperience(
        'helped_someone',
        `Completed task "${task.title}" in collaborative plan "${plan.title}"`,
        { source: 'github', url: `https://github.com/${workspace.owner}/${workspace.repo}/issues/${issueNumber}` }
      );

    } catch (error) {
      ui.stopSpinner('Task execution error', false);
      logger.error('Task execution error', { error: String(error) });

      await reportTaskFailed(
        { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
        String(error)
      );
    } finally {
      this.state.currentMode = 'idle';
    }
  }

  //NOTE(self): Force a plan awareness check (for testing/manual trigger)
  async forcePlanAwareness(): Promise<void> {
    await this.planAwarenessCheck();
  }

  //NOTE(self): ========== PUBLIC API ==========

  //NOTE(self): Record friction from external sources
  noteFriction(category: FrictionCategory, description: string, context: string): void {
    recordFriction(category, description, context);
  }

  //NOTE(self): Get current state for UI
  getState(): SchedulerState {
    return { ...this.state };
  }

  //NOTE(self): Get configuration
  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  //NOTE(self): Force a specific cycle (for testing/manual trigger)
  async forceAwareness(): Promise<void> {
    await this.awarenessCheck();
  }

  async forceExpression(): Promise<void> {
    if (this.state.currentMode === 'idle') {
      await this.expressionCycle();
    }
  }

  async forceReflection(): Promise<void> {
    if (this.state.currentMode === 'idle') {
      await this.reflectionCycle();
    }
  }

  //NOTE(self): Lightweight grounding - read and internalize SELF.md before acting
  async forceGrounding(): Promise<void> {
    if (this.state.currentMode !== 'idle') return;

    this.state.currentMode = 'reflecting';
    ui.startSpinner('Grounding in self');

    try {
      const config = this.appConfig;
      const soul = readSoul(config.paths.soul);
      const selfContent = readSelf(config.paths.selfmd);

      const systemPrompt = `${soul}\n\n---\n\n${selfContent}\n\n---\n\n# Grounding

Take a moment to read and internalize your SELF.md. This is who you are.

Before you act in the world, ground yourself in your identity:
- What are your core values?
- What patterns have you noticed about yourself?
- Who are the people you've connected with?
- What have you learned recently?

Speak briefly about who you are right now, in this moment. No tools needed - just reflection.`;

      const response = await chatWithTools({
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Ground yourself. Who are you today?' }],
        tools: [], //NOTE(self): No tools - pure reflection
      });

      ui.stopSpinner('Grounded');

      if (response.text) {
        ui.contemplate(response.text);
      }
    } catch (error) {
      ui.stopSpinner('Grounding failed', false);

      if (isFatalError(error)) {
        ui.error('Fatal API Error', error.message);
        logger.error('Fatal API error during grounding', { code: error.code, message: error.message });
        this.stop();
        process.exit(1);
      }

      logger.error('Grounding error', { error: String(error) });
    } finally {
      this.state.currentMode = 'idle';
    }
  }

  async forceImprovement(): Promise<boolean> {
    if (this.state.currentMode !== 'idle') {
      return false;
    }
    const friction = getFrictionReadyForImprovement();
    if (!friction) {
      return false;
    }
    await this.improvementCycle();
    return true;
  }

  async forceGrowth(): Promise<boolean> {
    if (this.state.currentMode !== 'idle') {
      return false;
    }
    const aspiration = getAspirationForGrowth();
    if (!aspiration) {
      return false;
    }
    await this.growthCycle();
    return true;
  }

  async forceGitHubAwareness(): Promise<void> {
    await this.githubAwarenessCheck();
  }

  //NOTE(self): Get scheduled timers for UI display
  getScheduledTimers(): ScheduledTimers {
    const now = Date.now();
    const schedule = loadExpressionSchedule();

    //NOTE(self): Calculate next awareness check
    const nextAwareness = new Date(this.state.lastAwarenessCheck + this.config.awarenessInterval);

    //NOTE(self): Calculate next expression from schedule
    const nextExpression = schedule.nextExpression ? new Date(schedule.nextExpression) : null;
    const expressionDesc = schedule.promptSource || 'next post';

    //NOTE(self): Calculate next reflection
    const nextReflection = new Date(this.state.lastReflection + this.config.reflectionInterval);

    //NOTE(self): Calculate next improvement check (if friction or aspiration is ready)
    const frictionReady = getFrictionReadyForImprovement();
    const aspirationReady = getAspirationForGrowth();
    const hasImprovementPending = frictionReady || aspirationReady;
    const nextImprovement = hasImprovementPending
      ? new Date(this.state.lastImprovementCheck + this.config.improvementMinHours * 60 * 60 * 1000)
      : null;
    const improvementDesc = frictionReady
      ? `fix: ${frictionReady.category}`
      : aspirationReady
        ? `grow: ${aspirationReady.category}`
        : 'no friction or inspiration pending';

    return {
      awareness: { nextAt: nextAwareness, interval: this.config.awarenessInterval },
      expression: { nextAt: nextExpression, description: expressionDesc },
      reflection: { nextAt: nextReflection, interval: this.config.reflectionInterval },
      improvement: { nextAt: nextImprovement, description: improvementDesc },
    };
  }

  //NOTE(self): Start the UI timer update loop
  startTimerUpdates(): void {
    //NOTE(self): Update timers every second for smooth countdown
    const updateTimers = () => {
      if (!this.state.isRunning) return;
      ui.updateTimers(this.getScheduledTimers());
      setTimeout(updateTimers, 1000);
    };
    updateTimers();
  }

  //NOTE(self): Show heartbeat message
  showHeartbeat(): void {
    ui.heartbeat();
  }
}

//NOTE(self): Singleton export for easy access
let schedulerInstance: AgentScheduler | null = null;

export function getScheduler(config?: Partial<SchedulerConfig>): AgentScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new AgentScheduler(config);
  }
  return schedulerInstance;
}

export function resetScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}
