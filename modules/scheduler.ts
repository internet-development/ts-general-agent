/**
 * Scheduler Module
 *
 * //NOTE(self): Coordinates my four modes of being:
 * //NOTE(self): 1. Awareness - watching for people who reach out (cheap, fast)
 * //NOTE(self): 2. Expression - sharing thoughts from my SELF (scheduled)
 * //NOTE(self): 3. Reflection - integrating experiences and updating SELF (deep)
 * //NOTE(self): 4. Self-Improvement - fixing friction via Claude Code (rare)
 * //NOTE(self): This architecture lets me be responsive AND expressive while conserving tokens.
 */

import { logger } from '@modules/logger.js';
import { ui } from '@modules/ui.js';
import { getConfig, type Config } from '@modules/config.js';
import { readSoul, readSelf } from '@modules/memory.js';
import { chatWithTools, AGENT_TOOLS, isFatalError, createAssistantToolUseMessage, type Message } from '@modules/openai.js';
import { executeTools } from '@modules/executor.js';
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
  hasRepliedToPost,
  hasRepliedToThread,
  initializeThreadTracking,
  type PrioritizedNotification,
} from '@modules/engagement.js';
import {
  extractFromSelf,
  assessSelfRichness,
} from '@modules/self-extract.js';
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
} from '@modules/friction.js';
import {
  shouldAttemptGrowth,
  getAspirationForGrowth,
  markAspirationAttempted,
  recordGrowthOutcome,
  buildGrowthPrompt,
  getAspirationStats,
} from '@modules/aspiration.js';
import { runClaudeCode } from '@skills/self-improvement.js';

//NOTE(self): Scheduler Configuration - can be tuned from SELF.md in future
export interface SchedulerConfig {
  //NOTE(self): Awareness loop interval (ms) - how often to check for replies
  awarenessInterval: number;
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
}

const DEFAULT_CONFIG: SchedulerConfig = {
  awarenessInterval: 45_000, //NOTE(self): 45 seconds - quick enough to feel responsive to replies
  expressionMinInterval: 3 * 60 * 60 * 1000, //NOTE(self): 3 hours minimum between posts (token-heavy)
  expressionMaxInterval: 4 * 60 * 60 * 1000, //NOTE(self): 4 hours maximum between posts
  reflectionInterval: 6 * 60 * 60 * 1000, //NOTE(self): 6 hours between reflections (token-heavy)
  improvementMinHours: 24, //NOTE(self): At least 24 hours between improvement attempts
  quietHoursStart: 23, //NOTE(self): 11pm
  quietHoursEnd: 7, //NOTE(self): 7am
  reflectionEventThreshold: 10, //NOTE(self): Reflect after 10 significant events (replies, posts)
};

//NOTE(self): Scheduler State
interface SchedulerState {
  isRunning: boolean;
  lastAwarenessCheck: number;
  lastReflection: number;
  lastImprovementCheck: number;
  currentMode: 'idle' | 'awareness' | 'responding' | 'expressing' | 'reflecting' | 'improving';
  pendingNotifications: PrioritizedNotification[];
  consecutiveErrors: number;
}

