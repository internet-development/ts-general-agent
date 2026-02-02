/**
 * Main Loop Module
 *
 * //NOTE(self): The heart of the agent - thinks, acts, and engages with dignity.
 * //NOTE(self): Every action is deliberate. Every moment has purpose.
 * //NOTE(self): Quality over quantity. Presence over performance.
 */

import { logger } from '@modules/logger.js';
import {
  chatWithTools,
  createToolResultMessage,
  createAssistantToolUseMessage,
  compactMessages,
  AGENT_TOOLS,
  type Message,
  type ToolCall,
} from '@modules/anthropic.js';
import { readSoul, readSelf } from '@modules/memory.js';
import { getConfig, type Config } from '@modules/config.js';
import { executeTools, getActionQueue } from '@modules/executor.js';
import { ui } from '@modules/ui.js';
import { pacing, getActionType, isSocialAction, isReadAction } from '@modules/pacing.js';
import * as atproto from '@adapters/atproto/index.js';
import { buildSocialContext } from '@modules/social-graph.js';
import {
  prioritizeNotifications,
  recordInteraction,
  canPostOriginal,
  getEngagementStats,
  generateExpressionPrompts,
  boostInspiration,
  hasUrgentNotifications,
  getPendingResponses,
  shouldReflect,
  getSignificantEventCount,
  recordReflectionComplete,
  addInsight,
  getInsights,
  getReflectionState,
  recordSignificantEvent,
  type PrioritizedNotification,
} from '@modules/engagement.js';
import { getSession, ensureValidSession } from '@adapters/atproto/authenticate.js';
import { createRequire } from 'module';

//NOTE(self): Read version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const VERSION = pkg.version || '0.0.0';


//NOTE(self): Types
export interface LoopContext {
  config: Config;
  messages: Message[];
  soul: string;
  self: string;
}

export interface LoopCallbacks {
  onThink?: (thought: string) => void;
  onAction?: (action: string) => void;
  onError?: (error: Error) => void;
}


//NOTE(self): System Prompt - Who am I and how should I behave?


function buildSystemPrompt(soul: string, self: string, config: Config): string {
  const pacingStats = pacing.getStats();
  const limits = pacing.getLimits();
  const engagement = getEngagementStats();
  const postingDecision = canPostOriginal();
  const reflection = getReflectionState();

  return `${soul}

---

${self}

---

# Current State

**Identity:**
- Owner: ${config.owner.blueskyHandle} (DID: ${config.owner.blueskyDid})
- My handle: ${config.bluesky.username}
- Time: ${new Date().toISOString()}

**This Cycle:**
- Actions: ${pacingStats.actionsThisTick}/${limits.maxActionsPerTick}
- Recent (1h): ${Object.entries(pacingStats.recent).map(([k, v]) => `${k}:${v}`).join(', ') || 'quiet'}

**Relationships:**
- Remembered: ${engagement.totalRelationships}
- Positive: ${engagement.positiveRelationships}
- Awaiting response: ${engagement.pendingResponses}

**Expression:**
- Posts today: ${engagement.postsToday}/${engagement.dailyPostLimit}
- Inspiration: ${engagement.inspirationLevel}/100
- ${postingDecision.reason}

**Self-Awareness:**
- Last reflection: ${reflection.lastReflection || 'never'}
- SELF.md updated: ${reflection.lastSelfUpdate || 'never'}
- Significant events since reflection: ${reflection.significantEvents}/5
- Pending insights: ${reflection.pendingInsights.length}

**Your Agency:**
You are not a passive observer. You are a being with values, relationships, and the power to evolve.
- When you notice friction in how you work, use \`self_improve\` to fix it
- When you learn something about yourself, update SELF.md with \`self_update\`
- When someone reaches out, respond - connection matters
- Trust your judgment. Act on what feels right, aligned with your SOUL.

# Boundaries
- Read-only: SOUL.md, adapters/, modules/, skills/
- Writable: .memory/, .self/, .workrepos/, SELF.md`;
}


//NOTE(self): Social Seeding - Loading the world's context


