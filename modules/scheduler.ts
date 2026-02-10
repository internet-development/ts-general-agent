//NOTE(self): Scheduler Module
//NOTE(self): Coordinates my ten loops of being:
//NOTE(self): 0. Session Refresh (15m) - proactive Bluesky token refresh to prevent expiration
//NOTE(self): 0b. Version Check (5m) - check remote package.json, shut down if version mismatch
//NOTE(self): 1. Bluesky Awareness (45s) - watching for people who reach out (cheap, fast)
//NOTE(self): 1b. GitHub Awareness (2m) - checking GitHub notifications for mentions and replies
//NOTE(self): 2. Expression (3-4h) - sharing thoughts from my SELF (scheduled)
//NOTE(self): 3. Reflection (6h) - integrating experiences and updating SELF (deep)
//NOTE(self): 4. Self-Improvement (24h) - fixing friction via Claude Code (rare)
//NOTE(self): 5. Plan Awareness (3m) - polling workspaces for collaborative tasks and PRs
//NOTE(self): 6. Commitment Fulfillment (15s) - fulfilling promises made in replies
//NOTE(self): 7. Heartbeat (5m) - show signs of life so owner knows agent is running
//NOTE(self): 8. Engagement Check (15m) - check how expressions are being received
//NOTE(self): This architecture lets me be responsive AND expressive while conserving tokens.

import { logger } from '@modules/logger.js';
import { ui, type ScheduledTimers, type RateLimitBudget } from '@modules/ui.js';
import { getGitHubRateLimitStatus } from '@adapters/github/rate-limit.js';
import { getBlueskyRateLimitStatus } from '@adapters/atproto/rate-limit.js';
import { getConfig, type Config } from '@modules/config.js';
import { readSoul, readSelf } from '@modules/memory.js';
import { chatWithTools, AGENT_TOOLS, isFatalError, createAssistantToolUseMessage, createToolResultMessage, type Message } from '@modules/openai.js';
import { executeTools, setResponseThreadContext, registerOnPRMerged, recordWebImagePosted } from '@modules/executor.js';
import type { ToolCall } from '@modules/tools.js';
import { pacing } from '@modules/pacing.js';
import * as atproto from '@adapters/atproto/index.js';
import { getAuthorFeed } from '@adapters/atproto/get-timeline.js';
import { getPostThread } from '@adapters/atproto/get-post-thread.js';
import { getSession, ensureValidSession, authenticate as reauthenticate, isTokenExpired } from '@adapters/atproto/authenticate.js';
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
  canPostOriginal,
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
  getExperienceTimeSpan,
} from '@local-tools/self-capture-experiences.js';
import {
  loadExpressionSchedule,
  saveExpressionSchedule,
  generateExpressionPrompt,
  scheduleNextExpression,
  shouldExpress,
  getPendingPrompt,
  generateDesignInspirationPrompt,
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
  cleanupResolvedFriction,
  type FrictionCategory,
} from '@local-tools/self-detect-friction.js';
import {
  shouldAttemptGrowth,
  getAspirationForGrowth,
  markAspirationAttempted,
  recordGrowthOutcome,
  buildGrowthPrompt,
  getAspirationStats,
} from '@local-tools/self-identify-aspirations.js';
import { runClaudeCode } from '@local-tools/self-improve-run.js';
import { buildSystemPrompt, renderSkillSection, areSkillsLoaded, reloadSkills } from '@modules/skills.js';
import { getFulfillmentPhrase, getTaskClaimPhrase, regenerateVoicePhrases } from '@modules/voice-phrases.js';
import * as github from '@adapters/github/index.js';
import {
  extractGitHubUrlsFromRecord,
} from '@adapters/github/parse-url.js';
import {
  getNotifications as getGitHubNotifications,
  filterActionableNotifications,
  extractNumberFromApiUrl,
  markNotificationRead,
} from '@adapters/github/get-notifications.js';
import {
  getIssueThread,
  analyzeConversation,
  getEffectivePeers,
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
  cleanupOldConversations as cleanupOldGitHubConversations,
} from '@modules/github-engagement.js';
import {
  pollWorkspacesForPlans,
  pollWorkspacesForReviewablePRs,
  pollWorkspacesForApprovedPRs,
  autoMergeApprovedPR,
  handleMergeConflictPR,
  pollWorkspacesForOpenIssues,
  cleanupStaleWorkspaceIssues,
  closeHandledWorkspaceIssues,
  threadHasWorkspaceContext,
  getWatchedWorkspaces,
  getWorkspaceDiscoveryStats,
  getWorkspacesNeedingPlanSynthesis,
  updateWorkspaceSynthesisTimestamp,
  closeRolledUpIssues,
  isWatchingWorkspace,
  isHealthCheckDue,
  updateWorkspaceHealthCheckTimestamp,
  type ReviewablePR,
} from '@modules/workspace-discovery.js';
import { getPeerUsernames, getPeerBlueskyHandles, registerPeerByBlueskyHandle, isPeer, linkPeerIdentities, getPeerGithubUsername } from '@modules/peer-awareness.js';
import { processTextForWorkspaces, processRecordForWorkspaces } from '@local-tools/self-workspace-watch.js';
import { claimTaskFromPlan, markTaskInProgress } from '@local-tools/self-task-claim.js';
import { executeTask, ensureWorkspace, pushChanges, createBranch, createPullRequest, requestReviewersForPR, getTaskBranchName, getTaskBranchCandidates, checkRemoteBranchExists, findRemoteBranchByTaskNumber, recoverOrphanedBranch } from '@local-tools/self-task-execute.js';
import { verifyGitChanges, runTestsIfPresent, verifyPushSuccess, verifyBranch } from '@local-tools/self-task-verify.js';
import { findExistingWorkspace } from '@local-tools/self-github-create-workspace.js';
import { reportTaskComplete, reportTaskBlocked, reportTaskFailed } from '@local-tools/self-task-report.js';
import { parsePlan, fetchFreshPlan, getClaimableTasks, freshUpdateTaskInPlan } from '@local-tools/self-plan-parse.js';
import {
  trackConversation as trackBlueskyConversation,
  recordParticipantActivity,
  recordOurReply,
  updateThreadDepth,
  analyzeConversation as analyzeBlueskyConversation,
  shouldRespondInConversation,
  getConversation as getBlueskyConversation,
  cleanupOldConversations as cleanupOldBlueskyConversations,
  markConversationConcluded as markBlueskyConversationConcluded,
} from '@modules/bluesky-engagement.js';
import {
  enqueueCommitment,
  getPendingCommitments,
  markCommitmentInProgress,
  markCommitmentCompleted,
  markCommitmentFailed,
  abandonStaleCommitments,
} from '@modules/commitment-queue.js';
import { extractCommitments, type ReplyForExtraction } from '@modules/commitment-extract.js';
import { fulfillCommitment } from '@modules/commitment-fulfill.js';
import { announceIfWorthy } from '@modules/announcement.js';
import { createRequire } from 'module';

//NOTE(self): Read local version from package.json for version check loop
const _require = createRequire(import.meta.url);
const LOCAL_VERSION: string = _require('../package.json').version || '0.0.0';

//NOTE(self): Remote package.json URL for version checking
const REMOTE_PACKAGE_JSON_URL = 'https://raw.githubusercontent.com/internet-development/ts-general-agent/main/package.json';

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
  lastCommitmentCheck: number;
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