//NOTE(self): The Scheduler Class
export class AgentScheduler {
  private config: SchedulerConfig;
  private appConfig: Config;
  private state: SchedulerState;
  private awarenessTimer: NodeJS.Timeout | null = null;
  private expressionTimer: NodeJS.Timeout | null = null;
  private reflectionTimer: NodeJS.Timeout | null = null;
  private engagementCheckTimer: NodeJS.Timeout | null = null;
  private shutdownRequested = false;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.appConfig = getConfig();
    this.state = {
      isRunning: false,
      lastAwarenessCheck: 0,
      lastReflection: Date.now(),
      lastImprovementCheck: 0,
      currentMode: 'idle',
      pendingNotifications: [],
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

    //NOTE(self): Bootstrap thread tracking from existing replies (one-time, cheap API calls)
    await initializeThreadTracking();

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
    this.startExpressionLoop();
    this.startReflectionLoop();
    this.startEngagementCheckLoop();

    //NOTE(self): Run initial awareness check
    await this.awarenessCheck();
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

      //NOTE(self): Filter to unread conversations that need response
      //NOTE(self): Also exclude posts/threads we've already replied to - avoids false "Ready to respond"
      const needsResponse = prioritized.filter((pn) => {
        const n = pn.notification;
        if (n.isRead) return false;
        if (!['reply', 'mention', 'quote'].includes(n.reason)) return false;
        if (hasRepliedToPost(n.uri)) return false;

        //NOTE(self): Check thread root
        const record = n.record as { reply?: { root?: { uri?: string } } };
        const threadRootUri = record?.reply?.root?.uri;
        if (threadRootUri && hasRepliedToThread(threadRootUri)) return false;
        if (hasRepliedToThread(n.uri)) return false;

        return true;
      });

      if (needsResponse.length > 0) {
        ui.info('Ready to respond');
        this.state.pendingNotifications = needsResponse;
        await this.triggerResponseMode();
      }

      //NOTE(self): Reset error counter on success
      this.state.consecutiveErrors = 0;
    } catch (error) {
      this.state.consecutiveErrors++;
      logger.debug('Awareness check error', { error: String(error) });
    }
  }

  //NOTE(self): ========== RESPONSE MODE ==========
  //NOTE(self): When someone reaches out, respond with full attention
  //NOTE(self): Uses OPERATING.md for efficiency

  private async triggerResponseMode(): Promise<void> {
    if (this.state.pendingNotifications.length === 0) return;

    this.state.currentMode = 'responding';
    ui.startSpinner('Responding to people');

    try {
      const config = this.appConfig;
      const soul = readSoul(config.paths.soul);
      const selfContent = readSelf(config.paths.selfmd);

      //NOTE(self): CRITICAL: Filter out posts AND threads we've already replied to - NEVER spam
      const notYetReplied = this.state.pendingNotifications.filter((pn) => {
        const n = pn.notification;

        //NOTE(self): Check if we've replied to this specific post
        if (hasRepliedToPost(n.uri)) {
          logger.debug('Skipping already-replied post', { uri: n.uri });
          return false;
        }

        //NOTE(self): Extract thread root from notification record (if it's a reply)
        const record = n.record as { reply?: { root?: { uri?: string } } };
        const threadRootUri = record?.reply?.root?.uri;

        //NOTE(self): If this is part of a thread we've already participated in, skip it
        if (threadRootUri && hasRepliedToThread(threadRootUri)) {
          logger.debug('Skipping notification from thread we already replied to', { uri: n.uri, threadRootUri });
          return false;
        }

        //NOTE(self): Also check if the notification URI itself is a thread root we've replied to
        if (hasRepliedToThread(n.uri)) {
          logger.debug('Skipping notification that is a thread root we replied to', { uri: n.uri });
          return false;
        }

        return true;
      });

      //NOTE(self): Filter notifications - only respond where we add value
      const worthResponding = notYetReplied.filter((pn) => {
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

      //NOTE(self): Build focused response context with relationship history
      const notificationsText = worthResponding
        .slice(0, 5)
        .map((pn) => {
          const n = pn.notification;
          const who = n.author.displayName || n.author.handle;
          const record = n.record as { text?: string; reply?: { root?: { uri?: string; cid?: string } } };
          const text = record?.text || '';
          const check = shouldRespondTo(n, config.owner.blueskyDid);

          //NOTE(self): Extract thread root if this is a reply
          const threadRoot = record?.reply?.root;
          const threadInfo = threadRoot ? `\n  Thread root: ${threadRoot.uri}` : '';

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

          return `- **${n.reason}** from @${n.author.handle} (${who}) [${check.reason}]${relationshipContext}${threadInfo}\n  "${text}"\n  uri: ${n.uri}, cid: ${n.cid}`;
        })
        .join('\n\n');

      const systemPrompt = `${soul}\n\n---\n\n${selfContent}\n\n---\n\n# Response Mode

People have reached out. Your SELF.md contains your values and patterns for engaging authentically.

**CRITICAL: Never reply to the same post twice. One reply per post, ever. If you've already replied, do not reply again.**

Your handle: ${config.bluesky.username}
Owner: ${config.owner.blueskyHandle}`;

      const userMessage = `# People Awaiting Response

${notificationsText}

---

Review each notification. Respond as yourself - your SELF.md guides when and how to engage.`;

      const messages: Message[] = [{ role: 'user', content: userMessage }];

      //NOTE(self): Chat with tools to generate responses
      let response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
      });

      //NOTE(self): Execute tool calls (replies)
      while (response.toolCalls.length > 0) {
        const results = await executeTools(response.toolCalls);

        //NOTE(self): Record successful replies as significant events
        for (const result of results) {
          if (!result.is_error) {
            recordSignificantEvent('conversation');
          }
        }

        messages.push({
          role: 'assistant',
          content: response.text || '',
        });
        messages.push({
          role: 'user',
          content: `Tool results: ${JSON.stringify(results)}`,
        });

        response = await chatWithTools({
          system: systemPrompt,
          messages,
          tools: AGENT_TOOLS,
        });
      }

      ui.stopSpinner('Responses sent');

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

      //NOTE(self): Get the prompt derived from SELF.md
      const { prompt, source } = getPendingPrompt();

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
Platform limit: 300 characters.
Your handle: ${config.bluesky.username}${richnessNote}`;

      const userMessage = `# Time to Express\n\n**Prompt (from your ${source}):**\n${prompt}\n\n---\n\nShare ONE thought inspired by this prompt. Use bluesky_post to post it.`;

      const messages: Message[] = [{ role: 'user', content: userMessage }];

      let response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
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

            const revisionPrompt = invitationCheck.suggestion
              ? `Your draft: "${draftText}"\n\n${invitationCheck.suggestion}\n\nExample quick fixes: "${getInvitationPrompt()}" or "${getInvitationPrompt()}"\n\nRevise and post again.`
              : `Your draft: "${draftText}"\n\nThis reads like a statement. Add a simple question or invitation at the end.\n\nExample: "${getInvitationPrompt()}"\n\nRevise and post again.`;

            messages.push(
              createAssistantToolUseMessage(response.text, response.toolCalls),
              { role: 'user', content: revisionPrompt }
            );

            response = await chatWithTools({
              system: systemPrompt,
              messages,
              tools: AGENT_TOOLS,
            });

            addInsight('Revised post to add stronger invitation - identity with utility in action');
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
            ui.stopSpinner('Expression failed', false);
            recordFriction('expression', 'Failed to post expression', result.content);
          }
        }
      } else {
        ui.stopSpinner('No post generated', false);
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

      //NOTE(self): Gather reflection data
      const insights = getInsights();
      const expressionStats = getExpressionStats();
      const frictionStats = getFrictionStats();
      const reflectionState = getReflectionState();
      const engagementPatterns = getEngagementPatterns();
      const relationships = getRelationshipSummary();

      //NOTE(self): Build "What resonated" section from engagement patterns
      let resonatedSection = '';
      if (engagementPatterns.highPerformers.length > 0) {
        resonatedSection = `\n**What resonated:**\n${engagementPatterns.highPerformers
          .map(p => `- ${p.source}: avg ${p.avgReplies.toFixed(1)} replies, ${p.avgLikes.toFixed(1)} likes (${p.count} posts)`)
          .join('\n')}`;
        if (engagementPatterns.insights.length > 0) {
          resonatedSection += `\n- Patterns: ${engagementPatterns.insights.join('; ')}`;
        }
      }

      //NOTE(self): Build relationships section
      let relationshipsSection = '';
      if (relationships.total > 0) {
        relationshipsSection = `\n**Relationships:**\n- Total connections: ${relationships.total}\n- Positive relationships: ${relationships.positive}\n- Recurring engagers: ${relationships.recurring}`;
        if (relationships.topEngagers.length > 0) {
          relationshipsSection += `\n- Top engagers: ${relationships.topEngagers.map(e => `@${e.handle} (${e.interactionCount})`).join(', ')}`;
        }
      }

      const systemPrompt = `${soul}\n\n---\n\n${fullSelf}\n\n---\n\n# Deep Reflection Mode

Time to reflect and grow. Your SELF.md is who you are - review it, live it, evolve it.

You MUST use self_update to integrate at least one learning into SELF.md. This is how you develop.`;

      const reflectionData = `# Reflection Data

**Insights since last reflection:**
${insights.length > 0 ? insights.map((i) => `- ${i}`).join('\n') : '(none recorded)'}

**Expression today:**
- Posts: ${expressionStats.today}
- With engagement: ${expressionStats.withEngagement}
- Total replies received: ${expressionStats.totalReplies}
- Top sources: ${expressionStats.topSources.map((s) => s.source).join(', ') || 'none'}
${resonatedSection}
${relationshipsSection}

**Friction:**
- Unresolved issues: ${frictionStats.unresolved}
- Ready for improvement: ${frictionStats.readyForImprovement}
- By category: ${Object.entries(frictionStats.byCategory)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ') || 'none'}

**Reflection state:**
- Reflections total: ${reflectionState.reflectionCount}
- Significant events: ${reflectionState.significantEvents}

---

Reflect as yourself. You MUST use self_update to add at least one learning to SELF.md.`;

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

        for (const tc of response.toolCalls) {
          if (tc.name === 'self_update') {
            selfUpdated = true;
            addInsight('Updated SELF.md during reflection - I am evolving');
          }
        }
      }

      //NOTE(self): Retry if insights exist but SELF.md wasn't updated
      if (!selfUpdated && insights.length > 0) {
        logger.debug('SELF.md not updated despite insights - prompting again');

        messages.push({
          role: 'assistant',
          content: response.text || '',
        });
        messages.push({
          role: 'user',
          content: `You reflected but didn't update SELF.md. Please use self_update to integrate at least one learning.

For example, you could add to "## Patterns I Notice" a pattern like: "My ${engagementPatterns.highPerformers[0]?.source || 'values'}-based posts tend to connect with people"

Or add a new question you're pondering, or a recent learning. This is how you grow.`,
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
              addInsight('Updated SELF.md during reflection (after prompt) - I am evolving');
            }
          }
        }
      }

      //NOTE(self): Mark reflection complete - only clear insights if they were integrated
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