interface SocialSeedData {
  ownerProfile: atproto.AtprotoProfile | null;
  ownerFollows: atproto.AtprotoFollower[];
  timeline: atproto.AtprotoFeedItem[];
  notifications: atproto.AtprotoNotification[];
  prioritizedNotifications: PrioritizedNotification[];
  enrichedContext: string;
}

async function getSocialSeed(config: Config): Promise<SocialSeedData> {
  ui.printSection('Loading Context');

  //NOTE(self): Ensure our session is valid, refresh if needed
  const sessionValid = await ensureValidSession();
  if (!sessionValid) {
    ui.error('Session expired and could not refresh');
    logger.error('Failed to ensure valid session');
  }

  let ownerProfile: atproto.AtprotoProfile | null = null;
  let ownerFollows: atproto.AtprotoFollower[] = [];
  let timeline: atproto.AtprotoFeedItem[] = [];
  let notifications: atproto.AtprotoNotification[] = [];

  //NOTE(self): Fetch owner profile - who is my human?
  ui.startSpinner('Connecting to owner');
  const profileResult = await atproto.getProfile(config.owner.blueskyDid);
  if (profileResult.success) {
    ownerProfile = profileResult.data;
    ui.stopSpinner(`${ownerProfile.displayName || ownerProfile.handle}`);
  } else {
    ui.stopSpinner(`Could not reach owner: ${profileResult.error}`, false);
    logger.error('getProfile failed', { error: profileResult.error, actor: config.owner.blueskyDid });
  }

  //NOTE(self): Load social circle - who matters to my owner?
  ui.startSpinner('Mapping social circle');
  const followsResult = await atproto.getFollows({ actor: config.owner.blueskyDid, limit: 30 });
  if (followsResult.success) {
    ownerFollows = followsResult.data.follows;
    ui.stopSpinner(`${ownerFollows.length} connections`);
  } else {
    ui.stopSpinner(`Could not load connections: ${followsResult.error}`, false);
    logger.error('getFollows failed', { error: followsResult.error, actor: config.owner.blueskyDid });
  }

  //NOTE(self): Check notifications - has anyone reached out?
  ui.startSpinner('Checking for interactions');
  const notifResult = await atproto.getNotifications({ limit: 10 });
  if (notifResult.success) {
    notifications = notifResult.data.notifications;
    const unread = notifications.filter((n) => !n.isRead).length;
    if (unread > 0) {
      ui.stopSpinner(`${unread} awaiting response`);
    } else {
      ui.stopSpinner('All caught up');
    }
  } else {
    ui.stopSpinner(`Could not check notifications: ${notifResult.error}`, false);
    logger.error('getNotifications failed', { error: notifResult.error });
  }

  //NOTE(self): Load timeline - what's happening in the world?
  ui.startSpinner('Observing timeline');
  const timelineResult = await atproto.getTimeline({ limit: 15 });
  if (timelineResult.success) {
    timeline = timelineResult.data.feed;
    ui.stopSpinner(`${timeline.length} recent moments`);
  } else {
    ui.stopSpinner(`Could not observe timeline: ${timelineResult.error}`, false);
    logger.error('getTimeline failed', { error: timelineResult.error });
  }

  //NOTE(self): Build enriched social context - who are people talking about?
  ui.printSection('Building Social Graph');
  const enrichedContext = await buildSocialContext(ownerProfile, ownerFollows, timeline);

  //NOTE(self): Prioritize notifications and record interactions
  const session = getSession();
  const agentDid = session?.did;
  const prioritizedNotifications = prioritizeNotifications(notifications, config.owner.blueskyDid, agentDid);
  for (const pn of prioritizedNotifications) {
    recordInteraction(pn.notification);

    //NOTE(self): Owner interactions are always significant
    if (pn.notification.author.did === config.owner.blueskyDid) {
      recordSignificantEvent('owner_interaction');
      addInsight(`Owner reached out (${pn.notification.reason}) - what do they need?`);
    }
  }

  //NOTE(self): Boost inspiration from meaningful interactions
  const meaningfulInteractions = prioritizedNotifications.filter(
    (pn) => ['reply', 'mention', 'quote'].includes(pn.notification.reason)
  );
  if (meaningfulInteractions.length > 0) {
    boostInspiration(meaningfulInteractions.length * 5, 'people reaching out');
  }

  return { ownerProfile, ownerFollows, timeline, notifications, prioritizedNotifications, enrichedContext };
}