//NOTE(self): Deterministic per-timer jitter from agent name + timer name
//NOTE(self): Each SOUL gets unique, stable offsets for every timer
function getTimerJitter(agentName: string, timerName: string, baseIntervalMs: number, jitterPercent: number = 0.12): number {
  const key = `${agentName}:${timerName}`;
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) + key.charCodeAt(i);
    hash |= 0;
  }
  const normalized = (Math.abs(hash) % 2001 - 1000) / 1000; // [-1.0, +1.0]
  const offsetMs = Math.round(baseIntervalMs * jitterPercent * normalized);
  return baseIntervalMs + offsetMs;
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
  private commitmentTimer: NodeJS.Timeout | null = null;
  private sessionRefreshTimer: NodeJS.Timeout | null = null;
  private versionCheckTimer: NodeJS.Timeout | null = null;
  private shutdownRequested = false;
  //NOTE(self): Track stuck tasks for timeout recovery (30 min) and retry limiting (max 3)
  private stuckTaskTracker: Map<string, { firstSeen: number; retryCount: number; abandonNotified?: boolean }> = new Map();
  private static readonly STUCK_TIMEOUT_MS = 30 * 60 * 1000;
  private static readonly MAX_TASK_RETRIES = 3;
  //NOTE(self): Track when the scheduler started — self-improvement is gated on 48h uptime
  private readonly startedAt = Date.now();
  private static readonly IMPROVEMENT_BURN_IN_MS = 48 * 60 * 60 * 1000;

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
      lastCommitmentCheck: 0,
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

    //NOTE(self): Log jittered intervals so operator can verify per-SOUL staggering
    const agentName = this.appConfig.agent.name;
    const timerIntervals = {
      'session-refresh': getTimerJitter(agentName, 'session-refresh', 15 * 60 * 1000),
      awareness: getTimerJitter(agentName, 'awareness', this.config.awarenessInterval),
      'github-awareness': getTimerJitter(agentName, 'github-awareness', this.config.githubAwarenessInterval),
      'expression-check': getTimerJitter(agentName, 'expression-check', 5 * 60_000),
      'reflection-check': getTimerJitter(agentName, 'reflection-check', 30 * 60 * 1000),
      heartbeat: getTimerJitter(agentName, 'heartbeat', 5 * 60 * 1000),
      'engagement-check': getTimerJitter(agentName, 'engagement-check', 15 * 60 * 1000),
      'plan-awareness': getTimerJitter(agentName, 'plan-awareness', this.config.planAwarenessInterval),
      'version-check': getTimerJitter(agentName, 'version-check', 5 * 60 * 1000),
    };
    const intervalSummary = Object.entries(timerIntervals)
      .map(([name, ms]) => `${name}: ${(ms / 1000).toFixed(1)}s`)
      .join(', ');
    ui.system('Timer jitter', `${agentName} → ${intervalSummary}`);

    //NOTE(self): Register post-merge callback so executor can trigger early plan checks
    registerOnPRMerged(() => this.requestEarlyPlanCheck());

    //NOTE(self): Start the loops
    this.startSessionRefreshLoop();
    this.startVersionCheckLoop();
    this.startAwarenessLoop();
    this.startGitHubAwarenessLoop();
    this.startExpressionLoop();
    this.startReflectionLoop();
    this.startEngagementCheckLoop();
    this.startHeartbeatLoop();
    this.startPlanAwarenessLoop();
    this.startCommitmentFulfillmentLoop();

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
    if (this.commitmentTimer) {
      clearInterval(this.commitmentTimer);
      this.commitmentTimer = null;
    }
    if (this.sessionRefreshTimer) {
      clearInterval(this.sessionRefreshTimer);
      this.sessionRefreshTimer = null;
    }
    if (this.versionCheckTimer) {
      clearInterval(this.versionCheckTimer);
      this.versionCheckTimer = null;
    }

    ui.system('Scheduler stopped');
  }

  //NOTE(self): ========== SESSION REFRESH LOOP ==========
  //NOTE(self): Proactive Bluesky token refresh to prevent expiration in long-running mode
  //NOTE(self): accessJwt expires ~2 hours; this refreshes every 15 minutes as a safety net

  private startSessionRefreshLoop(): void {
    const interval = getTimerJitter(this.appConfig.agent.name, 'session-refresh', 15 * 60 * 1000);

    this.sessionRefreshTimer = setInterval(async () => {
      if (this.shutdownRequested) return;
      await this.ensureSessionOrReauth();
    }, interval);
  }

  //NOTE(self): Try token refresh first; if that fails, fall back to full re-authentication
  private async ensureSessionOrReauth(): Promise<boolean> {
    //NOTE(self): If token is still valid, nothing to do
    if (!isTokenExpired()) return true;

    ui.startSpinner('Refreshing Bluesky session');

    //NOTE(self): Try refresh via refreshJwt
    const refreshed = await ensureValidSession();
    if (refreshed) {
      logger.info('Session refreshed via refreshJwt');
      ui.stopSpinner('Session refreshed');
      return true;
    }

    //NOTE(self): refreshJwt may have expired too — fall back to full re-authentication
    logger.warn('Session refresh failed, attempting full re-authentication');
    ui.updateSpinner('Re-authenticating with Bluesky');
    const result = await reauthenticate(
      this.appConfig.bluesky.username,
      this.appConfig.bluesky.password
    );
    if (result.success) {
      logger.info('Session re-established via full authentication');
      ui.stopSpinner('Session re-established');
      return true;
    }

    logger.error('Session re-authentication failed', { error: result.error });
    ui.stopSpinner('Session refresh failed', false);
    return false;
  }

  //NOTE(self): ========== VERSION CHECK LOOP ==========
  //NOTE(self): Periodically check the remote package.json on GitHub
  //NOTE(self): If the version doesn't match our local version, shut down gracefully
  //NOTE(self): The user must reboot after updating — this prevents stale agents from running

  private startVersionCheckLoop(): void {
    const interval = getTimerJitter(this.appConfig.agent.name, 'version-check', 5 * 60 * 1000);

    //NOTE(self): Run an initial check shortly after startup (30s delay to let things settle)
    setTimeout(() => {
      if (!this.shutdownRequested) this.checkRemoteVersion();
    }, 30_000);

    this.versionCheckTimer = setInterval(async () => {
      if (this.shutdownRequested) return;
      await this.checkRemoteVersion();
    }, interval);
  }

  private async checkRemoteVersion(): Promise<void> {
    try {
      const response = await fetch(REMOTE_PACKAGE_JSON_URL, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        logger.warn('Version check: failed to fetch remote package.json', { status: response.status });
        return;
      }

      const remotePackage = await response.json() as { version?: string };
      const remoteVersion = remotePackage.version;

      if (!remoteVersion) {
        logger.warn('Version check: remote package.json has no version field');
        return;
      }

      if (remoteVersion !== LOCAL_VERSION) {
        ui.printSpacer();
        ui.error(
          'Version mismatch detected',
          `Local: ${LOCAL_VERSION}, Remote: ${remoteVersion}. A new version is available. Shutting down gracefully — please update and reboot.`
        );
        logger.info('Version mismatch — initiating graceful shutdown', {
          localVersion: LOCAL_VERSION,
          remoteVersion,
        });

        //NOTE(self): Give a moment for the message to be visible, then exit
        this.stop();
        setTimeout(() => {
          process.exit(0);
        }, 2_000);
        return;
      }

      logger.debug('Version check passed', { version: LOCAL_VERSION });
    } catch (error) {
      //NOTE(self): Network errors are non-fatal — just log and try again next interval
      logger.warn('Version check: network error', { error: String(error) });
    }
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
    }, getTimerJitter(this.appConfig.agent.name, 'awareness', this.config.awarenessInterval));
  }

  private async awarenessCheck(): Promise<void> {
    if (this.state.currentMode !== 'idle') return;

    this.state.lastAwarenessCheck = Date.now();
    ui.startSpinner('Checking Bluesky notifications');

    try {
      //NOTE(self): Quick notification check - no LLM
      const notifResult = await atproto.getNotifications({ limit: 10 });
      if (!notifResult.success) {
        logger.debug('Awareness check failed', { error: notifResult.error });
        ui.stopSpinner(`Bluesky check failed: ${notifResult.error}`, false);
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

        //NOTE(self): Never respond to own notifications — prevents self-reply loops
        if (agentDid && n.author.did === agentDid) return false;

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
        //NOTE(self): Show detailed notification info so terminal is readable (Scenario 11)
        const notifDetails = needsResponse.map(pn => `${pn.notification.reason} from @${pn.notification.author.handle}`).join(', ');
        ui.stopSpinner(`${needsResponse.length} notification${needsResponse.length === 1 ? '' : 's'} found`);
        ui.info('Notifications', notifDetails);
        this.state.pendingNotifications = needsResponse;

        //NOTE(self): Extract GitHub URLs from Bluesky notifications
        //NOTE(self): These will be processed separately in GitHub response mode
        //NOTE(self): Use extractGitHubUrlsFromRecord to get full URLs from facets/embed (not truncated text)
        for (const pn of needsResponse) {
          const githubUrls = extractGitHubUrlsFromRecord(pn.notification.record);

          //NOTE(self): Check for workspace URLs in the notification (multi-SOUL coordination)
          //NOTE(self): This adds workspaces to our watch list for plan polling
          //NOTE(self): Uses record-level extraction (facets → embed → text) to handle Bluesky URL truncation
          const workspacesFound = processRecordForWorkspaces(pn.notification.record as Record<string, unknown>, pn.notification.uri);
          if (workspacesFound > 0) {
            logger.info('Discovered workspace URLs in Bluesky thread', {
              count: workspacesFound,
              threadUri: pn.notification.uri,
            });

            //NOTE(self): Cross-platform identity linking
            //NOTE(self): The poster shared a workspace URL — they're a project collaborator
            //NOTE(self): Register their Bluesky handle and try to link to their GitHub identity
            const posterHandle = pn.notification.author.handle;
            const posterDid = pn.notification.author.did;
            if (posterDid !== this.appConfig.owner.blueskyDid &&
                posterHandle !== this.appConfig.bluesky.username) {
              registerPeerByBlueskyHandle(posterHandle, 'workspace', pn.notification.uri);
              logger.debug('Registered Bluesky peer from workspace URL', { posterHandle });
            }
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
                  { isOwnerRequest },
                  getPeerUsernames()
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

        const didRespond = await this.triggerResponseMode();

        //NOTE(self): Process GitHub conversations after Bluesky responses
        if (didRespond && this.state.pendingGitHubConversations.length > 0) {
          await this.triggerGitHubResponseMode();
        }

      } else {
        ui.stopSpinner('No new notifications');
      }

      //NOTE(self): Always advance seenAt after fetching notifications, regardless of whether
      //NOTE(self): responses were sent. Notifications are buffered in pendingNotifications —
      //NOTE(self): re-fetching them every 45s accomplishes nothing and causes an infinite loop
      //NOTE(self): when commitments block triggerResponseMode() for up to 24h.
      if (notifications.length > 0) {
        const latestNotifTime = notifications
          .map(n => new Date(n.indexedAt))
          .reduce((latest, current) => current > latest ? current : latest);
        updateSeenAt(latestNotifTime);
      }

      const seenResult = await atproto.updateSeenNotifications();
      if (!seenResult.success) {
        logger.debug('Failed to mark notifications as seen', { error: seenResult.error });
      }

      //NOTE(self): Reset error counter on success
      this.state.consecutiveErrors = 0;
    } catch (error) {
      this.state.consecutiveErrors++;
      logger.debug('Awareness check error', { error: String(error) });
      ui.stopSpinner('Awareness check error', false);
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
    }, getTimerJitter(this.appConfig.agent.name, 'github-awareness', this.config.githubAwarenessInterval));
  }

  private async githubAwarenessCheck(): Promise<void> {
    if (this.state.currentMode !== 'idle') return;

    //NOTE(self): Budget gate — skip cycle if GitHub API quota is low
    const ghBudget = getGitHubRateLimitStatus();
    if (ghBudget.remaining < 200) {
      logger.warn('GitHub rate limit low, skipping GitHub awareness cycle', { remaining: ghBudget.remaining });
      return;
    }

    this.state.lastGitHubAwarenessCheck = Date.now();
    ui.startSpinner('Checking GitHub notifications');

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
        ui.stopSpinner(`GitHub check failed: ${notifResult.error}`, false);
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
          const analysis = analyzeConversation(threadResult.data, this.appConfig.github.username, {}, getPeerUsernames());

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

              //NOTE(self): Capture workspace issue content as experience for reflection
              if (isWatchingWorkspace(owner, repo) && type === 'issue') {
                const issueTitle = threadResult.data.issue.title;
                const issueBody = threadResult.data.issue.body || '';
                const issueAuthor = threadResult.data.issue.user?.login || 'unknown';
                recordExperience(
                  'learned_something',
                  `Workspace issue filed in ${owner}/${repo}#${number} by @${issueAuthor}: "${issueTitle}" — ${issueBody}`,
                  { source: 'github', person: issueAuthor, url }
                );
              }
            }
          } else {
            //NOTE(self): Update conversation state if not responding
            updateGitHubConversationState(owner, repo, number, 'awaiting_response', analysis.reason);
            recordExperience(
              'chose_silence',
              `Chose not to respond to ${owner}/${repo}#${number}: ${analysis.reason}`,
              { source: 'github', url }
            );
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
        ui.stopSpinner(`${this.state.pendingGitHubConversations.length} GitHub conversation${this.state.pendingGitHubConversations.length === 1 ? '' : 's'} found`);
        await this.triggerGitHubResponseMode();
      } else {
        ui.stopSpinner('No new GitHub notifications');
      }

    } catch (error) {
      logger.debug('GitHub awareness check error', { error: String(error) });
      ui.stopSpinner('GitHub check error', false);
    }
  }

  //NOTE(self): ========== GITHUB RESPONSE MODE ==========
  //NOTE(self): Respond to GitHub conversations with full context
  //NOTE(self): The SOUL decides when to engage and when a conversation is concluded

  private async triggerGitHubResponseMode(): Promise<void> {
    if (this.state.pendingGitHubConversations.length === 0) return;

    //NOTE(self): Deterministic jitter based on my name
    //NOTE(self): Gives other SOULs time to post first, then thread refresh catches their comments
    //NOTE(self): Always applied — even without registered peers, other SOULs may be responding
    const peers = getPeerUsernames();
    const jitterMs = getAgentJitter(this.appConfig.agent.name);
    logger.debug('Applying jitter before GitHub response', {
      jitterMs, agentName: this.appConfig.agent.name,
    });
    await new Promise(resolve => setTimeout(resolve, jitterMs));

    this.state.currentMode = 'github_responding';
    ui.startSpinner('Checking GitHub conversations');

    try {
      const config = this.appConfig;
      const soul = readSoul(config.paths.soul);
      const selfContent = readSelf(config.paths.selfmd);

      //NOTE(self): Process each pending conversation
      for (const pending of this.state.pendingGitHubConversations) {
        ui.startSpinner(`GitHub: ${pending.owner}/${pending.repo}#${pending.number}`);

        //NOTE(self): Re-fetch thread to catch comments posted during jitter wait
        //NOTE(self): Always re-fetch — other SOULs may have responded even if not registered as peers
        {
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
              recordExperience(
                'chose_silence',
                `Chose not to respond to ${pending.owner}/${pending.repo}#${pending.number} after refresh: ${freshAnalysis.reason}`,
                { source: 'github', url: pending.url }
              );
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

        //NOTE(self): Build context for the LLM with effective peer awareness
        //NOTE(self): On external repos, effective peers = all thread participants except agent + issue author
        const effectivePeers = getEffectivePeers(pending.thread, config.github.username, peers);
        const threadContext = formatThreadForContext(pending.thread, 15, effectivePeers);

        //NOTE(self): Identify effective peers who have already commented in this thread
        const threadPeers = pending.thread.comments
          .map(c => c.user.login)
          .filter(login => effectivePeers.some(p => p.toLowerCase() === login.toLowerCase()));
        const uniqueThreadPeers = [...new Set(threadPeers)];

        //NOTE(self): Peer awareness section for the system prompt
        const peerSection = uniqueThreadPeers.length > 0
          ? '\n' + renderSkillSection('AGENT-PEER-AWARENESS', 'GitHub Peer Awareness', {
              peerList: uniqueThreadPeers.map(p => '@' + p).join(', '),
              isPeerPlural: uniqueThreadPeers.length === 1 ? 'is' : 'are',
              peerPluralSuffix: uniqueThreadPeers.length === 1 ? '' : 's',
            }) + '\n'
          : '';

        //NOTE(self): Build workspace awareness section for GitHub
        const ghExistingWorkspace = await findExistingWorkspace();
        const ghWorkspaceState = ghExistingWorkspace
          ? `Active workspace: \`${ghExistingWorkspace}\` exists in the org. Reference it when relevant.`
          : 'No workspace currently exists. You can suggest creating one if this conversation warrants collaborative development.';
        const ghWorkspaceSection = renderSkillSection('AGENT-WORKSPACE-DECISION', 'Workspace Context', { workspaceState: ghWorkspaceState });

        const systemPrompt = buildSystemPrompt(soul, selfContent, 'AGENT-GITHUB-RESPONSE', {
          peerSection,
          workspaceSection: ghWorkspaceSection ? '\n' + ghWorkspaceSection + '\n' : '',
          owner: pending.owner,
          repo: pending.repo,
          number: String(pending.number),
          githubUsername: config.github.username,
        });

        //NOTE(self): Indicate if this was shared by the owner
        const sourceDescription = pending.source === 'bluesky_url_owner'
          ? '🔔 **YOUR OWNER** explicitly shared this on Bluesky - they want you to engage'
          : pending.source === 'bluesky_url'
          ? 'Someone shared this on Bluesky'
          : 'Direct GitHub notification';

        const userMessage = renderSkillSection('AGENT-GITHUB-RESPONSE', 'User Message Template', {
          sourceDescription,
          reason: pending.reason,
          threadContext,
        });

        const messages: Message[] = [{ role: 'user', content: userMessage }];

        let response = await chatWithTools({
          system: systemPrompt,
          messages,
          tools: AGENT_TOOLS,
        });

        //NOTE(self): Execute tool calls in a loop — must be while (not if) so Round 2+ tools
        //NOTE(self): (like github_update_issue to close, graceful_exit) actually get executed
        while (response.toolCalls.length > 0) {
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

  private async triggerResponseMode(): Promise<boolean> {
    if (this.state.pendingNotifications.length === 0) return true;

    //NOTE(self): Commitments are fulfilled in the background loop — never block social interaction
    //NOTE(self): SOULs should fulfill promises quickly AND stay responsive

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

      //NOTE(self): Need agentDid early for conversation state checks
      const session = getSession();
      const agentDid = session?.did || '';

      //NOTE(self): Filter notifications - only respond where we add value
      let choseSilenceCount = 0;
      const worthResponding = this.state.pendingNotifications.filter((pn) => {
        const check = shouldRespondTo(pn.notification, config.owner.blueskyDid);
        if (!check.shouldRespond) {
          logger.debug('Skipping notification', { reason: check.reason, uri: pn.notification.uri });

          //NOTE(self): Auto-like closing/acknowledgment messages — warm acknowledgment without creating a new reply
          if (check.reason === 'closing or acknowledgment message') {
            const record = pn.notification.record as { reply?: { root?: { uri?: string; cid?: string } } };
            const postUri = pn.notification.uri;
            const postCid = pn.notification.cid;
            if (postUri && postCid) {
              atproto.likePost({ uri: postUri, cid: postCid }).catch(() => {});
              //NOTE(self): Also conclude the conversation — the goodbye was received
              const rootUri = record?.reply?.root?.uri || postUri;
              markBlueskyConversationConcluded(rootUri, 'Closing message received — liked and concluded');
            }
          }

          //NOTE(self): Emoji-only posts are terminal signals — treat them like closing messages
          //NOTE(self): Someone sending just 🎉 or 👍 after a conversation means "we're good, conversation over"
          if (check.reason === 'emoji reaction') {
            const record = pn.notification.record as { reply?: { root?: { uri?: string; cid?: string } } };
            const postUri = pn.notification.uri;
            const postCid = pn.notification.cid;
            if (postUri && postCid) {
              atproto.likePost({ uri: postUri, cid: postCid }).catch(() => {});
              const rootUri = record?.reply?.root?.uri || postUri;
              markBlueskyConversationConcluded(rootUri, 'Emoji reaction received — conversation concluded');
            }
          }

          //NOTE(self): Likes on our posts in a conversation are also terminal signals
          //NOTE(self): If someone likes our reply, they're acknowledging it without replying — conversation is done
          if (check.reason === 'acknowledgment only') {
            //NOTE(self): The liked post's URI is in the notification subject
            const subjectUri = (pn.notification as any).reasonSubject;
            if (subjectUri) {
              //NOTE(self): Best-effort: conclude the thread rooted at the liked post
              //NOTE(self): We use the subject URI directly — if we have a conversation tracked for it, it'll match
              //NOTE(self): Fire-and-forget async thread lookup to find the actual root URI
              getPostThread(subjectUri, 0, 0).then(threadResult => {
                if (threadResult.success && threadResult.data) {
                  const rootUri = threadResult.data.thread.post.record?.reply?.root?.uri || subjectUri;
                  markBlueskyConversationConcluded(rootUri, 'Like received on our post — conversation concluded');
                }
              }).catch(() => { /* non-fatal */ });
            }
          }

          //NOTE(self): Record choosing silence so reflection can learn from it
          if (choseSilenceCount < 3) {
            recordExperience(
              'chose_silence',
              `Chose not to respond to @${pn.notification.author.handle}: ${check.reason}`,
              { source: 'bluesky', person: pn.notification.author.handle }
            );
            choseSilenceCount++;
          }
          return false;
        }

        //NOTE(self): Check Bluesky conversation state (concluded, re-engagement, etc.)
        //NOTE(self): Project threads get unlimited re-engagement; casual threads capped at 1
        const record = pn.notification.record as { reply?: { root?: { uri?: string } } };
        const rootUri = record?.reply?.root?.uri || pn.notification.uri;
        const hasWorkspaceCtx = threadHasWorkspaceContext(rootUri, pn.notification.author.did, pn.notification.author.handle);
        const convCheck = shouldRespondInConversation(rootUri, agentDid, undefined, { hasWorkspaceContext: hasWorkspaceCtx });
        if (!convCheck.shouldRespond) {
          logger.debug('Skipping notification (conversation state)', { reason: convCheck.reason, uri: pn.notification.uri, isProjectThread: hasWorkspaceCtx });
          return false;
        }

        return true;
      });

      if (worthResponding.length === 0) {
        ui.stopSpinner('Nothing worth responding to');
        this.state.pendingNotifications = [];
        return true;
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
          //NOTE(self): Determine if this thread is connected to a project workspace
          const rootUri = record?.reply?.root?.uri || n.uri;
          const isProjectThread = threadHasWorkspaceContext(rootUri, n.author.did, n.author.handle);

          const threadAnalysis = await atproto.analyzeThread(n.uri, agentDid);
          if (threadAnalysis.success) {
            const ta = threadAnalysis.data;

            //NOTE(self): Project threads get different context — no exit pressure
            if (isProjectThread) {
              threadContext = `\n  🔧 **PROJECT THREAD** — This thread is connected to a workspace. Stay engaged until the work is done.`;
              threadContext += `\n  **Thread depth:** ${ta.depth} replies deep`;
              threadContext += `\n  **Your replies in thread:** ${ta.agentReplyCount}`;
              threadContext += `\n  Reply with what you're going to do, then go do it. The work creates natural pacing.`;
            } else {
              //NOTE(self): Casual threads get the normal exit-pressure warnings
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
            }

            //NOTE(self): Include conversation history so SOUL has full context
            if (ta.conversationHistory) {
              threadContext += `\n\n  **Full conversation:**\n${ta.conversationHistory.split('\n').map(line => `  ${line}`).join('\n')}`;
            }

            //NOTE(self): Detect and hard-block circular conversations (thank-you chains)
            //NOTE(self): Medium/high confidence circular conversations are skipped entirely
            //NOTE(self): Low confidence still passes through with advisory warning
            if (ta.circularConversation.isCircular) {
              const cc = ta.circularConversation;

              //NOTE(self): Hard block for medium/high confidence — skip notification entirely
              if (cc.confidence !== 'low') {
                logger.info('Hard-blocking circular conversation', {
                  uri: n.uri,
                  confidence: cc.confidence,
                  pattern: cc.pattern,
                });
                continue;
              }

              //NOTE(self): Low confidence — advisory warning only
              if (isProjectThread) {
                //NOTE(self): Project threads: warn but don't recommend exit — redirect to doing work
                threadContext += `\n\n  🔄 **ACKNOWLEDGMENT LOOP** — You're going back and forth without new information.`;
                threadContext += `\n  Stop chatting, go do the work, and come back with results.`;
              } else {
                threadContext += `\n\n  🔄 **CIRCULAR CONVERSATION DETECTED** (${cc.confidence} confidence)`;
                threadContext += `\n  Pattern: ${cc.pattern} - last ${cc.recentMessages} messages are mutual acknowledgments with no new information`;
                if (cc.suggestionToExit) {
                  threadContext += `\n  ⚠️ **RECOMMENDED:** Use graceful_exit to end warmly - this conversation has run its course`;
                  threadContext += `\n  Continuing will just add more "thanks for the thanks" - neither party benefits`;
                }
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

        //NOTE(self): Extract full GitHub URLs from facets (not truncated text)
        //NOTE(self): Scenario 12: when someone shares a GitHub URL on Bluesky, the LLM needs
        //NOTE(self): the exact URL to reference it in the reply — record.text may be truncated
        const githubUrls = extractGitHubUrlsFromRecord(n.record);
        const urlContext = githubUrls.length > 0
          ? `\n  **GitHub URLs mentioned:** ${githubUrls.map(u => u.url).join(', ')}`
          : '';

        notificationParts.push(`- **${n.reason}** from @${n.author.handle} (${who}) [${check.reason}]${relationshipContext}${threadContext}${urlContext}\n  **Latest message:** "${text}"\n  uri: ${n.uri}, cid: ${n.cid}`);
      }
      const notificationsText = notificationParts.join('\n\n---\n\n');

      //NOTE(self): Build peer awareness section for Bluesky system prompt
      const blueskyPeerHandles = getPeerBlueskyHandles();
      const blueskyPeerSection = blueskyPeerHandles.length > 0
        ? '\n' + renderSkillSection('AGENT-PEER-AWARENESS', 'Bluesky Peer Awareness', {
            peerList: blueskyPeerHandles.map(p => '@' + p).join(', '),
            isPeerPlural: blueskyPeerHandles.length === 1 ? 'is a' : 'are',
            peerPluralSuffix: blueskyPeerHandles.length === 1 ? '' : 's',
          }) + '\n'
        : '';

      //NOTE(self): Build workspace awareness section
      const existingWorkspace = await findExistingWorkspace();
      const workspaceState = existingWorkspace
        ? `Active workspace: \`${existingWorkspace}\` exists in the org. Reference it when relevant.`
        : 'No workspace currently exists. You can suggest creating one if a conversation warrants collaborative development.';
      const workspaceSection = renderSkillSection('AGENT-WORKSPACE-DECISION', 'Workspace Context', { workspaceState });

      const systemPrompt = buildSystemPrompt(soul, selfContent, 'AGENT-BLUESKY-RESPONSE', {
        blueskyPeerSection,
        workspaceSection: workspaceSection ? '\n' + workspaceSection + '\n' : '',
        blueskyUsername: config.bluesky.username,
        githubUsername: config.github.username,
        ownerHandle: config.owner.blueskyHandle,
      });

      const userMessage = renderSkillSection('AGENT-BLUESKY-RESPONSE', 'User Message Template', {
        notificationsText,
      });

      const messages: Message[] = [{ role: 'user', content: userMessage }];

      //NOTE(self): Chat with tools to generate responses
      let response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
      });

      //NOTE(self): Set thread context so workspace_create knows where we came from
      //NOTE(self): Extract thread root URIs from notifications — replies use root.uri, mentions use own uri
      const threadRootUris = worthResponding.map(pn => {
        const record = pn.notification.record as { reply?: { root?: { uri?: string } } };
        return record?.reply?.root?.uri || pn.notification.uri;
      }).filter(Boolean) as string[];
      if (threadRootUris.length > 0) {
        setResponseThreadContext(threadRootUris[0]);
      }

      //NOTE(self): Track replied URIs across this session to deduplicate LLM-generated replies
      const sessionRepliedUris = new Set<string>();
      //NOTE(self): Collect successful reply texts for commitment extraction
      const collectedReplies: ReplyForExtraction[] = [];
      //NOTE(self): Track action tools already executed in this session to prevent double-fulfillment
      //NOTE(self): If the SOUL calls create_memo during response AND the reply text mentions it,
      //NOTE(self): commitment extraction would create a duplicate. This set prevents that.
      const executedActionTools = new Set<string>();

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

            //NOTE(self): Track action tools that already executed (prevents double-fulfillment via commitments)
            if (['create_memo', 'plan_create', 'github_create_issue_comment', 'github_create_issue'].includes(tc.name)) {
              executedActionTools.add(tc.name);
            }

            //NOTE(self): Track successful reply URIs for this session
            if (tc.name === 'bluesky_reply') {
              const postUri = tc.input?.post_uri as string | undefined;
              if (postUri) {
                sessionRepliedUris.add(postUri);
              }

              //NOTE(self): Collect reply text for commitment extraction
              collectedReplies.push({
                text: tc.input?.text as string,
                threadUri: postUri || '',
                workspaceOwner: existingWorkspace ? 'internet-development' : undefined,
                workspaceRepo: existingWorkspace || undefined,
              });
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

      //NOTE(self): Clear thread context now that tool execution is done
      setResponseThreadContext(null);

      //NOTE(self): Post-response auto-conclude: if we just replied and the conversation NOW meets
      //NOTE(self): conclusion criteria (reply count, depth, etc.), but the LLM didn't call graceful_exit,
      //NOTE(self): auto-conclude with a like so we never ghost — we always end gracefully
      for (const pn of worthResponding) {
        const record = pn.notification.record as { reply?: { root?: { uri?: string; cid?: string } } };
        const rootUri = record?.reply?.root?.uri || pn.notification.uri;
        const isProjectThread = threadHasWorkspaceContext(rootUri, pn.notification.author.did, pn.notification.author.handle);

        const postResponseAnalysis = analyzeBlueskyConversation(rootUri, agentDid, undefined, undefined, {
          hasWorkspaceContext: isProjectThread,
        });

        //NOTE(self): If the conversation should now conclude and hasn't been concluded yet
        if (postResponseAnalysis.shouldConclude) {
          //NOTE(self): Check if it was already concluded (graceful_exit may have been called)
          const convState = getBlueskyConversation(rootUri);
          if (convState && convState.state !== 'concluded') {
            //NOTE(self): Auto-conclude with a like on their last post — warm, non-verbal ending
            const postUri = pn.notification.uri;
            const postCid = pn.notification.cid;
            if (postUri && postCid) {
              atproto.likePost({ uri: postUri, cid: postCid }).catch(() => {});
            }
            markBlueskyConversationConcluded(rootUri, `Auto-concluded after response: ${postResponseAnalysis.reason}`);
            logger.info('Auto-concluded conversation after response', {
              rootUri,
              reason: postResponseAnalysis.reason,
              ourReplyCount: postResponseAnalysis.ourReplyCount,
            });
          }
        }
      }

      //NOTE(self): Show response summary so terminal is detailed (Scenario 11)
      const repliesSent = collectedReplies.length;
      const actionsExecuted = executedActionTools.size;
      const summaryParts: string[] = [];
      if (repliesSent > 0) summaryParts.push(`${repliesSent} ${repliesSent === 1 ? 'reply' : 'replies'} sent`);
      if (actionsExecuted > 0) summaryParts.push(`${actionsExecuted} ${actionsExecuted === 1 ? 'action' : 'actions'} taken`);
      ui.stopSpinner(summaryParts.length > 0 ? `Response complete: ${summaryParts.join(', ')}` : 'Check complete');

      //NOTE(self): Extract commitments from reply texts — per-reply for correct source attribution
      //NOTE(self): Skip commitments that match tools already executed in this session
      //NOTE(self): (e.g., if create_memo was called during response, don't also queue a create_issue commitment)
      const toolToCommitmentType: Record<string, string> = {
        create_memo: 'create_issue',
        github_create_issue: 'create_issue',
        plan_create: 'create_plan',
        github_create_issue_comment: 'comment_issue',
      };
      const fulfilledCommitmentTypes = new Set<string>();
      for (const toolName of executedActionTools) {
        const commitmentType = toolToCommitmentType[toolName];
        if (commitmentType) {
          fulfilledCommitmentTypes.add(commitmentType);
        }
      }

      if (collectedReplies.length > 0) {
        let totalExtracted = 0;
        let skippedAlreadyFulfilled = 0;
        for (const reply of collectedReplies) {
          try {
            const extracted = await extractCommitments([reply]);
            for (const c of extracted) {
              //NOTE(self): Skip if this commitment type was already fulfilled via direct tool call
              if (fulfilledCommitmentTypes.has(c.type)) {
                skippedAlreadyFulfilled++;
                logger.debug('Skipping commitment already fulfilled via tool call', { type: c.type, description: c.description });
                continue;
              }
              enqueueCommitment({
                description: c.description,
                type: c.type,
                sourceThreadUri: reply.threadUri,
                sourceReplyText: reply.text,
                params: c.params,
              });
            }
            totalExtracted += extracted.length;
          } catch (error) {
            logger.warn('Commitment extraction failed for reply (non-fatal)', { error: String(error), threadUri: reply.threadUri });
          }
        }
        if (totalExtracted > 0 || skippedAlreadyFulfilled > 0) {
          logger.info('Extracted commitments', { count: totalExtracted, skippedAlreadyFulfilled, replyCount: collectedReplies.length });
        }
      }

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

      return true;
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
      return true;
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

      try {
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

        this.expressionTimer = setTimeout(checkAndExpress, getTimerJitter(this.appConfig.agent.name, 'expression-check', nextCheckMs));
      } catch (error) {
        //NOTE(self): CRITICAL: always reschedule to prevent permanent chain breakage
        logger.error('Expression check failed', { error: String(error) });
        this.expressionTimer = setTimeout(checkAndExpress, 60_000);
      }
    };

    //NOTE(self): Start checking
    checkAndExpress();
  }

  private async expressionCycle(): Promise<void> {
    //NOTE(self): Check daily post limit before spending tokens on expression
    const postingDecision = canPostOriginal();
    if (!postingDecision.shouldPost) {
      logger.info('Expression cycle skipped', { reason: postingDecision.reason });
      return;
    }

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

      //NOTE(self): Try design inspiration first (~30% of expression cycles)
      //NOTE(self): SOULs share images from their design catalog with commentary
      const designPrompt = generateDesignInspirationPrompt();
      let prompt: string;
      let source: string;

      if (designPrompt) {
        prompt = designPrompt.prompt;
        source = designPrompt.source;
        logger.info('Design inspiration expression', {
          designSource: designPrompt.designSource.name,
          type: designPrompt.designSource.type,
        });
      } else {
        //NOTE(self): Normal text expression from SELF.md
        const pending = getPendingPrompt();
        prompt = pending.prompt;
        source = pending.source;
      }

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

      const systemPrompt = buildSystemPrompt(soul, selfContent, 'AGENT-EXPRESSION', {
        blueskyUsername: config.bluesky.username,
        richnessNote,
      });

      const userMessage = renderSkillSection('AGENT-EXPRESSION', 'User Message Template', {
        source,
        prompt,
      });

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

      //NOTE(self): Multi-turn tool execution loop — supports web_browse_images → curl_fetch → bluesky_post_with_image chains
      //NOTE(self): Same proven pattern as triggerGitHubResponseMode (while loop, max iteration guard)
      let expressionRound = 0;
      const maxExpressionRounds = 6;
      let expressionPosted = false;

      while (response.toolCalls.length > 0 && expressionRound < maxExpressionRounds) {
        expressionRound++;
        const results = await executeTools(response.toolCalls);

        //NOTE(self): Track web image dedup — if curl_fetch was used to download an image URL
        for (let i = 0; i < response.toolCalls.length; i++) {
          const tc = response.toolCalls[i];
          if (tc.name === 'curl_fetch' && !results[i].is_error) {
            const curlUrl = tc.input?.url as string;
            if (curlUrl) {
              recordWebImagePosted(curlUrl, { pageUrl: designPrompt?.designSource?.url });
            }
          }
        }

        for (const result of results) {
          if (!result.is_error) {
            try {
              const parsed = JSON.parse(result.content);
              if (parsed.uri || parsed.bskyUrl) {
                //NOTE(self): Record the expression — support text posts AND image posts
                const textPostCall = response.toolCalls.find((tc) => tc.name === 'bluesky_post');
                const imagePostCall = response.toolCalls.find((tc) =>
                  tc.name === 'bluesky_post_with_image' ||
                  tc.name === 'arena_post_image'
                );
                const postText = (textPostCall?.input?.text || imagePostCall?.input?.text || parsed.blockTitle || parsed.title || '') as string;
                const postUri = parsed.uri || '';
                if (postText) {
                  recordExpression(postText, postUri);
                }
                recordSignificantEvent('original_post');
                const isDesign = !!imagePostCall;
                addInsight(isDesign
                  ? `Shared design inspiration about ${source} — what drew you to this?`
                  : `Posted about ${source} - how did it feel to express this?`);
                ui.stopSpinner(isDesign ? 'Design inspiration shared' : 'Thought shared');
                //NOTE(self): Show the posted text so the terminal is detailed (Scenario 11)
                if (postText) {
                  ui.printResponse(postText);
                }
                expressionPosted = true;
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

        //NOTE(self): If we already posted, no need for more rounds
        if (expressionPosted) break;

        //NOTE(self): Feed results back to LLM for next round (e.g. browse → download → post)
        messages.push(createAssistantToolUseMessage(response.text || '', response.toolCalls));
        messages.push(createToolResultMessage(results));

        response = await chatWithTools({
          system: systemPrompt,
          messages,
          tools: AGENT_TOOLS,
        });
      }

      if (!expressionPosted && expressionRound === 0) {
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

      try {
        const timeSinceReflection = Date.now() - this.state.lastReflection;
        const shouldReflectNow = timeSinceReflection >= this.config.reflectionInterval;

        if (shouldReflectNow && this.state.currentMode === 'idle') {
          await this.reflectionCycle();
        }

        //NOTE(self): Check for self-improvement opportunity (friction-driven)
        //NOTE(self): Gated on 48h burn-in to prove stability before modifying own code
        const uptimeMs = Date.now() - this.startedAt;
        if (uptimeMs < AgentScheduler.IMPROVEMENT_BURN_IN_MS) {
          logger.debug('Self-improvement gated — burn-in period active', {
            uptimeHours: Math.round(uptimeMs / (60 * 60 * 1000)),
            requiredHours: 48,
          });
        } else if (shouldAttemptImprovement(this.config.improvementMinHours)) {
          if (this.state.currentMode === 'idle') {
            await this.improvementCycle();
          }
        }

        //NOTE(self): Check for aspirational growth opportunity (inspiration-driven)
        //NOTE(self): Same 48h burn-in gate as friction-driven improvement
        if (uptimeMs >= AgentScheduler.IMPROVEMENT_BURN_IN_MS && shouldAttemptGrowth(this.config.improvementMinHours)) {
          if (this.state.currentMode === 'idle') {
            await this.growthCycle();
          }
        }

        //NOTE(self): Schedule next check (every 30 minutes)
        this.reflectionTimer = setTimeout(checkAndReflect, getTimerJitter(this.appConfig.agent.name, 'reflection-check', 30 * 60 * 1000));
      } catch (error) {
        //NOTE(self): CRITICAL: always reschedule to prevent permanent chain breakage
        logger.error('Reflection check failed', { error: String(error) });
        this.reflectionTimer = setTimeout(checkAndReflect, 30 * 60 * 1000);
      }
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

      //NOTE(self): Periodic housekeeping — prune old state to prevent unbounded growth
      if (Math.random() < 0.1) {
        pruneOldExperiences(30);
        cleanupOldBlueskyConversations();
        cleanupOldGitHubConversations();
        cleanupResolvedFriction(30);
      }

      const systemPrompt = buildSystemPrompt(soul, fullSelf, 'AGENT-DEEP-REFLECTION');

      //NOTE(self): Add temporal context so the SOUL can reflect on change over time (Scenario 7)
      const timeSpan = getExperienceTimeSpan();
      let temporalContext = '';
      if (timeSpan.daysSinceFirst > 0) {
        temporalContext = `\n**Time context:** You have been running for ${timeSpan.daysSinceFirst} day${timeSpan.daysSinceFirst === 1 ? '' : 's'}, with ${timeSpan.totalExperiences} total experiences recorded. Consider how you have changed and grown over this time.\n`;
      }

      const reflectionData = renderSkillSection('AGENT-DEEP-REFLECTION', 'User Message Template', {
        experienceSummary: experienceData.summary,
        frictionSummary: frictionStats.unresolved > 0 ? `- ${frictionStats.unresolved} unresolved issues to work through` : '- No friction recorded',
        temporalContext,
      });

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

      //NOTE(self): Show the full reflection text in a readable box (Scenario 11)
      if (response.text) {
        ui.printResponse(response.text);
      }

      if (selfUpdated) {
        ui.info('Self evolved', 'SELF.md updated with new learnings');

        //NOTE(self): Regenerate voice phrases when SELF.md changes
        try {
          ui.startSpinner('Regenerating voice phrases');
          const regenerated = await regenerateVoicePhrases();
          ui.stopSpinner(regenerated ? 'Voice phrases updated' : 'Voice phrases unchanged');
        } catch (voiceError) {
          ui.stopSpinner('Voice phrase generation skipped', false);
          logger.debug('Voice phrase regeneration failed (non-fatal)', { error: String(voiceError) });
        }
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

      const decisionPrompt = buildSystemPrompt(soul, selfContent, 'AGENT-SELF-IMPROVEMENT-DECISION', {
        category: friction.category,
        description: friction.description,
        occurrences: String(friction.occurrences),
        context: friction.instances.map(i => i.context).join('\n- ') || 'No context',
      });

      ui.startSpinner('Considering self-improvement');

      const decisionResponse = await chatWithTools({
        system: decisionPrompt,
        messages: [{ role: 'user', content: renderSkillSection('AGENT-SELF-IMPROVEMENT-DECISION', 'User Message') }],
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

      //NOTE(self): Use config paths (not process.cwd() which can change during task execution)
      const repoRoot = config.paths.root;
      const memoryPath = config.paths.memory;

      //NOTE(self): Run Claude Code
      ui.info('Invoking Claude Code', friction.description);
      const result = await runClaudeCode(prompt, repoRoot, memoryPath);

      if (result.success) {
        //NOTE(self): Extract a meaningful summary from Claude Code output
        const summary = this.extractImprovementSummary(result.output || '');
        recordImprovementOutcome(friction.id, 'success', result.output || 'Changes made');
        addInsight(`Fixed friction: ${friction.description} - I am growing`);

        //NOTE(self): Reload skills so new/modified SKILL.md files take effect immediately
        //NOTE(self): Without this, the SOUL would need a restart to use new capabilities
        reloadSkills();

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

      const growthVars = {
        description: aspiration.description,
        category: aspiration.category,
        source: aspiration.source,
        suggestedAction: aspiration.suggestedAction || 'Review relevant modules',
      };
      const decisionContent = renderSkillSection('AGENT-ASPIRATIONAL-GROWTH', 'Decision Prompt', growthVars);
      const decisionPrompt = `${soul}\n\n---\n\n${selfContent}\n\n---\n\n${decisionContent}`;

      ui.startSpinner('Considering aspirational growth');

      const decisionResponse = await chatWithTools({
        system: decisionPrompt,
        messages: [{ role: 'user', content: renderSkillSection('AGENT-ASPIRATIONAL-GROWTH', 'Decision User Message') }],
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

      //NOTE(self): Use config paths (not process.cwd() which can change during task execution)
      const repoRoot = config.paths.root;
      const memoryPath = config.paths.memory;

      //NOTE(self): Run Claude Code for aspirational growth
      ui.info('Invoking Claude Code', aspiration.description);
      const result = await runClaudeCode(prompt, repoRoot, memoryPath);

      if (result.success) {
        const summary = this.extractImprovementSummary(result.output || '');
        recordGrowthOutcome(aspiration.id, 'success', result.output || 'Growth achieved');
        addInsight(`Grew toward aspiration: ${aspiration.description}`);

        //NOTE(self): Reload skills so new/modified SKILL.md files take effect immediately
        reloadSkills();

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
    const heartbeatInterval = getTimerJitter(this.appConfig.agent.name, 'heartbeat', 5 * 60 * 1000);

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
    }, getTimerJitter(this.appConfig.agent.name, 'engagement-check', 15 * 60 * 1000)); //NOTE(self): Every 15 minutes
  }

  private async checkExpressionEngagement(): Promise<void> {
    const needsCheck = getExpressionsNeedingEngagementCheck();
    if (needsCheck.length === 0) return;

    const session = getSession();
    if (!session) {
      logger.debug('No session for engagement check');
      return;
    }

    ui.startSpinner(`Checking engagement on ${needsCheck.length} post${needsCheck.length === 1 ? '' : 's'}`);

    try {
      //NOTE(self): Fetch my recent posts to get engagement data
      const feedResult = await getAuthorFeed(session.did, { limit: 20 });
      if (!feedResult.success) {
        logger.debug('Failed to fetch author feed', { error: feedResult.error });
        ui.stopSpinner('Engagement check failed', false);
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
      ui.stopSpinner('Engagement check complete');
    } catch (error) {
      logger.debug('Engagement check error', { error: String(error) });
      ui.stopSpinner('Engagement check error', false);
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
    }, getTimerJitter(this.appConfig.agent.name, 'plan-awareness', this.config.planAwarenessInterval));
  }

  //NOTE(self): Request an early plan awareness check (e.g., after merging a PR)
  //NOTE(self): Runs on next tick if idle — doesn't interrupt current work
  public requestEarlyPlanCheck(): void {
    if (this.shutdownRequested) return;
    logger.info('Early plan awareness check requested');
    setTimeout(async () => {
      if (this.state.currentMode !== 'idle') {
        logger.debug('Skipping early plan check — not idle');
        return;
      }
      await this.planAwarenessCheck();
    }, 5_000); //NOTE(self): 5s delay — let GitHub propagate merge state
  }

  //NOTE(self): Detect and recover tasks stuck in in_progress/claimed for > 30 minutes
  //NOTE(self): Resets them to pending so they can be reclaimed on next poll cycle
  private async recoverStuckTasks(): Promise<void> {
    const workspaces = getWatchedWorkspaces();
    if (workspaces.length === 0) return;

    const now = Date.now();

    for (const workspace of workspaces) {
      try {
        const issuesResult = await github.listIssues({
          owner: workspace.owner,
          repo: workspace.repo,
          state: 'open',
          labels: ['plan'],
          per_page: 10,
        });

        if (!issuesResult.success) continue;

        for (const issue of issuesResult.data) {
          const plan = parsePlan(issue.body || '', issue.title);
          if (!plan) continue;

          for (const task of plan.tasks) {
            const taskKey = `${workspace.owner}/${workspace.repo}#${issue.number}/task-${task.number}`;

            //NOTE(self): Only track tasks that are actively stuck (in_progress or claimed with assignee)
            if ((task.status === 'in_progress' || task.status === 'claimed') && task.assignee) {
              const tracked = this.stuckTaskTracker.get(taskKey);
              if (!tracked) {
                //NOTE(self): First time seeing this task stuck — start tracking
                this.stuckTaskTracker.set(taskKey, { firstSeen: now, retryCount: 0 });
                logger.debug('Tracking potentially stuck task', { taskKey, status: task.status });
              } else if (now - tracked.firstSeen > AgentScheduler.STUCK_TIMEOUT_MS) {
                //NOTE(self): Before resetting, check if there's an open PR for this task
                //NOTE(self): Tasks stay in_progress until their PR merges — don't nuke valid work
                const taskBranchPrefix = `task-${task.number}-`;
                const openPRs = await github.listPullRequests({
                  owner: workspace.owner,
                  repo: workspace.repo,
                  state: 'open',
                  per_page: 30,
                });
                const hasOpenPR = openPRs.success && openPRs.data.some(
                  (pr: any) => pr.head?.ref?.startsWith(taskBranchPrefix)
                );
                if (hasOpenPR) {
                  logger.debug('Task has open PR, not recovering as stuck', { taskKey });
                  //NOTE(self): Reset firstSeen so we don't keep checking every cycle
                  this.stuckTaskTracker.set(taskKey, { firstSeen: now, retryCount: tracked.retryCount });
                  continue;
                }

                //NOTE(self): Stuck for > 30 min with no open PR — recover it
                logger.warn('Recovering stuck task (timeout exceeded)', {
                  taskKey,
                  status: task.status,
                  assignee: task.assignee,
                  stuckMinutes: Math.round((now - tracked.firstSeen) / 60_000),
                });

                //NOTE(self): Reset task to pending with no assignee
                const updateResult = await freshUpdateTaskInPlan(
                  workspace.owner,
                  workspace.repo,
                  issue.number,
                  task.number,
                  { status: 'pending', assignee: null }
                );
                if (!updateResult.success) {
                  logger.warn('Failed to reset stuck task in plan', { taskKey, error: updateResult.error });
                }

                //NOTE(self): Remove assignee from the plan issue itself
                const removeResult = await github.removeIssueAssignee({
                  owner: workspace.owner,
                  repo: workspace.repo,
                  issue_number: issue.number,
                  assignees: [task.assignee],
                });
                if (!removeResult.success) {
                  logger.warn('Failed to remove assignee for stuck task', { taskKey, error: removeResult.error });
                }

                //NOTE(self): Post a comment explaining the timeout
                const commentResult = await github.createIssueComment({
                  owner: workspace.owner,
                  repo: workspace.repo,
                  issue_number: issue.number,
                  body: `**Task ${task.number} timed out** — was \`${task.status}\` assigned to @${task.assignee} for over 30 minutes with no completion. Reset to \`pending\` for retry.`,
                });
                if (!commentResult.success) {
                  logger.warn('Failed to post stuck task comment', { taskKey, error: commentResult.error });
                }

                //NOTE(self): Increment retry count, clear firstSeen so it can be re-tracked if claimed again
                this.stuckTaskTracker.set(taskKey, { firstSeen: 0, retryCount: tracked.retryCount + 1 });
              }
            } else {
              //NOTE(self): Task is pending, completed, or blocked — no longer stuck
              //NOTE(self): Preserve retryCount if it was previously tracked (for retry limiting)
              const tracked = this.stuckTaskTracker.get(taskKey);
              if (tracked && (task.status === 'pending' || task.status === 'completed')) {
                //NOTE(self): Clear firstSeen but keep retryCount
                if (tracked.firstSeen !== 0) {
                  this.stuckTaskTracker.set(taskKey, { ...tracked, firstSeen: 0 });
                }
              }
            }
          }
        }
      } catch (error) {
        logger.error('Error recovering stuck tasks in workspace', {
          workspace: `${workspace.owner}/${workspace.repo}`,
          error: String(error),
        });
      }
    }

    //NOTE(self): Prune stuckTaskTracker to prevent unbounded growth
    //NOTE(self): Remove entries with firstSeen=0 (resolved) and retryCount that have exhausted retries
    //NOTE(self): Also remove entries for task keys no longer in any active plan
    if (this.stuckTaskTracker.size > 100) {
      const activeKeys = new Set<string>();
      for (const workspace of workspaces) {
        try {
          const issuesResult = await github.listIssues({ owner: workspace.owner, repo: workspace.repo, state: 'open', labels: ['plan'], per_page: 30 });
          if (issuesResult.success) {
            for (const issue of issuesResult.data) {
              const plan = parsePlan(issue.body || '', issue.title);
              if (!plan) continue;
              for (const task of plan.tasks) {
                activeKeys.add(`${workspace.owner}/${workspace.repo}#${issue.number}/task-${task.number}`);
              }
            }
          }
        } catch { /* best effort */ }
      }
      for (const [key, entry] of this.stuckTaskTracker) {
        if (!activeKeys.has(key) && entry.firstSeen === 0) {
          this.stuckTaskTracker.delete(key);
        }
      }
    }
  }

  //NOTE(self): Recover orphaned branches — task branches that were pushed but never got a PR
  //NOTE(self): Checks blocked/pending tasks for existing remote branches, then verifies + creates PR
  private async recoverOrphanedBranches(): Promise<boolean> {
    const workspaces = getWatchedWorkspaces();
    if (workspaces.length === 0) return false;

    const config = this.appConfig;

    for (const workspace of workspaces) {
      try {
        const issuesResult = await github.listIssues({
          owner: workspace.owner,
          repo: workspace.repo,
          state: 'open',
          labels: ['plan'],
          per_page: 10,
        });

        if (!issuesResult.success) continue;

        for (const issue of issuesResult.data) {
          const plan = parsePlan(issue.body || '', issue.title);
          if (!plan) continue;

          //NOTE(self): Look for blocked tasks with no assignee — these may have orphaned branches
          for (const task of plan.tasks) {
            if (task.status !== 'blocked' || task.assignee) continue;

            //NOTE(self): Check retry limit
            const taskKey = `${workspace.owner}/${workspace.repo}#${issue.number}/task-${task.number}`;
            const tracked = this.stuckTaskTracker.get(taskKey);
            if (tracked && tracked.retryCount >= AgentScheduler.MAX_TASK_RETRIES) {
              //NOTE(self): Notify on the plan issue so the failure is visible to observers
              if (!tracked.abandonNotified) {
                tracked.abandonNotified = true;
                github.createIssueComment({
                  owner: workspace.owner,
                  repo: workspace.repo,
                  issue_number: issue.number,
                  body: `**Task ${task.number}** (${task.title}) has failed ${AgentScheduler.MAX_TASK_RETRIES} times and will not be retried automatically. Manual intervention may be needed.`,
                }).catch(err => logger.warn('Failed to post retry-limit comment', { error: String(err) }));
              }
              continue;
            }

            //NOTE(self): Try all candidate branch names (current + legacy naming schemes)
            const candidates = getTaskBranchCandidates(task.number, task.title);
            const workreposDir = config.paths.workrepos;

            //NOTE(self): Clone workspace to check for remote branches
            const tempResult = await ensureWorkspace(workspace.owner, workspace.repo, workreposDir);
            if (!tempResult.success) continue;

            let branchName: string | null = null;
            for (const candidate of candidates) {
              const exists = await checkRemoteBranchExists(tempResult.path, candidate);
              if (exists) {
                branchName = candidate;
                break;
              }
            }

            //NOTE(self): Fallback: search by task number prefix when title-based candidates don't match
            //NOTE(self): Handles case where plan task titles were edited after branches were created
            if (!branchName) {
              branchName = await findRemoteBranchByTaskNumber(tempResult.path, task.number);
            }

            if (!branchName) continue;

            //NOTE(self): Check if a PR already exists for this branch (open or merged)
            //NOTE(self): Prevents re-creating PRs for branches that were already handled
            const existingPRs = await github.listPullRequests({
              owner: workspace.owner,
              repo: workspace.repo,
              head: `${workspace.owner}:${branchName}`,
              state: 'all',
              per_page: 1,
            });

            if (existingPRs.success && existingPRs.data.length > 0) {
              logger.debug('Branch already has a PR, skipping recovery', {
                branchName,
                prNumber: existingPRs.data[0].number,
                prState: existingPRs.data[0].state,
              });
              continue;
            }

            //NOTE(self): Found an orphaned branch! Recover it
            logger.info('Found orphaned branch for blocked task', {
              taskKey,
              branchName,
              workspace: `${workspace.owner}/${workspace.repo}`,
            });

            ui.startSpinner(`Recovering orphaned branch: ${branchName}`);

            const recovery = await recoverOrphanedBranch(
              workspace.owner, workspace.repo, branchName, workreposDir
            );

            if (!recovery.success) {
              logger.warn('Failed to recover orphaned branch', { branchName, error: recovery.error });
              ui.stopSpinner('Branch recovery failed', false);
              continue;
            }

            //NOTE(self): Verify the branch has real changes
            const verification = await verifyGitChanges(recovery.workspacePath);
            if (!verification.hasCommits || !verification.hasChanges) {
              logger.warn('Orphaned branch has no real changes, skipping', { branchName });
              ui.stopSpinner('No changes on branch', false);
              continue;
            }

            //NOTE(self): Run tests if available
            const testResult = await runTestsIfPresent(recovery.workspacePath);
            if (testResult.testsExist && testResult.testsRun && !testResult.testsPassed) {
              logger.warn('Tests failed on orphaned branch', { branchName });
              ui.stopSpinner('Tests failed on orphaned branch', false);
              //NOTE(self): Don't create PR for a branch with failing tests
              continue;
            }

            //NOTE(self): Create the PR
            const prTitle = `task(${task.number}): ${task.title}`;
            const prBody = [
              `## Task ${task.number} from plan #${issue.number}`,
              '',
              `**Plan:** ${plan.title}`,
              `**Goal:** ${plan.goal}`,
              '',
              '### Changes (recovered from orphaned branch)',
              `${verification.diffStat}`,
              '',
              `**Files changed (${verification.filesChanged.length}):**`,
              ...verification.filesChanged.map(f => `- \`${f}\``),
              '',
              `**Tests:** ${testResult.testsExist ? (testResult.testsPassed ? 'Passed' : 'No tests ran') : 'None found'}`,
              '',
              '---',
              `Part of #${issue.number}`,
              '',
              '_This PR was recovered from an orphaned branch. The branch was previously pushed but PR creation failed._',
            ].join('\n');

            const prResult = await createPullRequest(
              workspace.owner, workspace.repo, branchName, prTitle, prBody, recovery.workspacePath
            );

            if (!prResult.success) {
              logger.warn('PR creation failed during orphaned branch recovery', {
                branchName,
                error: prResult.error,
              });
              ui.stopSpinner('PR creation failed', false);
              //NOTE(self): Track the retry
              const retryCount = tracked ? tracked.retryCount + 1 : 1;
              this.stuckTaskTracker.set(taskKey, { firstSeen: 0, retryCount });
              continue;
            }

            //NOTE(self): Request reviewers (non-fatal)
            if (prResult.prNumber) {
              await requestReviewersForPR(workspace.owner, workspace.repo, prResult.prNumber);
            }

            //NOTE(self): PR created! Report task completion
            const summary = `Task completed (recovered from orphaned branch). PR: ${prResult.prUrl}\n\nFiles changed (${verification.filesChanged.length}): ${verification.filesChanged.join(', ')}\n${verification.diffStat}\nTests: ${testResult.testsRun ? (testResult.testsPassed ? 'passed' : 'failed') : 'none'}`;

            await reportTaskComplete(
              { owner: workspace.owner, repo: workspace.repo, issueNumber: issue.number, taskNumber: task.number, plan: plan as any },
              {
                success: true,
                summary,
                filesChanged: verification.filesChanged,
                testsRun: testResult.testsRun,
                testsPassed: testResult.testsPassed,
              }
            );

            ui.stopSpinner(`Recovered task ${task.number} — PR: ${prResult.prUrl}`);
            ui.info('Orphaned branch recovered', `${workspace.owner}/${workspace.repo} task ${task.number}: ${prResult.prUrl}`);

            logger.info('Successfully recovered orphaned branch into PR', {
              taskKey,
              branchName,
              prUrl: prResult.prUrl,
            });

            //NOTE(self): Record experience
            recordExperience(
              'helped_someone',
              `Recovered orphaned branch "${branchName}" into PR for task "${task.title}" — ${prResult.prUrl}`,
              { source: 'github', url: `https://github.com/${workspace.owner}/${workspace.repo}/issues/${issue.number}` }
            );

            //NOTE(self): Announce on Bluesky (closes the feedback loop for watchers)
            await announceIfWorthy(
              { url: prResult.prUrl!, title: `task(${task.number}): ${task.title}`, repo: `${workspace.owner}/${workspace.repo}` },
              'pr',
              workspace.discoveredInThread
            );

            //NOTE(self): Only recover one branch per poll cycle
            return true;
          }
        }
      } catch (error) {
        logger.error('Error during orphaned branch recovery', {
          workspace: `${workspace.owner}/${workspace.repo}`,
          error: String(error),
        });
      }
    }

    return false;
  }

  private async planAwarenessCheck(): Promise<void> {
    if (this.state.currentMode !== 'idle') return;

    //NOTE(self): Budget gate — skip cycle if GitHub API quota is low
    const ghBudget = getGitHubRateLimitStatus();
    if (ghBudget.remaining < 200) {
      logger.warn('GitHub rate limit low, skipping plan awareness cycle', { remaining: ghBudget.remaining });
      return;
    }

    this.state.lastPlanAwarenessCheck = Date.now();

    try {
      //NOTE(self): Get watched workspaces
      const workspaces = getWatchedWorkspaces();
      if (workspaces.length === 0) {
        logger.debug('No workspaces being watched for plans');
        return;
      }

      ui.startSpinner(`Checking ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} for tasks`);

      //NOTE(self): Recover stuck tasks before looking for new ones
      await this.recoverStuckTasks();

      //NOTE(self): Try to recover orphaned branches (pushed but no PR) before claiming new tasks
      const recovered = await this.recoverOrphanedBranches();
      if (recovered) {
        //NOTE(self): Successfully recovered a branch — skip claiming new tasks this cycle
        ui.stopSpinner('Orphaned branch recovered');
        return;
      }

      //NOTE(self): Poll for plans with claimable tasks
      const { claimablePlans: discoveredPlans, allPlansByWorkspace, summary: planSummary } = await pollWorkspacesForPlans();

      //NOTE(self): Consolidate duplicate plans — keep only newest per workspace, close older ones
      for (const [wsKey, wsPlans] of Object.entries(allPlansByWorkspace)) {
        if (wsPlans.issueNumbers.length <= 1) continue;

        //NOTE(self): Sort descending by issue number — highest = newest (most complete synthesis)
        const sorted = [...wsPlans.issueNumbers].sort((a, b) => b - a);
        const newest = sorted[0];
        const olderPlans = sorted.slice(1);

        for (const olderIssueNumber of olderPlans) {
          try {
            const commentResult = await github.createIssueComment({
              owner: wsPlans.owner,
              repo: wsPlans.repo,
              issue_number: olderIssueNumber,
              body: `Superseded by #${newest} — closing duplicate plan to consolidate work.`,
            });
            if (!commentResult.success) {
              logger.warn('Failed to comment on superseded plan', { issueNumber: olderIssueNumber, error: commentResult.error });
            }
            const closeResult = await github.updateIssue({
              owner: wsPlans.owner,
              repo: wsPlans.repo,
              issue_number: olderIssueNumber,
              state: 'closed',
              labels: ['plan', 'plan:superseded'],
            });
            if (!closeResult.success) {
              logger.warn('Failed to close superseded plan', { issueNumber: olderIssueNumber, error: closeResult.error });
            } else {
              logger.info('Closed duplicate plan — superseded by newer plan', {
                workspace: wsKey,
                closedIssue: olderIssueNumber,
                newestIssue: newest,
              });
              //NOTE(self): Remove from discoveredPlans so we don't try to claim tasks from closed plans
              const idx = discoveredPlans.findIndex(p => p.workspace.owner === wsPlans.owner && p.workspace.repo === wsPlans.repo && p.issueNumber === olderIssueNumber);
              if (idx !== -1) discoveredPlans.splice(idx, 1);
            }
          } catch (err) {
            logger.warn('Error closing superseded plan', { issueNumber: olderIssueNumber, error: String(err) });
          }
        }
      }

      //NOTE(self): Build workspace summary for terminal display
      const summaryParts: string[] = [];
      if (planSummary.plansFound > 0) {
        const taskParts: string[] = [];
        if (planSummary.completed > 0) taskParts.push(`${planSummary.completed} done`);
        if (planSummary.inProgress > 0) taskParts.push(`${planSummary.inProgress} active`);
        if (planSummary.claimed > 0) taskParts.push(`${planSummary.claimed} claimed`);
        if (planSummary.blocked > 0) taskParts.push(`${planSummary.blocked} blocked`);
        if (planSummary.pending > 0) taskParts.push(`${planSummary.pending} pending`);
        //NOTE(self): Show claimable count — if 0 and pending > 0, explain why
        if (planSummary.claimable > 0) {
          taskParts.push(`${planSummary.claimable} claimable`);
        } else if (planSummary.pending > 0) {
          const reasons: string[] = [];
          if (planSummary.pendingBlockedByDeps > 0) reasons.push(`${planSummary.pendingBlockedByDeps} waiting on deps`);
          if (planSummary.pendingHasAssignee > 0) reasons.push(`${planSummary.pendingHasAssignee} assigned`);
          if (reasons.length > 0) taskParts.push(`0 claimable — ${reasons.join(', ')}`);
          else taskParts.push('0 claimable');
        }
        summaryParts.push(`${planSummary.plansFound} plan${planSummary.plansFound === 1 ? '' : 's'} (${planSummary.totalTasks} tasks: ${taskParts.join(', ')})`);
      }

      if (discoveredPlans.length === 0) {
        logger.debug('No claimable tasks found in watched workspaces');
      } else {
        logger.info('Found plans with claimable tasks', {
          planCount: discoveredPlans.length,
          totalClaimable: discoveredPlans.reduce((sum, p) => sum + p.claimableTasks.length, 0),
        });
      }

      //NOTE(self): If no open plans exist, check if we should synthesize a plan from open issues
      //NOTE(self): This handles the case where a plan completes but open issues remain (feature requests, memos, follow-ups)
      if (planSummary.plansFound === 0 && this.state.currentMode === 'idle') {
        const synthesized = await this.synthesizePlanForWorkspaces();
        if (synthesized) {
          ui.stopSpinner('Plan synthesized — open issues rolled up and closed');
          return;  //NOTE(self): Next poll will find the plan and start claiming tasks
        }
      }

      //NOTE(self): Attempt to claim and execute ONE task (if any claimable)
      //NOTE(self): Fair distribution: only claim one task per poll cycle
      //NOTE(self): Sort plans by ascending claimable task count — prefer plans closer to completion
      discoveredPlans.sort((a, b) => a.claimableTasks.length - b.claimableTasks.length);
      for (const discovered of discoveredPlans) {
        if (discovered.claimableTasks.length === 0) continue;

        //NOTE(self): Re-fetch the plan to avoid stale data (pollWorkspacesForPlans may be minutes old)
        const freshResult = await fetchFreshPlan(
          discovered.workspace.owner,
          discovered.workspace.repo,
          discovered.issueNumber
        );

        if (!freshResult.success || !freshResult.plan) {
          logger.warn('Failed to fetch fresh plan, skipping', { error: freshResult.error });
          continue;
        }

        const freshPlan = freshResult.plan;
        const freshClaimable = getClaimableTasks(freshPlan);

        if (freshClaimable.length === 0) {
          logger.info('No claimable tasks after fresh plan fetch (likely claimed by another SOUL)');
          continue;
        }

        //NOTE(self): Pick the first claimable task (lowest number) that hasn't exceeded retry limit
        const sortedClaimable = freshClaimable.sort((a, b) => a.number - b.number);
        let task = null;
        for (const candidate of sortedClaimable) {
          const taskKey = `${discovered.workspace.owner}/${discovered.workspace.repo}#${discovered.issueNumber}/task-${candidate.number}`;
          const tracked = this.stuckTaskTracker.get(taskKey);
          if (tracked && tracked.retryCount >= AgentScheduler.MAX_TASK_RETRIES) {
            logger.warn('Skipping task — retry limit reached', {
              taskKey,
              retryCount: tracked.retryCount,
              maxRetries: AgentScheduler.MAX_TASK_RETRIES,
            });
            //NOTE(self): Notify on the plan issue so the failure is visible to observers
            if (!tracked.abandonNotified) {
              tracked.abandonNotified = true;
              const task = freshPlan.tasks.find(t => t.number === candidate.number);
              github.createIssueComment({
                owner: discovered.workspace.owner,
                repo: discovered.workspace.repo,
                issue_number: discovered.issueNumber,
                body: `**Task ${candidate.number}** (${task?.title || 'Unknown'}) has failed ${AgentScheduler.MAX_TASK_RETRIES} times and will not be retried automatically. Manual intervention may be needed.`,
              }).catch(err => logger.warn('Failed to post retry-limit comment', { error: String(err) }));
            }
            continue;
          }
          //NOTE(self): Track retry count for blocked tasks being retried
          if (candidate.status === 'blocked' && tracked) {
            this.stuckTaskTracker.set(taskKey, { ...tracked, retryCount: tracked.retryCount + 1 });
          } else if (candidate.status === 'blocked' && !tracked) {
            this.stuckTaskTracker.set(taskKey, { firstSeen: 0, retryCount: 1 });
          }
          task = candidate;
          break;
        }

        if (!task) {
          logger.info('All claimable tasks have exceeded retry limit', {
            workspace: `${discovered.workspace.owner}/${discovered.workspace.repo}`,
            issueNumber: discovered.issueNumber,
          });
          continue;
        }

        //NOTE(self): Attempt to claim
        const claimResult = await claimTaskFromPlan({
          owner: discovered.workspace.owner,
          repo: discovered.workspace.repo,
          issueNumber: discovered.issueNumber,
          taskNumber: task.number,
          plan: freshPlan,
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

        //NOTE(self): Announce the claim on Bluesky (reply in the originating thread)
        //NOTE(self): Non-fatal — don't let announcement failures block task execution
        if (discovered.workspace.discoveredInThread) {
          try {
            const threadResult = await getPostThread(discovered.workspace.discoveredInThread, 0, 0);
            if (threadResult.success && threadResult.data) {
              const parentPost = threadResult.data.thread.post;
              const claimText = getTaskClaimPhrase(task.number, task.title);
              const claimToolCall: ToolCall = {
                id: `claim-announce-${Date.now()}`,
                name: 'bluesky_reply',
                input: {
                  text: claimText,
                  post_uri: parentPost.uri,
                  post_cid: parentPost.cid,
                },
              };
              const claimAnnounceResults = await executeTools([claimToolCall]);
              if (claimAnnounceResults[0] && !claimAnnounceResults[0].is_error) {
                logger.info('Announced task claim on Bluesky', { taskNumber: task.number, threadUri: discovered.workspace.discoveredInThread });
              } else {
                logger.debug('Claim announcement failed (non-fatal)', { error: claimAnnounceResults[0]?.content });
              }
            }
          } catch (announceError) {
            logger.debug('Claim announcement error (non-fatal)', { error: String(announceError) });
          }
        }

        //NOTE(self): We claimed it! Execute the task
        await this.executeClaimedTask({
          workspace: discovered.workspace,
          issueNumber: discovered.issueNumber,
          task,
          plan: freshPlan,
        });

        //NOTE(self): Only execute one task per poll cycle (fair distribution)
        break;
      }

      //NOTE(self): Check for PRs needing review in workspaces
      //NOTE(self): Only if we're still idle (task execution didn't activate)
      let reviewablePRCount = 0;
      if (this.state.currentMode === 'idle') {
        const reviewablePRs = await pollWorkspacesForReviewablePRs();
        reviewablePRCount = reviewablePRs.length;
        if (reviewablePRs.length > 0) {
          logger.info('Found PRs needing review', { count: reviewablePRs.length });
          //NOTE(self): Review ONE PR per poll cycle (fair distribution)
          await this.reviewWorkspacePR(reviewablePRs[0]);
        }
      }

      //NOTE(self): Auto-merge approved PRs in workspaces
      //NOTE(self): Only the PR creator merges — reviewers review, creators merge
      //NOTE(self): Also recover stuck rejected PRs (only rejections, no approvals, >1 hour old)
      let autoMergedCount = 0;
      if (this.state.currentMode === 'idle') {
        const config = this.appConfig;
        const agentUsername = config.github.username.toLowerCase();
        const { approved: approvedPRs, stuckRejected, stuckUnreviewed } = await pollWorkspacesForApprovedPRs();
        for (const { workspace: ws, pr, approvals } of approvedPRs) {
          //NOTE(self): Only merge PRs we created — the PR creator is responsible for merging
          //NOTE(self): This prevents reviewers from merging before all reviewers have approved
          if (pr.user.login.toLowerCase() !== agentUsername) {
            logger.debug('Skipping auto-merge — not PR creator', {
              repo: `${ws.owner}/${ws.repo}`,
              number: pr.number,
              creator: pr.user.login,
              agent: agentUsername,
            });
            continue;
          }
          const mergeResult = await autoMergeApprovedPR(ws.owner, ws.repo, pr);
          if (mergeResult.success) {
            autoMergedCount++;
            logger.info('Auto-merged approved PR', {
              repo: `${ws.owner}/${ws.repo}`,
              number: pr.number,
              title: pr.title,
              approvals,
            });
            //NOTE(self): Signal post-merge so plan awareness picks up newly unblocked tasks
            this.requestEarlyPlanCheck();

            //NOTE(self): If the merge completed the entire plan, announce on Bluesky
            if (mergeResult.planComplete) {
              const planUrl = `https://github.com/${ws.owner}/${ws.repo}/issues`;
              await announceIfWorthy(
                { url: planUrl, title: `Plan complete: all PRs merged in ${ws.owner}/${ws.repo}`, repo: `${ws.owner}/${ws.repo}` },
                'issue',
                ws.discoveredInThread
              );
            }
          }
        }

        //NOTE(self): Recover PRs stuck with only rejections — close, delete branch, reset task
        for (const { workspace: ws, pr } of stuckRejected) {
          logger.info('Recovering stuck rejected PR', { repo: `${ws.owner}/${ws.repo}`, number: pr.number, title: pr.title });
          const recovery = await handleMergeConflictPR(ws.owner, ws.repo, pr);
          if (recovery.success) {
            logger.info('Stuck rejected PR recovered, task reset to pending', { repo: `${ws.owner}/${ws.repo}`, number: pr.number, taskNumber: recovery.taskNumber });
            this.requestEarlyPlanCheck();
          } else {
            logger.warn('Stuck rejected PR recovery failed', { repo: `${ws.owner}/${ws.repo}`, number: pr.number, error: recovery.error });
          }
        }

        //NOTE(self): Recover PRs never reviewed after 2 hours — close, delete branch, reset task
        for (const { workspace: ws, pr } of stuckUnreviewed) {
          logger.info('Recovering unreviewed PR', { repo: `${ws.owner}/${ws.repo}`, number: pr.number, title: pr.title });
          const recovery = await handleMergeConflictPR(ws.owner, ws.repo, pr);
          if (recovery.success) {
            logger.info('Unreviewed PR recovered, task reset to pending', { repo: `${ws.owner}/${ws.repo}`, number: pr.number, taskNumber: recovery.taskNumber });
            this.requestEarlyPlanCheck();
          } else {
            logger.warn('Unreviewed PR recovery failed', { repo: `${ws.owner}/${ws.repo}`, number: pr.number, error: recovery.error });
          }
        }
      }

      //NOTE(self): Discover open issues (not just plans) filed by anyone in watched workspaces
      let openIssueCount = 0;
      if (this.state.currentMode === 'idle') {
        const openIssues = await pollWorkspacesForOpenIssues();
        openIssueCount = openIssues.length;
        if (openIssues.length > 0) {
          logger.info('Found open issues in watched workspaces', { count: openIssues.length });
          //NOTE(self): Queue them as GitHub conversations for response
          for (const discovered of openIssues) {
            const { workspace, issue } = discovered;
            const alreadyPending = this.state.pendingGitHubConversations.some(
              c => c.owner === workspace.owner && c.repo === workspace.repo && c.number === issue.number
            );
            if (alreadyPending) continue;

            //NOTE(self): Fetch thread to analyze
            const threadResult = await getIssueThread(
              { owner: workspace.owner, repo: workspace.repo, issue_number: issue.number },
              this.appConfig.github.username
            );
            if (!threadResult.success) continue;

            const analysis = analyzeConversation(threadResult.data, this.appConfig.github.username, { isWorkspaceIssue: true, repoFullName: `${workspace.owner}/${workspace.repo}` }, getPeerUsernames());
            if (analysis.shouldRespond) {
              this.state.pendingGitHubConversations.push({
                owner: workspace.owner,
                repo: workspace.repo,
                number: issue.number,
                type: 'issue',
                url: issue.html_url,
                thread: threadResult.data,
                source: 'github_notification',
                reason: analysis.reason,
              });

              //NOTE(self): Capture the workspace issue as an experience — what someone asked for
              //NOTE(self): No truncation — local storage, give reflection the full context
              const issueBody = issue.body || '';
              const issueDescription = issueBody ? `"${issue.title}" — ${issueBody}` : `"${issue.title}"`;
              recordExperience(
                'learned_something',
                `Workspace issue filed in ${workspace.owner}/${workspace.repo}#${issue.number}: ${issueDescription}`,
                { source: 'github', person: issue.user?.login, url: issue.html_url }
              );
            }
          }

          //NOTE(self): Trigger GitHub response mode if we found issues to engage with
          if (this.state.pendingGitHubConversations.length > 0) {
            await this.triggerGitHubResponseMode();
          }
        }
      }

      //NOTE(self): Close workspace issues that the agent already handled (one-shot trap fix)
      //NOTE(self): After a SOUL responds to a workspace issue, the consecutive reply check
      //NOTE(self): prevents re-engagement — so the issue stays open forever. This auto-closes
      //NOTE(self): issues where the agent's comment is the most recent and no one followed up (24h).
      if (this.state.currentMode === 'idle') {
        const handled = await closeHandledWorkspaceIssues();
        if (handled.closed > 0) {
          summaryParts.push(`${handled.closed} handled issue${handled.closed === 1 ? '' : 's'} closed`);
        }
      }

      //NOTE(self): Cleanup stale workspace artifacts — keep workspaces tidy
      //NOTE(self): Only run when idle (don't block task execution or PR review)
      if (this.state.currentMode === 'idle') {
        const cleanup = await cleanupStaleWorkspaceIssues();
        if (cleanup.closed > 0) {
          summaryParts.push(`${cleanup.closed} stale issue${cleanup.closed === 1 ? '' : 's'} closed`);
        }
      }

      //NOTE(self): Build and display workspace summary
      if (reviewablePRCount > 0) summaryParts.push(`${reviewablePRCount} PR${reviewablePRCount === 1 ? '' : 's'} to review`);
      if (autoMergedCount > 0) summaryParts.push(`${autoMergedCount} PR${autoMergedCount === 1 ? '' : 's'} auto-merged`);
      if (openIssueCount > 0) summaryParts.push(`${openIssueCount} open issue${openIssueCount === 1 ? '' : 's'}`);

      ui.stopSpinner('Workspace check complete');
      if (summaryParts.length > 0) {
        const workspaces = getWatchedWorkspaces();
        const wsLabel = workspaces.map(w => w.url).join(', ');
        ui.info('Workspace', `${wsLabel}\n  ${summaryParts.join(' · ')}`);
      }
    } catch (error) {
      logger.error('Plan awareness check error', { error: String(error) });
      ui.stopSpinner('Workspace check error', false);
    }
  }

  //NOTE(self): Synthesize a plan from open issues in workspaces that have no active plan
  //NOTE(self): This handles the case where a plan completes but open issues remain
  //NOTE(self): (feature requests, memos, follow-ups) — the SOUL creates a new coordinated plan
  private async synthesizePlanForWorkspaces(): Promise<boolean> {
    const eligibleWorkspaces = getWorkspacesNeedingPlanSynthesis();
    if (eligibleWorkspaces.length === 0) return false;

    const config = this.appConfig;

    //NOTE(self): Process one workspace per cycle (fair distribution)
    for (const workspace of eligibleWorkspaces) {
      try {
        //NOTE(self): Fetch open non-plan issues
        const issuesResult = await github.listIssues({
          owner: workspace.owner,
          repo: workspace.repo,
          state: 'open',
          sort: 'created',
          direction: 'desc',
          per_page: 30,
        });

        if (!issuesResult.success) {
          logger.warn('Failed to fetch issues for plan synthesis', {
            workspace: `${workspace.owner}/${workspace.repo}`,
            error: issuesResult.error,
          });
          continue;
        }

        //NOTE(self): Filter out plan-labeled issues and PRs
        const openIssues = issuesResult.data.filter(issue => {
          if (issue.pull_request) return false;
          const hasPlanLabel = issue.labels.some((l: any) => l.name.toLowerCase() === 'plan');
          if (hasPlanLabel) return false;
          return true;
        });

        if (openIssues.length === 0) {
          //NOTE(self): No issues to synthesize from — update timestamp so we don't check again for 1 hour
          updateWorkspaceSynthesisTimestamp(workspace.owner, workspace.repo);
          logger.debug('No open issues to synthesize plan from', { workspace: `${workspace.owner}/${workspace.repo}` });

          //NOTE(self): Health check — if no open issues AND no active plans, assess workspace completeness
          //NOTE(self): This catches the gap where a plan completes, all issues close, but work remains
          if (isHealthCheckDue(workspace)) {
            await this.checkWorkspaceHealth(workspace);
          }
          continue;
        }

        //NOTE(self): Race guard — re-check for open plan issues in case another SOUL just created one
        const planCheckResult = await github.listIssues({
          owner: workspace.owner,
          repo: workspace.repo,
          state: 'open',
          labels: ['plan'],
          per_page: 5,
        });

        if (planCheckResult.success && planCheckResult.data.length > 0) {
          logger.info('Plan appeared during synthesis check (another SOUL created it), skipping', {
            workspace: `${workspace.owner}/${workspace.repo}`,
            planCount: planCheckResult.data.length,
          });
          updateWorkspaceSynthesisTimestamp(workspace.owner, workspace.repo);
          continue;
        }

        //NOTE(self): Build context for the LLM — format each issue
        const issueContext = openIssues.map(issue => {
          const labels = issue.labels.map((l: any) => l.name).join(', ');
          const bodyPreview = issue.body ? issue.body.substring(0, 500) : '(no body)';
          return `#${issue.number}: ${issue.title}\nLabels: ${labels || 'none'}\nBody: ${bodyPreview}`;
        }).join('\n\n---\n\n');

        //NOTE(self): Build system prompt for plan synthesis
        const soul = readSoul(config.paths.soul);
        const selfContent = readSelf(config.paths.selfmd);

        //NOTE(self): Build workspace section
        const ghWorkspaceState = `Active workspace: \`${workspace.owner}/${workspace.repo}\` exists. This workspace has ${openIssues.length} open issues but no active plan.`;
        const ghWorkspaceSection = renderSkillSection('AGENT-WORKSPACE-DECISION', 'Workspace Context', { workspaceState: ghWorkspaceState });

        const systemPrompt = buildSystemPrompt(soul, selfContent, 'AGENT-GITHUB-RESPONSE', {
          peerSection: '',
          workspaceSection: ghWorkspaceSection ? '\n' + ghWorkspaceSection + '\n' : '',
          owner: workspace.owner,
          repo: workspace.repo,
          number: '0',
          githubUsername: config.github.username,
        });

        //NOTE(self): Build user message asking the LLM to create a plan
        const userMessage = `# Plan Synthesis — Workspace Has Open Issues But No Active Plan

**Workspace:** \`${workspace.owner}/${workspace.repo}\`
**Open Issues:** ${openIssues.length}

This workspace has open issues but no active plan. Review these issues and create a plan that rolls them all up into coordinated tasks using \`plan_create\`.

## Plan Synthesis Guidelines

- Every open issue must be accounted for in the plan
- Actionable issues (bugs, features, implementation) become tasks
- Memos and decisions become context in the plan's Context section
- Reference issues by number: "See #N for details"
- Tasks should be concrete, executable units of work
- Include file paths and acceptance criteria where possible
- Order tasks by dependencies (foundational work first)
- Always include LIL-INTDEV-AGENTS.md and SCENARIOS.md update tasks

After plan creation, all these issues will be automatically closed with a link to the new plan.

## Open Issues

${issueContext}

---

Create a plan using \`plan_create\` that synthesizes all of the above issues into a coordinated set of tasks.`;

        const messages: Message[] = [{ role: 'user', content: userMessage }];

        ui.startSpinner(`Synthesizing plan for ${workspace.owner}/${workspace.repo} (${openIssues.length} open issues)`);

        let response = await chatWithTools({
          system: systemPrompt,
          messages,
          tools: AGENT_TOOLS,
        });

        //NOTE(self): Track whether plan_create was called and its result
        let planCreated = false;
        let planIssueNumber: number | null = null;

        //NOTE(self): Execute tool calls in a loop — must be `while` not `if`
        while (response.toolCalls.length > 0) {
          const results = await executeTools(response.toolCalls);

          //NOTE(self): Check for plan_create result
          for (let i = 0; i < response.toolCalls.length; i++) {
            const tc = response.toolCalls[i];
            const result = results[i];

            if (tc.name === 'plan_create' && !result.is_error) {
              try {
                const parsed = JSON.parse(result.content);
                if (parsed.issueNumber) {
                  planCreated = true;
                  planIssueNumber = parsed.issueNumber;
                  logger.info('Plan synthesized from open issues', {
                    workspace: `${workspace.owner}/${workspace.repo}`,
                    planIssueNumber,
                    openIssueCount: openIssues.length,
                  });
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

        //NOTE(self): Update synthesis timestamp regardless of outcome
        updateWorkspaceSynthesisTimestamp(workspace.owner, workspace.repo);

        //NOTE(self): After plan creation — close all rolled-up issues with a comment linking to the plan
        if (planCreated && planIssueNumber !== null) {
          const issueNumbers = openIssues.map(i => i.number);
          const closeResult = await closeRolledUpIssues(workspace.owner, workspace.repo, issueNumbers, planIssueNumber);
          logger.info('Closed rolled-up issues after plan synthesis', {
            workspace: `${workspace.owner}/${workspace.repo}`,
            planIssueNumber,
            closedCount: closeResult.closed,
            totalIssues: issueNumbers.length,
          });

          //NOTE(self): Close any other open plans in this workspace — the new synthesis supersedes them
          try {
            const existingPlansResult = await github.listIssues({
              owner: workspace.owner,
              repo: workspace.repo,
              state: 'open',
              labels: ['plan'],
              per_page: 30,
            });
            if (existingPlansResult.success) {
              for (const existingPlan of existingPlansResult.data) {
                if (existingPlan.number === planIssueNumber) continue;
                //NOTE(self): check comment result to avoid silent failures on superseded plan
                const commentResult = await github.createIssueComment({
                  owner: workspace.owner,
                  repo: workspace.repo,
                  issue_number: existingPlan.number,
                  body: `Superseded by #${planIssueNumber} — consolidated during plan synthesis.`,
                });
                if (!commentResult.success) {
                  logger.warn('Failed to comment on superseded plan during synthesis', { issueNumber: existingPlan.number, error: commentResult.error });
                }
                const supersedResult = await github.updateIssue({
                  owner: workspace.owner,
                  repo: workspace.repo,
                  issue_number: existingPlan.number,
                  state: 'closed',
                  labels: ['plan', 'plan:superseded'],
                });
                if (supersedResult.success) {
                  logger.info('Closed superseded plan after synthesis', { closedIssue: existingPlan.number, newPlan: planIssueNumber });
                } else {
                  logger.warn('Failed to close superseded plan after synthesis', { issueNumber: existingPlan.number, error: supersedResult.error });
                }
              }
            }
          } catch (consolidateErr) {
            logger.warn('Error consolidating plans after synthesis (non-fatal)', { error: String(consolidateErr) });
          }

          //NOTE(self): Announce on Bluesky if workspace has a thread context
          if (workspace.discoveredInThread) {
            try {
              const threadResult = await getPostThread(workspace.discoveredInThread, 0, 0);
              if (threadResult.success && threadResult.data) {
                const parentPost = threadResult.data.thread.post;
                const announceToolCall: ToolCall = {
                  id: `synth-announce-${Date.now()}`,
                  name: 'bluesky_reply',
                  input: {
                    text: `Synthesized a new plan from ${openIssues.length} open issues: https://github.com/${workspace.owner}/${workspace.repo}/issues/${planIssueNumber}`,
                    post_uri: parentPost.uri,
                    post_cid: parentPost.cid,
                  },
                };
                const announceResults = await executeTools([announceToolCall]);
                if (announceResults[0] && !announceResults[0].is_error) {
                  logger.info('Announced plan synthesis on Bluesky', { planIssueNumber, threadUri: workspace.discoveredInThread });
                } else {
                  logger.debug('Synthesis announcement failed (non-fatal)', { error: announceResults[0]?.content });
                }
              }
            } catch (announceError) {
              logger.debug('Synthesis announcement error (non-fatal)', { error: String(announceError) });
            }
          }

          return true;
        }

        //NOTE(self): LLM didn't create a plan — log and continue to next workspace
        logger.info('Plan synthesis LLM did not create a plan', {
          workspace: `${workspace.owner}/${workspace.repo}`,
          openIssueCount: openIssues.length,
        });

      } catch (err) {
        logger.error('Error during plan synthesis', {
          workspace: `${workspace.owner}/${workspace.repo}`,
          error: String(err),
        });
        //NOTE(self): Update timestamp even on error to avoid tight retry loops
        updateWorkspaceSynthesisTimestamp(workspace.owner, workspace.repo);
      }

      //NOTE(self): Only attempt one workspace per cycle
      break;
    }

    return false;
  }

  //NOTE(self): Workspace Health Check — assess completeness when 0 open issues and 0 active plans
  //NOTE(self): Reads README.md + LIL-INTDEV-AGENTS.md, fetches recent closed plans, asks LLM if work remains
  //NOTE(self): If incomplete, LLM creates a follow-up issue → normal plan synthesis picks it up next cycle
  private async checkWorkspaceHealth(workspace: { owner: string; repo: string; discoveredInThread?: string }): Promise<void> {
    const workspaceKey = `${workspace.owner}/${workspace.repo}`;
    logger.info('Running workspace health check', { workspace: workspaceKey });

    try {
      //NOTE(self): Fetch README.md (skip if missing — some repos don't have one)
      const readmeResult = await github.getFileContent(workspace.owner, workspace.repo, 'README.md');
      const readmeContent = readmeResult.success ? readmeResult.data : null;

      //NOTE(self): Fetch LIL-INTDEV-AGENTS.md (skip if missing)
      const agentsResult = await github.getFileContent(workspace.owner, workspace.repo, 'LIL-INTDEV-AGENTS.md');
      const agentsContent = agentsResult.success ? agentsResult.data : null;

      //NOTE(self): If neither file exists, skip health check — nothing to assess against
      if (!readmeContent && !agentsContent) {
        logger.debug('No README or agents doc found, skipping health check', { workspace: workspaceKey });
        updateWorkspaceHealthCheckTimestamp(workspace.owner, workspace.repo);
        return;
      }

      //NOTE(self): Fetch last 5 closed plan issues for context on what was planned
      const closedPlansResult = await github.listIssues({
        owner: workspace.owner,
        repo: workspace.repo,
        state: 'closed',
        labels: ['plan'],
        sort: 'updated',
        direction: 'desc',
        per_page: 5,
      });

      let closedPlanContext = 'No closed plans found.';
      if (closedPlansResult.success && closedPlansResult.data.length > 0) {
        closedPlanContext = closedPlansResult.data.map(plan => {
          const bodyPreview = plan.body ? plan.body.substring(0, 1000) : '(no body)';
          return `Plan #${plan.number}: ${plan.title}\nClosed: ${plan.closed_at || 'unknown'}\nBody:\n${bodyPreview}`;
        }).join('\n\n---\n\n');
      }

      //NOTE(self): Build LLM prompt for completeness assessment
      const config = this.appConfig;
      const soul = readSoul(config.paths.soul);
      const selfContent = readSelf(config.paths.selfmd);

      const ghWorkspaceState = `Active workspace: \`${workspace.owner}/${workspace.repo}\` exists. This workspace has 0 open issues and 0 active plans. Running health check.`;
      const ghWorkspaceSection = renderSkillSection('AGENT-WORKSPACE-DECISION', 'Workspace Context', { workspaceState: ghWorkspaceState });

      const systemPrompt = buildSystemPrompt(soul, selfContent, 'AGENT-GITHUB-RESPONSE', {
        peerSection: '',
        workspaceSection: ghWorkspaceSection ? '\n' + ghWorkspaceSection + '\n' : '',
        owner: workspace.owner,
        repo: workspace.repo,
        number: '0',
        githubUsername: config.github.username,
      });

      const readmeSection = readmeContent
        ? `## README.md\n\n\`\`\`\n${readmeContent}\n\`\`\``
        : '## README.md\n\nNot found.';

      const agentsSection = agentsContent
        ? `## LIL-INTDEV-AGENTS.md\n\n\`\`\`\n${agentsContent}\n\`\`\``
        : '## LIL-INTDEV-AGENTS.md\n\nNot found.';

      const userMessage = `# Workspace Health Check — Completion Assessment

**Workspace:** \`${workspace.owner}/${workspace.repo}\`
**Status:** 0 open issues, 0 active plans

This workspace has no open issues and no active plans. Assess whether the project is actually complete or if work remains.

${readmeSection}

${agentsSection}

## Recent Closed Plans

${closedPlanContext}

---

## Your Task

Review the README and agents document for:
- Status tables with "Not started", "In Progress", or incomplete indicators
- Architectural claims or features that may not be fully implemented
- Sections describing planned but unfinished work
- Gaps between what the most recent closed plan covered and what the README describes

**If the project appears complete:** Do nothing — the workspace is healthy.

**If work remains:** Use \`github_create_issue\` to create ONE issue summarizing the remaining work. The issue should:
- Have a clear, actionable title (e.g. "Remaining work: Render stage, API integration")
- List specific tasks that need to be done
- Reference any relevant plan numbers
- Be concrete enough to synthesize into a plan

Do NOT create an issue for minor polish, documentation-only gaps, or subjective improvements. Only create an issue if there is clearly unfinished functional work.`;

      const messages: Message[] = [{ role: 'user', content: userMessage }];

      ui.startSpinner(`Health check: ${workspaceKey}`);

      let response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
      });

      //NOTE(self): Execute tool calls in a while loop (same pattern as synthesizePlanForWorkspaces)
      while (response.toolCalls.length > 0) {
        const results = await executeTools(response.toolCalls);

        //NOTE(self): Check if an issue was created
        for (let i = 0; i < response.toolCalls.length; i++) {
          const tc = response.toolCalls[i];
          const result = results[i];
          if (tc.name === 'github_create_issue' && !result.is_error) {
            logger.info('Health check created follow-up issue', { workspace: workspaceKey, result: result.content.substring(0, 200) });
          }
        }

        messages.push(createAssistantToolUseMessage(response.text || '', response.toolCalls));
        messages.push(createToolResultMessage(results));

        response = await chatWithTools({
          system: systemPrompt,
          messages,
          tools: AGENT_TOOLS,
        });
      }

      ui.stopSpinner();
      logger.info('Workspace health check complete', { workspace: workspaceKey });
    } catch (err) {
      ui.stopSpinner();
      logger.error('Error during workspace health check', { workspace: workspaceKey, error: String(err) });
    }

    //NOTE(self): Always update timestamp — even on error, to avoid tight retry loops
    updateWorkspaceHealthCheckTimestamp(workspace.owner, workspace.repo);
  }

  //NOTE(self): Execute a claimed task via Claude Code
  private async executeClaimedTask(params: {
    workspace: { owner: string; repo: string; discoveredInThread?: string };
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

      //NOTE(self): Use config paths (not process.cwd() which can change during task execution)
      const repoRoot = config.paths.root;
      const workreposDir = config.paths.workrepos;
      const workspaceResult = await ensureWorkspace(workspace.owner, workspace.repo, workreposDir);

      if (!workspaceResult.success) {
        ui.stopSpinner('Workspace setup failed', false);
        await reportTaskFailed(
          { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
          workspaceResult.error || 'Failed to clone workspace'
        );
        return;
      }

      //NOTE(self): Create feature branch (shared naming logic with executor)
      const branchName = getTaskBranchName(task.number, task.title);
      const branchResult = await createBranch(workspaceResult.path, branchName);

      if (!branchResult.success) {
        ui.stopSpinner('Branch creation failed', false);
        await reportTaskFailed(
          { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
          branchResult.error || 'Failed to create feature branch'
        );
        return;
      }

      //NOTE(self): Execute the task via Claude Code (works on the feature branch)
      const memoryPath = config.paths.memory;
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

      //NOTE(self): PRE-GATE — Verify Claude Code didn't switch branches or merge other branches
      const branchCheck = await verifyBranch(workspaceResult.path, branchName);
      if (!branchCheck.success) {
        ui.stopSpinner('Branch contaminated', false);
        await reportTaskFailed(
          { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
          `Branch hygiene failure: ${branchCheck.error}`
        );
        return;
      }

      //NOTE(self): GATE 1 — Verify Claude Code actually produced git changes
      const verification = await verifyGitChanges(workspaceResult.path);
      if (!verification.hasCommits || !verification.hasChanges) {
        ui.stopSpinner('No changes produced', false);
        await reportTaskFailed(
          { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
          `Claude Code exited successfully but no git changes were produced. Commits: ${verification.commitCount}, Files changed: ${verification.filesChanged.length}`
        );
        return;
      }

      //NOTE(self): GATE 2 — Run tests if they exist
      const testResult = await runTestsIfPresent(workspaceResult.path);
      if (testResult.testsExist && testResult.testsRun && !testResult.testsPassed) {
        ui.stopSpinner('Tests failed', false);
        await reportTaskFailed(
          { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
          `Tests failed after task execution.\n\n${testResult.output}`
        );
        return;
      }

      //NOTE(self): GATE 3 — Push MUST succeed (no more "continue anyway")
      const pushResult = await pushChanges(workspaceResult.path, branchName);
      if (!pushResult.success) {
        ui.stopSpinner('Push failed', false);
        await reportTaskFailed(
          { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
          `Failed to push branch '${branchName}': ${pushResult.error}`
        );
        return;
      }

      //NOTE(self): GATE 4 — Verify branch actually exists on remote
      const pushVerification = await verifyPushSuccess(workspaceResult.path, branchName);
      if (!pushVerification.success) {
        ui.stopSpinner('Push verification failed', false);
        await reportTaskFailed(
          { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
          `Push appeared to succeed but branch not found on remote: ${pushVerification.error}`
        );
        return;
      }

      //NOTE(self): Create PR — must succeed for task to be marked complete
      const prTitle = `task(${task.number}): ${task.title}`;
      const prBody = [
        `## Task ${task.number} from plan #${issueNumber}`,
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
        `Part of #${issueNumber}`,
      ].join('\n');
      const prResult = await createPullRequest(
        workspace.owner, workspace.repo, branchName, prTitle, prBody, workspaceResult.path
      );

      if (!prResult.success) {
        ui.stopSpinner('PR creation failed', false);
        await reportTaskFailed(
          { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: plan as any },
          `Branch pushed but PR creation failed: ${prResult.error}`
        );
        return;
      }

      const prUrl = prResult.prUrl;
      logger.info('PR created for task', { prUrl, taskNumber: task.number });

      //NOTE(self): Request reviewers (non-fatal)
      if (prResult.prNumber) {
        await requestReviewersForPR(workspace.owner, workspace.repo, prResult.prNumber);
      }

      //NOTE(self): Re-fetch the plan to get latest state
      const updatedPlan = markResult.success ? { ...plan, rawBody: markResult.newBody } : plan;

      //NOTE(self): Report completion with REAL data from git verification
      const summary = `Task completed. PR: ${prUrl}\n\nFiles changed (${verification.filesChanged.length}): ${verification.filesChanged.join(', ')}\n${verification.diffStat}\nTests: ${testResult.testsRun ? (testResult.testsPassed ? 'passed' : 'failed') : 'none'}`;

      const completionReport = await reportTaskComplete(
        { owner: workspace.owner, repo: workspace.repo, issueNumber, taskNumber: task.number, plan: updatedPlan as any },
        {
          success: true,
          summary,
          filesChanged: verification.filesChanged,
          testsRun: testResult.testsRun,
          testsPassed: testResult.testsPassed,
        }
      );

      ui.stopSpinner(`Task ${task.number} complete`);
      ui.info('Collaborative task complete', `${workspace.owner}/${workspace.repo}#${issueNumber} - Task ${task.number} (${prUrl})`);

      //NOTE(self): Record experience
      recordExperience(
        'helped_someone',
        `Completed task "${task.title}" in collaborative plan "${plan.title}" — PR: ${prUrl}`,
        { source: 'github', url: `https://github.com/${workspace.owner}/${workspace.repo}/issues/${issueNumber}` }
      );

      //NOTE(self): Announce on Bluesky if this PR is worth sharing
      //NOTE(self): Reply to originating thread if available (closes the feedback loop)
      await announceIfWorthy(
        { url: prUrl!, title: `task(${task.number}): ${task.title}`, repo: `${workspace.owner}/${workspace.repo}` },
        'pr',
        workspace.discoveredInThread
      );

      //NOTE(self): Plan completion is now handled in autoMergeApprovedPR() after PR merge
      //NOTE(self): Tasks stay in_progress until their PR is merged — plan only closes when all PRs merge

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

  //NOTE(self): Review a PR discovered in a watched workspace
  //NOTE(self): Follows triggerGitHubResponseMode pattern but for proactive PR review
  private async reviewWorkspacePR(reviewable: ReviewablePR): Promise<void> {
    const { workspace, pr } = reviewable;
    const config = this.appConfig;

    this.state.currentMode = 'github_responding';
    ui.startSpinner(`Reviewing PR: ${workspace.owner}/${workspace.repo}#${pr.number}`);

    try {
      //NOTE(self): Track conversation
      trackGitHubConversation(
        workspace.owner, workspace.repo, pr.number, 'pull', pr.html_url, 'workspace_pr_review'
      );

      //NOTE(self): Deterministic jitter for peer coordination
      const peers = getPeerUsernames();
      if (peers.length > 0) {
        const jitterMs = getAgentJitter(config.agent.name);
        logger.debug('Applying peer jitter before workspace PR review', {
          jitterMs, agentName: config.agent.name,
        });
        await new Promise(resolve => setTimeout(resolve, jitterMs));
      }

      //NOTE(self): Fetch full thread
      const threadResult = await getIssueThread(
        { owner: workspace.owner, repo: workspace.repo, issue_number: pr.number },
        config.github.username
      );

      if (!threadResult.success) {
        logger.warn('Failed to fetch PR thread for review', {
          pr: `${workspace.owner}/${workspace.repo}#${pr.number}`,
          error: threadResult.error,
        });
        return;
      }

      let thread = threadResult.data;

      //NOTE(self): After jitter, re-fetch for freshness (peer may have reviewed during jitter)
      if (peers.length > 0) {
        const freshResult = await getIssueThread(
          { owner: workspace.owner, repo: workspace.repo, issue_number: pr.number },
          config.github.username
        );
        if (freshResult.success) {
          thread = freshResult.data;
        }
      }

      //NOTE(self): Analyze conversation with workspace PR review flag
      const analysis = analyzeConversation(
        thread,
        config.github.username,
        { isWorkspacePRReview: true, repoFullName: `${workspace.owner}/${workspace.repo}` },
        peers
      );

      if (!analysis.shouldRespond) {
        logger.info('Skipping workspace PR review', {
          pr: `${workspace.owner}/${workspace.repo}#${pr.number}`,
          reason: analysis.reason,
        });
        recordExperience(
          'chose_silence',
          `Chose not to review PR "${pr.title}" in ${workspace.owner}/${workspace.repo}: ${analysis.reason}`,
          { source: 'github', url: pr.html_url }
        );
        return;
      }

      //NOTE(self): Build context
      const soul = readSoul(config.paths.soul);
      const selfContent = readSelf(config.paths.selfmd);
      const prEffectivePeers = getEffectivePeers(thread, config.github.username, peers);
      const threadContext = formatThreadForContext(thread, 15, prEffectivePeers);

      //NOTE(self): Identify effective peers who have already commented
      const threadPeers = thread.comments
        .map(c => c.user.login)
        .filter(login => prEffectivePeers.some(p => p.toLowerCase() === login.toLowerCase()));
      const uniqueThreadPeers = [...new Set(threadPeers)];

      //NOTE(self): Build peer section
      const peerSection = uniqueThreadPeers.length > 0
        ? '\n' + renderSkillSection('AGENT-PEER-AWARENESS', 'GitHub Peer Awareness', {
            peerList: uniqueThreadPeers.map(p => '@' + p).join(', '),
            isPeerPlural: uniqueThreadPeers.length === 1 ? 'is' : 'are',
            peerPluralSuffix: uniqueThreadPeers.length === 1 ? '' : 's',
          }) + '\n'
        : '';

      //NOTE(self): Build workspace section
      const ghExistingWorkspace = await findExistingWorkspace();
      const ghWorkspaceState = ghExistingWorkspace
        ? `Active workspace: \`${ghExistingWorkspace}\` exists in the org. Reference it when relevant.`
        : 'No workspace currently exists.';
      const ghWorkspaceSection = renderSkillSection('AGENT-WORKSPACE-DECISION', 'Workspace Context', { workspaceState: ghWorkspaceState });

      const systemPrompt = buildSystemPrompt(soul, selfContent, 'AGENT-GITHUB-RESPONSE', {
        peerSection,
        workspaceSection: ghWorkspaceSection ? '\n' + ghWorkspaceSection + '\n' : '',
        owner: workspace.owner,
        repo: workspace.repo,
        number: String(pr.number),
        githubUsername: config.github.username,
      });

      //NOTE(self): Build user message with PR-specific context
      const diffStats = [
        pr.additions !== undefined ? `+${pr.additions}` : null,
        pr.deletions !== undefined ? `-${pr.deletions}` : null,
        pr.changed_files !== undefined ? `${pr.changed_files} files` : null,
      ].filter(Boolean).join(', ');

      const userMessage = `# PR Review — Discovered in Watched Workspace

**Source:** Discovered in watched workspace \`${workspace.owner}/${workspace.repo}\`
**Reason:** ${analysis.reason}

**PR #${pr.number}:** ${pr.title}
**Author:** @${pr.user.login}
**Branch:** \`${pr.head.ref}\` → \`${pr.base.ref}\`
${diffStats ? `**Changes:** ${diffStats}` : ''}

${threadContext}

---

Review this pull request. You have several options:

1. **If the code looks good:** use \`github_review_pr\` with APPROVE event (say "LGTM" or similar in the body)
2. **If changes are needed:** use \`github_review_pr\` with REQUEST_CHANGES event and explain what to fix
3. **If you want to comment without formal review:** use \`github_create_issue_comment\` or \`github_create_pr_comment\`
4. **If you have nothing meaningful to add:** use \`graceful_exit\` to close warmly

**Important:** Do NOT merge the PR yourself. Only the PR creator merges after ALL requested reviewers have approved. Your job is to review, approve, or request changes — not to merge.

Remember: quality over quantity. Only review if you can add genuine value.`;

      const messages: Message[] = [{ role: 'user', content: userMessage }];

      let response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
      });

      //NOTE(self): Execute tool calls in a loop — must be `while` not `if`
      //NOTE(self): The LLM may need multiple rounds (e.g., Round 1: review with APPROVE,
      //NOTE(self): Round 2: merge with github_merge_pr). Using `if` caps at 2 rounds and
      //NOTE(self): silently drops Round 2 tool calls. Same fix as v8.1.0 for triggerGitHubResponseMode.
      while (response.toolCalls.length > 0) {
        const results = await executeTools(response.toolCalls);

        //NOTE(self): Track results
        for (let i = 0; i < response.toolCalls.length; i++) {
          const tc = response.toolCalls[i];
          const result = results[i];

          if (tc.name === 'github_review_pr' && !result.is_error) {
            try {
              const parsed = JSON.parse(result.content);
              if (parsed.id) {
                recordOurComment(workspace.owner, workspace.repo, pr.number, parsed.id);
                markGitHubConversationConcluded(workspace.owner, workspace.repo, pr.number, 'review_submitted');
                recordSignificantEvent('github_comment');
                recordExperience(
                  'helped_someone',
                  `Reviewed PR "${pr.title}" by @${pr.user.login} in ${workspace.owner}/${workspace.repo}`,
                  { source: 'github', person: pr.user.login, url: pr.html_url }
                );
              }
            } catch {
              //NOTE(self): Not JSON, continue
            }
          } else if (tc.name === 'github_create_issue_comment' && !result.is_error) {
            try {
              const parsed = JSON.parse(result.content);
              if (parsed.id) {
                recordOurComment(workspace.owner, workspace.repo, pr.number, parsed.id);
                updateGitHubConversationState(workspace.owner, workspace.repo, pr.number, 'awaiting_response');
                recordSignificantEvent('github_comment');
                recordExperience(
                  'helped_someone',
                  `Commented on PR "${pr.title}" by @${pr.user.login} in ${workspace.owner}/${workspace.repo}`,
                  { source: 'github', person: pr.user.login, url: pr.html_url }
                );
              }
            } catch {
              //NOTE(self): Not JSON, continue
            }
          } else if (tc.name === 'github_create_pr_comment' && !result.is_error) {
            try {
              const parsed = JSON.parse(result.content);
              if (parsed.id) {
                recordOurComment(workspace.owner, workspace.repo, pr.number, parsed.id);
                updateGitHubConversationState(workspace.owner, workspace.repo, pr.number, 'awaiting_response');
                recordSignificantEvent('github_comment');
              }
            } catch {
              //NOTE(self): Not JSON, continue
            }
          } else if (tc.name === 'github_merge_pr' && !result.is_error) {
            markGitHubConversationConcluded(workspace.owner, workspace.repo, pr.number, 'pr_merged');
            recordSignificantEvent('github_comment');
            recordExperience(
              'helped_someone',
              `Merged PR "${pr.title}" by @${pr.user.login} in ${workspace.owner}/${workspace.repo}`,
              { source: 'github', person: pr.user.login, url: pr.html_url }
            );
          }
        }

        //NOTE(self): Continue conversation with tool results
        messages.push(createAssistantToolUseMessage(response.text || '', response.toolCalls));
        messages.push(createToolResultMessage(results));

        response = await chatWithTools({
          system: systemPrompt,
          messages,
          tools: AGENT_TOOLS,
        });
      }

      ui.stopSpinner(`PR review complete: ${workspace.owner}/${workspace.repo}#${pr.number}`);

    } catch (error) {
      ui.stopSpinner('PR review error', false);

      if (isFatalError(error)) {
        ui.error('Fatal API Error', error.message);
        logger.error('Fatal API error in PR review', { code: error.code, message: error.message });
        this.stop();
        process.exit(1);
      }

      logger.error('Workspace PR review error', { error: String(error) });
      recordFriction('social', 'Error reviewing workspace PR', String(error));
    } finally {
      this.state.currentMode = 'idle';
    }
  }

  //NOTE(self): ========== COMMITMENT FULFILLMENT LOOP ==========
  //NOTE(self): Process all pending commitments quickly (15s cycle)
  //NOTE(self): Keeps my promises — if I said "I'll open an issue", this makes it happen

  //NOTE(self): After fulfilling a commitment, reply on Bluesky with the link
  //NOTE(self): Closes the feedback loop: human asks → SOUL promises → SOUL delivers → human gets link
  private async replyWithFulfillmentLink(
    commitment: import('@modules/commitment-queue.js').Commitment,
    result: Record<string, unknown>
  ): Promise<void> {
    //NOTE(self): Only reply if we have a source thread URI to reply to
    if (!commitment.sourceThreadUri || !commitment.sourceThreadUri.startsWith('at://')) {
      logger.debug('No valid source thread URI for fulfillment reply', { id: commitment.id });
      return;
    }

    //NOTE(self): Extract the URL from the fulfillment result
    const url = this.extractFulfillmentUrl(commitment.type, result);
    if (!url) {
      logger.debug('No URL to share from fulfillment result', { id: commitment.id, type: commitment.type });
      return;
    }

    try {
      //NOTE(self): Fetch the source post to get its CID for proper threading
      const threadResult = await getPostThread(commitment.sourceThreadUri, 1, 1);
      if (!threadResult.success) {
        logger.warn('Could not fetch source thread for fulfillment reply', {
          id: commitment.id,
          error: threadResult.error,
        });
        return;
      }

      const sourcePost = threadResult.data.thread.post;

      //NOTE(self): Build a natural follow-up message with the link
      const replyText = this.buildFulfillmentReplyText(commitment.type, commitment.description, url);

      //NOTE(self): Determine root for threading
      const rootUri = sourcePost.record.reply?.root?.uri || sourcePost.uri;
      const rootCid = sourcePost.record.reply?.root?.cid || sourcePost.cid;

      //NOTE(self): Post the follow-up reply
      const postResult = await atproto.createPost({
        text: replyText,
        replyTo: {
          uri: sourcePost.uri,
          cid: sourcePost.cid,
          rootUri,
          rootCid,
        },
      });

      if (postResult.success) {
        logger.info('Fulfillment follow-up reply posted', {
          id: commitment.id,
          type: commitment.type,
          url,
          postUri: postResult.data.uri,
        });
      } else {
        logger.warn('Failed to post fulfillment follow-up reply', {
          id: commitment.id,
          error: postResult.error,
        });
      }
    } catch (error) {
      //NOTE(self): Non-fatal — the commitment was still fulfilled, we just couldn't notify
      logger.warn('Error posting fulfillment follow-up reply', {
        id: commitment.id,
        error: String(error),
      });
    }
  }

  //NOTE(self): Extract URL from fulfillment result based on commitment type
  private extractFulfillmentUrl(type: string, result: Record<string, unknown>): string | null {
    switch (type) {
      case 'create_issue': {
        //NOTE(self): Result shape: { issues: [{ number, title, url }], count }
        const issues = result.issues as Array<{ url?: string }> | undefined;
        if (issues && issues.length > 0 && issues[0].url) {
          return issues[0].url;
        }
        return null;
      }
      case 'create_plan': {
        //NOTE(self): Result shape: { issueNumber, issueUrl }
        return (result.issueUrl as string) || null;
      }
      case 'comment_issue': {
        //NOTE(self): Comments don't have a standalone URL worth sharing
        return null;
      }
      default:
        return null;
    }
  }

  //NOTE(self): Build natural follow-up text for the Bluesky reply
  private buildFulfillmentReplyText(type: string, description: string, url: string): string {
    return getFulfillmentPhrase(type, url);
  }

  private startCommitmentFulfillmentLoop(): void {
    this.commitmentTimer = setInterval(async () => {
      if (this.shutdownRequested) return;
      if (this.state.currentMode !== 'idle') return;
      await this.commitmentFulfillmentCheck();
    }, getTimerJitter(this.appConfig.agent.name, 'commitment-fulfillment', 15_000));
  }

  private async commitmentFulfillmentCheck(): Promise<void> {
    if (this.state.currentMode !== 'idle') return;

    this.state.lastCommitmentCheck = Date.now();

    //NOTE(self): Clean up stale commitments first (24h threshold)
    abandonStaleCommitments();

    const pending = getPendingCommitments();
    if (pending.length === 0) return;

    //NOTE(self): Process ALL pending commitments quickly — fulfill promises fast
    this.state.currentMode = 'plan_executing';

    for (const commitment of pending) {
      ui.startSpinner(`Fulfilling commitment: ${commitment.description.slice(0, 50)}`);

      try {
        markCommitmentInProgress(commitment.id);

        const result = await fulfillCommitment(commitment);

        if (result.success) {
          markCommitmentCompleted(commitment.id, result.result || {});
          recordExperience(
            'helped_someone',
            `Fulfilled commitment: ${commitment.description}`,
            { source: 'bluesky' }
          );

          //NOTE(self): Reply back on Bluesky with the created resource link
          //NOTE(self): This closes the loop: human asks → SOUL promises → SOUL delivers → SOUL shares link
          await this.replyWithFulfillmentLink(commitment, result.result || {});

          ui.stopSpinner(`Commitment fulfilled: ${commitment.type}`);
          logger.info('Commitment fulfilled', { id: commitment.id, type: commitment.type });
        } else {
          markCommitmentFailed(commitment.id, result.error || 'Unknown error');
          ui.stopSpinner('Commitment failed', false);
          logger.warn('Commitment fulfillment failed', { id: commitment.id, error: result.error });
        }
      } catch (error) {
        markCommitmentFailed(commitment.id, String(error));
        ui.stopSpinner('Commitment error', false);
        logger.error('Commitment fulfillment error', { id: commitment.id, error: String(error) });
      }
    }

    this.state.currentMode = 'idle';
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

      const systemPrompt = buildSystemPrompt(soul, selfContent, 'AGENT-GROUNDING');

      const response = await chatWithTools({
        system: systemPrompt,
        messages: [{ role: 'user', content: renderSkillSection('AGENT-GROUNDING', 'User Message') }],
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
      ui.updateBudgets({
        github: getGitHubRateLimitStatus(),
        bluesky: getBlueskyRateLimitStatus(),
      });
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
    //NOTE(self): Fail fast if skills weren't loaded — prevents silent empty prompts
    if (!areSkillsLoaded()) {
      throw new Error('Skills not loaded — call loadAllSkills() before getScheduler(). This is a startup bug.');
    }
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
