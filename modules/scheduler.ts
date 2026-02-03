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
import { readSoul, readSelf, readOperating, writeOperating } from '@modules/memory.js';
import { chatWithTools, AGENT_TOOLS, type Message } from '@modules/openai.js';
import { executeTools } from '@modules/executor.js';
import { pacing } from '@modules/pacing.js';
import * as atproto from '@adapters/atproto/index.js';
import { getSession, ensureValidSession } from '@adapters/atproto/authenticate.js';
import {
  prioritizeNotifications,
  recordInteraction,
  hasUrgentNotifications,
  recordSignificantEvent,
  addInsight,
  getInsights,
  getReflectionState,
  recordReflectionComplete,
  generateOperating,
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
}

const DEFAULT_CONFIG: SchedulerConfig = {
  awarenessInterval: 45_000, //NOTE(self): 45 seconds - quick enough to feel responsive
  expressionMinInterval: 90 * 60 * 1000, //NOTE(self): 90 minutes minimum
  expressionMaxInterval: 120 * 60 * 1000, //NOTE(self): 120 minutes maximum
  reflectionInterval: 4 * 60 * 60 * 1000, //NOTE(self): 4 hours
  improvementMinHours: 12, //NOTE(self): At least 12 hours between improvement attempts
  quietHoursStart: 23, //NOTE(self): 11pm
  quietHoursEnd: 7, //NOTE(self): 7am
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
      const needsResponse = prioritized.filter(
        (pn) =>
          !pn.notification.isRead &&
          ['reply', 'mention', 'quote'].includes(pn.notification.reason)
      );

      if (needsResponse.length > 0) {
        ui.info('People reaching out', `${needsResponse.length} awaiting response`);
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
      const operating = readOperating(config.paths.operating) || readSelf(config.paths.selfmd);

      //NOTE(self): Build focused response context
      const notificationsText = this.state.pendingNotifications
        .slice(0, 5)
        .map((pn) => {
          const n = pn.notification;
          const who = n.author.displayName || n.author.handle;
          const text = (n.record as { text?: string })?.text || '';
          return `- **${n.reason}** from @${n.author.handle} (${who})\n  "${text}"\n  uri: ${n.uri}, cid: ${n.cid}`;
        })
        .join('\n\n');

      const systemPrompt = `${soul}\n\n---\n\n${operating}\n\n---\n\n# Response Mode\n\nPeople have reached out to you. Respond thoughtfully and authentically.\n\nYour handle: ${config.bluesky.username}\nOwner: ${config.owner.blueskyHandle}`;

      const userMessage = `# People Awaiting Response\n\n${notificationsText}\n\n---\n\nRespond to those who've reached out. Be genuine. Use bluesky_reply for each response.`;

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
    } catch (error) {
      ui.stopSpinner('Response error', false);
      logger.error('Response mode error', { error: String(error) });
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
      const operating = readOperating(config.paths.operating) || selfContent;

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

      const systemPrompt = `${soul}\n\n---\n\n${operating}\n\n---\n\n# Expression Mode\n\nYou're sharing a thought on Bluesky. Be authentic to your SELF.\nMax 300 characters. No hashtags unless genuinely relevant.\nYour handle: ${config.bluesky.username}${richnessNote}`;

      const userMessage = `# Time to Express\n\n**Prompt (from your ${source}):**\n${prompt}\n\n---\n\nShare ONE thought inspired by this prompt. Use bluesky_post to post it.`;

      const messages: Message[] = [{ role: 'user', content: userMessage }];

      const response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
      });

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
      logger.error('Expression cycle error', { error: String(error) });
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

      //NOTE(self): Also check for self-improvement opportunity
      if (shouldAttemptImprovement(this.config.improvementMinHours)) {
        if (this.state.currentMode === 'idle') {
          await this.improvementCycle();
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

      const systemPrompt = `${soul}\n\n---\n\n${fullSelf}\n\n---\n\n# Deep Reflection Mode\n\nThis is time for genuine self-reflection. You have full access to your SELF.md.\n\nConsider:\n1. What patterns do you notice in your interactions?\n2. Has anything surprised you about yourself?\n3. Is there friction in how you work?\n4. How have your values been expressed or challenged?\n\nYou may update SELF.md with self_update if you've genuinely learned something.`;

      const reflectionData = `# Reflection Data

**Insights since last reflection:**
${insights.length > 0 ? insights.map((i) => `- ${i}`).join('\n') : '(none recorded)'}

**Expression today:**
- Posts: ${expressionStats.today}
- With engagement: ${expressionStats.withEngagement}
- Total replies received: ${expressionStats.totalReplies}
- Top sources: ${expressionStats.topSources.map((s) => s.source).join(', ') || 'none'}

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

Take time to integrate these experiences. What have you learned? How have you grown?`;

      const messages: Message[] = [{ role: 'user', content: reflectionData }];

      const response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
      });

      //NOTE(self): Execute any tool calls (self_update, memory_write, etc.)
      if (response.toolCalls.length > 0) {
        const results = await executeTools(response.toolCalls);

        for (const tc of response.toolCalls) {
          if (tc.name === 'self_update') {
            addInsight('Updated SELF.md during reflection - I am evolving');
          }
        }
      }

      //NOTE(self): Always regenerate OPERATING.md after reflection
      const updatedSelf = readSelf(config.paths.selfmd);
      if (updatedSelf) {
        const newOperating = generateOperating(updatedSelf);
        writeOperating(config.paths.operating, newOperating);
      }

      //NOTE(self): Mark reflection complete
      recordReflectionComplete();

      ui.stopSpinner('Reflection complete');

      if (response.text) {
        ui.contemplate(response.text.slice(0, 200) + (response.text.length > 200 ? '...' : ''));
      }
    } catch (error) {
      ui.stopSpinner('Reflection error', false);
      logger.error('Reflection cycle error', { error: String(error) });
      recordFriction('understanding', 'Reflection cycle failed', String(error));
    } finally {
      this.state.currentMode = 'idle';
    }
  }

  //NOTE(self): ========== SELF-IMPROVEMENT LOOP ==========
  //NOTE(self): Triggered by accumulated friction
  //NOTE(self): Uses Claude Code for actual changes

  private async improvementCycle(): Promise<void> {
    const friction = getFrictionReadyForImprovement();
    if (!friction) return;

    this.state.currentMode = 'improving';
    this.state.lastImprovementCheck = Date.now();
    ui.startSpinner(`Self-improving: ${friction.category}`);

    try {
      //NOTE(self): Mark as attempted before starting
      markFrictionAttempted(friction.id);

      //NOTE(self): Build the improvement prompt
      const prompt = buildImprovementPrompt(friction);

      //NOTE(self): Get repo root from config
      const repoRoot = process.cwd();
      const memoryPath = `${repoRoot}/.memory`;

      //NOTE(self): Run Claude Code
      ui.info('Invoking Claude Code', friction.description.slice(0, 50));
      const result = await runClaudeCode(prompt, repoRoot, memoryPath);

      if (result.success) {
        recordImprovementOutcome(friction.id, 'success', result.output?.slice(0, 500) || 'Changes made');
        addInsight(`Fixed friction: ${friction.description} - I am growing`);
        ui.stopSpinner('Self-improvement complete');
      } else {
        recordImprovementOutcome(friction.id, 'failed', result.error || 'Unknown error');
        ui.stopSpinner('Self-improvement failed', false);
      }
    } catch (error) {
      recordImprovementOutcome(friction.id, 'failed', String(error));
      ui.stopSpinner('Self-improvement error', false);
      logger.error('Improvement cycle error', { error: String(error) });
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

    for (const expression of needsCheck) {
      try {
        //NOTE(self): Get thread to check engagement
        //NOTE(self): For now, we'd need to implement getPostThread in atproto adapter
        //NOTE(self): This is a placeholder for the engagement feedback loop
        logger.debug('Would check engagement for', { uri: expression.postUri });

        //NOTE(self): TODO: Implement actual engagement checking
        //NOTE(self): For now, mark as checked with placeholder data
        updateExpressionEngagement(expression.postUri, {
          likes: 0,
          replies: 0,
          reposts: 0,
        });
      } catch (error) {
        logger.debug('Engagement check failed', { uri: expression.postUri, error: String(error) });
      }
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