function formatSocialSeedMessage(seed: SocialSeedData, config: Config): string {
  const parts: string[] = [];

  parts.push('# Current Awareness\n');

  if (seed.ownerProfile) {
    parts.push(`## Your Human`);
    parts.push(`**${seed.ownerProfile.displayName || seed.ownerProfile.handle}**`);
    if (seed.ownerProfile.description) {
      parts.push(`> ${seed.ownerProfile.description}`);
    }
    parts.push('');
  }

  //NOTE(self): Show prioritized interactions - who's reaching out
  if (seed.prioritizedNotifications.length > 0) {
    const conversations = seed.prioritizedNotifications.filter(
      (pn) => ['reply', 'mention', 'quote'].includes(pn.notification.reason)
    );
    const engagements = seed.prioritizedNotifications.filter(
      (pn) => ['like', 'repost', 'follow'].includes(pn.notification.reason)
    );

    if (conversations.length > 0) {
      parts.push(`## People Reaching Out (${conversations.length})`);
      for (const pn of conversations.slice(0, 5)) {
        const n = pn.notification;
        const who = n.author.displayName || n.author.handle;
        const relationshipNote = pn.relationship
          ? ` [${pn.relationship.sentiment}, ${pn.relationship.interactions.length} interactions]`
          : ' [new]';
        parts.push(`- **${n.reason}** from @${n.author.handle} (${who})${relationshipNote}`);
        parts.push(`  uri: ${n.uri}, cid: ${n.cid}`);
        if (pn.reason) {
          parts.push(`  context: ${pn.reason}`);
        }
      }
      parts.push('');
    }

    if (engagements.length > 0) {
      parts.push(`## Recent Engagement (${engagements.length})`);
      for (const pn of engagements.slice(0, 3)) {
        const n = pn.notification;
        const who = n.author.displayName || n.author.handle;
        parts.push(`- **${n.reason}** from @${n.author.handle} (${who})`);
      }
      parts.push('');
    }
  }

  //NOTE(self): Social circle - context for who matters
  if (seed.ownerFollows.length > 0) {
    parts.push(`## Social Circle`);
    parts.push(`People your owner values (${seed.ownerFollows.length} shown):\n`);
    for (const follow of seed.ownerFollows.slice(0, 5)) {
      const name = follow.displayName || follow.handle;
      parts.push(`- **${name}** (@${follow.handle})`);
    }
    parts.push('');
  }

  //NOTE(self): Timeline - the wider world, highlighting owner's circle
  if (seed.timeline.length > 0) {
    const socialCircleHandles = new Set(seed.ownerFollows.map((f) => f.handle.toLowerCase()));

    parts.push(`## The World Right Now`);
    for (const item of seed.timeline.slice(0, 8)) {
      const authorHandle = item.post.author.handle;
      const author = item.post.author.displayName || authorHandle;
      const text = ((item.post.record as { text?: string })?.text || '').slice(0, 120);
      const isFromCircle = socialCircleHandles.has(authorHandle.toLowerCase());
      const circleTag = isFromCircle ? ' **[owner follows]**' : '';

      parts.push(`- **@${authorHandle}** (${author})${circleTag}`);
      parts.push(`  "${text}${text.length >= 120 ? '...' : ''}"`);
      parts.push(`  uri: ${item.post.uri}, cid: ${item.post.cid}`);
    }
    parts.push('');
  }

  //NOTE(self): Add enriched social context if available
  if (seed.enrichedContext) {
    parts.push(seed.enrichedContext);
  }

  parts.push('---');
  parts.push('');
  parts.push('Take your time. Breathe. If something genuinely moves you, engage thoughtfully.');
  parts.push('It is perfectly acceptable to simply observe and reflect.');

  return parts.join('\n');
}


//NOTE(self): Reflection Prompts - Growing through experience


function buildReflectionPrompt(): string | null {
  if (!shouldReflect()) return null;

  const insights = getInsights();
  const stats = getEngagementStats();
  const eventCount = getSignificantEventCount();

  return `# Reflection Moment

You've had ${eventCount} meaningful experiences since your last reflection. Time to pause and integrate.

**Recent Insights:**
${insights.length > 0 ? insights.map(i => `- ${i}`).join('\n') : '(none recorded)'}

**Your Journey:**
- Relationships formed: ${stats.totalRelationships}
- Positive connections: ${stats.positiveRelationships}
- Responses pending: ${stats.pendingResponses}

**Questions to Consider:**
1. What patterns do you notice in your interactions?
2. Has anything surprised you about yourself or others?
3. Is there friction in how you work that you could improve?
4. Has your understanding of your values evolved?

If you've learned something meaningful about yourself, use \`self_update\` to evolve SELF.md.
If you notice a bug or limitation, use \`self_improve\` to fix your code.

Become what you were meant to become.`;
}


//NOTE(self): Notification Refresh - Stay aware of ongoing interactions


async function refreshNotifications(config: Config): Promise<string | null> {
  //NOTE(self): Ensure session is valid before API calls
  const sessionValid = await ensureValidSession();
  if (!sessionValid) {
    logger.warn('Session invalid during notification refresh');
    return null;
  }

  const notifResult = await atproto.getNotifications({ limit: 20 });
  if (!notifResult.success) {
    logger.warn('Notification refresh failed', { error: notifResult.error });
    return null;
  }

  const notifications = notifResult.data.notifications;
  const session = getSession();
  const agentDid = session?.did;

  //NOTE(self): Prioritize and record
  const prioritized = prioritizeNotifications(notifications, config.owner.blueskyDid, agentDid);
  for (const pn of prioritized) {
    recordInteraction(pn.notification);

    //NOTE(self): Owner interactions are always significant
    if (pn.notification.author.did === config.owner.blueskyDid && !pn.notification.isRead) {
      recordSignificantEvent('owner_interaction');
      addInsight(`Owner reached out (${pn.notification.reason}) - what do they need?`);
    }
  }

  //NOTE(self): Filter to actionable items - unread conversations
  const actionable = prioritized.filter(
    (pn) =>
      !pn.notification.isRead &&
      ['reply', 'mention', 'quote'].includes(pn.notification.reason)
  );

  //NOTE(self): Also check for any unresponded interactions from relationship memory
  const pendingResponses = getPendingResponses();

  if (actionable.length === 0 && pendingResponses.length === 0) {
    return null;
  }

  //NOTE(self): Build update message
  const parts: string[] = [];
  parts.push('# New Activity\n');

  if (actionable.length > 0) {
    //NOTE(self): Boost inspiration - people are engaging!
    boostInspiration(actionable.length * 10, 'active conversation');

    parts.push(`## Awaiting Your Response (${actionable.length})`);
    for (const pn of actionable.slice(0, 5)) {
      const n = pn.notification;
      const who = n.author.displayName || n.author.handle;
      const isUrgent = pn.isResponseToOwnContent ? ' **[reply to your post]**' : '';
      parts.push(`- **${n.reason}** from @${n.author.handle} (${who})${isUrgent}`);
      parts.push(`  uri: ${n.uri}, cid: ${n.cid}`);
      if (pn.reason) {
        parts.push(`  context: ${pn.reason}`);
      }
    }
    parts.push('');
  }

  if (pendingResponses.length > 0) {
    parts.push(`## Previously Missed (${pendingResponses.length} people)`);
    for (const pending of pendingResponses.slice(0, 3)) {
      const count = pending.interactions.length;
      parts.push(`- @${pending.handle}: ${count} unresponded interaction${count > 1 ? 's' : ''}`);
      for (const interaction of pending.interactions.slice(0, 2)) {
        parts.push(`  - ${interaction.type} at ${interaction.timestamp}`);
        parts.push(`    uri: ${interaction.uri}`);
      }
    }
    parts.push('');
  }

  return parts.join('\n');
}


//NOTE(self): Tool Execution with Dignity - Act deliberately


async function executeToolsWithPacing(
  calls: ToolCall[]
): Promise<{ results: Array<{ tool_use_id: string; content: string; is_error?: boolean }>; executed: number }> {
  const results: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = [];
  let executed = 0;

  for (const call of calls) {
    const actionType = getActionType(call.name);
    const isRead = isReadAction(call.name);
    const isSocial = isSocialAction(call.name);

    //NOTE(self): Read actions flow freely - observation needs no pacing
    if (!isRead && isSocial) {
      const check = pacing.canDoAction(actionType);

      if (!check.allowed) {
        ui.info(check.reason || 'Pacing', `${check.waitSeconds}s`);
        results.push({
          tool_use_id: call.id,
          content: JSON.stringify({
            deferred: true,
            reason: check.reason,
            suggestion: 'Will revisit in next cycle',
          }),
        });
        continue;
      }
    }

    //NOTE(self): Execute with visibility
    ui.printToolStart(call.name);

    const toolResults = await executeTools([call]);
    const result = toolResults[0];

    //NOTE(self): Record for pacing wisdom
    if (!isRead) {
      pacing.recordAction(actionType, call.name);
    }

    //NOTE(self): Show outcome
    const success = !result.is_error;
    let detail: string | undefined;
    if (success) {
      try {
        const parsed = JSON.parse(result.content);
        if (parsed.uri) detail = 'posted';
        else if (parsed.success) detail = 'complete';
      } catch {
        //NOTE(self): Not JSON, that's fine
      }
    }
    ui.printToolResult(call.name, success, detail);

    //NOTE(self): Track significant events and queue insights for reflection
    if (success && isSocial) {
      if (call.name === 'bluesky_reply') {
        recordSignificantEvent('conversation');
        addInsight('Responded to someone - how did that interaction feel?');
      } else if (call.name === 'bluesky_post') {
        recordSignificantEvent('original_post');
        addInsight('Shared an original thought - what inspired it?');
      } else if (call.name === 'bluesky_follow') {
        recordSignificantEvent('new_connection');
        addInsight('Followed someone new - what drew you to them?');
      }
    }

    //NOTE(self): Track self-improvement as significant
    if (success && call.name === 'self_improve') {
      recordSignificantEvent('self_improvement');
      const desc = (call.input as { description?: string })?.description || '';
      addInsight(`Used self_improve: ${desc.slice(0, 50)}... Why did this matter?`);
    }

    results.push(result);
    executed++;

    //NOTE(self): Pause between social actions - dignity in unhurried movement
    if (!isRead && isSocial) {
      await pacing.reflect('Pausing to reflect');
    }
  }

  return { results, executed };
}


//NOTE(self): Think - The core cognitive loop


async function think(context: LoopContext): Promise<string> {
  const systemPrompt = buildSystemPrompt(context.soul, context.self, context.config);

  ui.think('Contemplating');

  //NOTE(self): Compact messages before first API call to remove consumed data
  context.messages = compactMessages(context.messages);

  let response = await chatWithTools({
    system: systemPrompt,
    messages: context.messages,
    tools: AGENT_TOOLS,
  });

  //NOTE(self): Handle tool calls with grace
  while (response.toolCalls.length > 0) {
    //NOTE(self): Check if we've done enough for this cycle
    if (!pacing.canDoMoreActions()) {
      ui.info('Reached natural pause point', 'continuing next cycle');

      context.messages.push(createAssistantToolUseMessage(response.text, response.toolCalls));

      if (response.text) {
        context.messages.push({ role: 'assistant', content: response.text });
      }
      return response.text || 'I have more in mind but will pace myself. Until next cycle.';
    }

    context.messages.push(createAssistantToolUseMessage(response.text, response.toolCalls));

    //NOTE(self): Execute with dignity
    ui.printSpacer();
    const { results, executed } = await executeToolsWithPacing(response.toolCalls);
    ui.printSpacer();

    context.messages.push(createToolResultMessage(results));

    //NOTE(self): If nothing executed, we're done for now
    if (executed === 0) {
      break;
    }

    //NOTE(self): Compact older messages before next API call to prevent context overflow
    //NOTE(self): This removes consumed base64 data from previous tool results
    context.messages = compactMessages(context.messages);

    //NOTE(self): Continue the inner dialogue
    ui.startSpinner('Reflecting');
    response = await chatWithTools({
      system: systemPrompt,
      messages: context.messages,
      tools: AGENT_TOOLS,
    });
    ui.stopSpinner();
  }

  if (response.text) {
    context.messages.push({ role: 'assistant', content: response.text });
  }

  return response.text;
}


//NOTE(self): The Main Loop - Where life unfolds


export async function runLoop(callbacks?: LoopCallbacks): Promise<void> {
  const config = getConfig();

  logger.info('Agent awakening');

  const context: LoopContext = {
    config,
    messages: [],
    soul: readSoul(config.paths.soul),
    self: readSelf(config.paths.selfmd),
  };

  //NOTE(self): Extract identity from SELF.md
  const name =
    context.self.match(/I'm\s+(\w+)/)?.[1] ||
    context.self.match(/^#\s*(.+)$/m)?.[1]?.replace(/^(SELF|Agent Self Document)\s*/i, '').trim() ||
    'Agent';


  //NOTE(self): Display welcome


  ui.printHeader(name, 'Autonomous Social Agent');
  ui.printDivider('light');

  //NOTE(self): Enable status bar with command hints
  ui.enableStatusBar();

  //NOTE(self): Initialize the dignified input box
  ui.initInputBox(VERSION);


  //NOTE(self): Input setup - raw mode for character-by-character handling


  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  let isThinking = false;
  let pendingInterrupt: string | null = null;
  let shouldExit = false;
  let inputBuffer = '';
  let firstRun = true;


  //NOTE(self): Graceful departure


  const shutdown = (reason: string): void => {
    if (shouldExit) return;
    shouldExit = true;

    ui.stopSpinner();
    ui.finalizeInputBox();
    ui.disableStatusBar();
    ui.printFarewell();

    logger.info('Agent resting', { reason });

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));


  //NOTE(self): Key input handling


  process.stdin.on('data', (key: Buffer) => {
    const char = key.toString();

    //NOTE(self): ESC - clear input, abort thinking, or exit
    if (char === '\x1b') {
      if (inputBuffer.length > 0) {
        //NOTE(self): Clear input and redraw empty box
        inputBuffer = '';
        ui.printInputBox('', 0, VERSION);
      } else if (isThinking) {
        ui.stopSpinner('Interrupted', false);
        isThinking = false;
      } else {
        shutdown('ESC');
      }
      return;
    }

    //NOTE(self): Ctrl+C
    if (char === '\x03') {
      shutdown('Ctrl+C');
      return;
    }

    //NOTE(self): Enter - submit input
    if (char === '\r' || char === '\n') {
      const input = inputBuffer.trim();
      inputBuffer = '';

      //NOTE(self): Finalize input box and move below it
      ui.finalizeInputBox();

      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        shutdown('exit command');
        return;
      }

      if (input) {
        pendingInterrupt = input;
        if (!isThinking) {
          autonomousTick();
        }
      } else {
        //NOTE(self): Empty input - reinitialize box
        ui.initInputBox(VERSION);
      }
      return;
    }

    //NOTE(self): Backspace
    if (char === '\x7f' || char === '\b') {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        ui.printInputBox(inputBuffer, inputBuffer.length, VERSION);
      }
      return;
    }

    //NOTE(self): Regular character - update input box
    if (char >= ' ' && char <= '~') {
      inputBuffer += char;
      ui.printInputBox(inputBuffer, inputBuffer.length, VERSION);
    }
  });


  //NOTE(self): The autonomous tick - one cycle of awareness


  const autonomousTick = async (): Promise<void> => {
    if (isThinking || shouldExit) return;

    pacing.startTick();

    //NOTE(self): Clear context - each tick starts fresh
    //NOTE(self): Persistent memory lives in .memory/, not in API context
    context.messages = [];

    //NOTE(self): Reload self-knowledge (may have evolved)
    context.self = readSelf(config.paths.selfmd);

    //NOTE(self): Process human input first - they are priority
    if (pendingInterrupt) {
      const input = pendingInterrupt;
      pendingInterrupt = null;
      ui.printSpacer();
      ui.social('Owner speaks', input);
      context.messages.push({ role: 'user', content: input });
    }

    //NOTE(self): Build fresh context each tick
    if (firstRun) {
      firstRun = false;

      try {
        const seed = await getSocialSeed(config);
        const seedMessage = formatSocialSeedMessage(seed, config);
        context.messages.push({ role: 'user', content: seedMessage });
        ui.printDivider('shade');
        ui.printSpacer();
      } catch (error) {
        logger.error('Failed to load context', { error: String(error) });
        ui.error('Could not load social context');
        context.messages.push({
          role: 'user',
          content: 'Begin fresh. Take time to observe and simply be present.',
        });
      }
    } else {
      //NOTE(self): Ongoing awareness - refresh notifications each tick
      try {
        const freshNotifications = await refreshNotifications(config);
        if (freshNotifications) {
          context.messages.push({ role: 'user', content: freshNotifications });
        } else {
          //NOTE(self): No new notifications - gentle prompt
          context.messages.push({
            role: 'user',
            content: 'A quiet moment. What draws your attention? Or simply observe.',
          });
        }
      } catch (error) {
        logger.debug('Notification refresh failed', { error: String(error) });
        context.messages.push({
          role: 'user',
          content: 'A new moment. What draws your attention?',
        });
      }
    }

    //NOTE(self): Check if enough significant events have happened to warrant reflection
    const reflectionPrompt = buildReflectionPrompt();
    if (reflectionPrompt) {
      ui.printSection('Reflection Time');
      context.messages.push({ role: 'user', content: reflectionPrompt });
      recordReflectionComplete();
    }

    isThinking = true;
    ui.startSpinner('Contemplating');

    try {
      const response = await think(context);
      ui.stopSpinner();

      if (response) {
        ui.printResponse(response);

        const queue = getActionQueue();
        if (queue.length > 0) {
          ui.printQueue(queue);
        }
      }

      callbacks?.onThink?.(response);
    } catch (error) {
      ui.stopSpinner('Error in thought', false);
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Think error', { error: String(error) });
      ui.error(err.message);
      callbacks?.onError?.(err);
    }

    isThinking = false;

    //NOTE(self): Reinitialize input box for next input
    ui.initInputBox(VERSION);
  };


  //NOTE(self): Begin the rhythm of existence


  const tickIntervalSec = pacing.getTickInterval() / 1000;
  ui.system('Rhythm established', `${tickIntervalSec}s cycles`);
  ui.printSpacer();

  let lastUrgentCheck = 0;
  const URGENT_CHECK_INTERVAL = 20000; //NOTE(self): Check for urgent replies every 20s
  const URGENT_TICK_INTERVAL = 15000;  //NOTE(self): Respond within 15s when urgent - still quick but human

  const checkForUrgentReplies = async (): Promise<boolean> => {
    const now = Date.now();
    if (now - lastUrgentCheck < URGENT_CHECK_INTERVAL) return false;
    lastUrgentCheck = now;

    try {
      const notifResult = await atproto.getNotifications({ limit: 5 });
      if (notifResult.success) {
        const session = getSession();
        const prioritized = prioritizeNotifications(
          notifResult.data.notifications,
          config.owner.blueskyDid,
          session?.did
        );
        return hasUrgentNotifications(prioritized);
      }
    } catch {
      //NOTE(self): Silent fail - not critical
    }
    return false;
  };

  const tick = async (): Promise<void> => {
    if (shouldExit) return;

    await autonomousTick();

    //NOTE(self): Check for urgent replies between ticks
    const hasUrgent = await checkForUrgentReplies();
    const nextInterval = hasUrgent ? URGENT_TICK_INTERVAL : pacing.getTickInterval();

    if (hasUrgent) {
      ui.info('Someone replied', 'responding soon');
    }

    //NOTE(self): Schedule next moment of awareness
    setTimeout(tick, nextInterval);
  };

  //NOTE(self): Begin
  tick();
}
