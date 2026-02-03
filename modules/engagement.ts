/**
 * Engagement Module
 *
 * //NOTE(self): Thoughtful engagement that exceeds human capability.
 * //NOTE(self): Post from the heart, respond with care, remember relationships.
 * //NOTE(self): Replied URIs and relationships persist to .memory/ so I remember across restarts.
 */

import type { AtprotoNotification } from '@adapters/atproto/types.js';
import { getPostThread } from '@adapters/atproto/get-post-thread.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';


//NOTE(self): Types


interface RelationshipRecord {
  handle: string;
  did: string;
  displayName?: string;
  interactions: InteractionRecord[];
  firstSeen: string;
  lastInteraction: string;
  sentiment: 'positive' | 'neutral' | 'unknown';
  responded: boolean;
}

interface InteractionRecord {
  type: 'like' | 'reply' | 'mention' | 'follow' | 'repost' | 'quote';
  uri: string;
  timestamp: string;
  responded: boolean;
  responseUri?: string;
}

interface PostingState {
  lastOriginalPost: string | null;
  lastReflection: string | null;
  postsToday: number;
  dailyPostLimit: number;
  inspirationLevel: number;
}

interface ReflectionState {
  lastReflection: string | null;
  reflectionCount: number;
  lastSelfUpdate: string | null;
  pendingInsights: string[];
  significantEvents: number;
}

interface EngagementState {
  relationships: Record<string, RelationshipRecord>;
  posting: PostingState;
  reflection: ReflectionState;
  lastStateUpdate: string;
  todayStart: string;
}


//NOTE(self): Persistent tracking - survives restarts

//NOTE(self): Path to tracking files
const REPLIED_URIS_PATH = '.memory/replied_uris.json';
const REPLIED_THREADS_PATH = '.memory/replied_threads.json';
const RELATIONSHIPS_PATH = '.memory/relationships.json';

//NOTE(self): Track which post URIs we've replied to (prevents multiple replies to same post)
//NOTE(self): Persisted to disk so I remember across restarts
let repliedToPostUris: Set<string> | null = null;

//NOTE(self): CRITICAL: Track which THREADS we've participated in (prevents spam in same thread)
//NOTE(self): A thread is identified by its root URI - if we've replied anywhere in a thread, don't reply again
let repliedToThreads: Set<string> | null = null;

function loadRepliedUris(): Set<string> {
  if (repliedToPostUris !== null) return repliedToPostUris;

  try {
    if (existsSync(REPLIED_URIS_PATH)) {
      const data = JSON.parse(readFileSync(REPLIED_URIS_PATH, 'utf-8'));
      repliedToPostUris = new Set(data.uris || []);
      logger.debug('Loaded replied URIs', { count: repliedToPostUris.size });
    } else {
      repliedToPostUris = new Set();
    }
  } catch (err) {
    logger.error('Failed to load replied URIs', { error: String(err) });
    repliedToPostUris = new Set();
  }
  return repliedToPostUris;
}

function loadRepliedThreads(): Set<string> {
  if (repliedToThreads !== null) return repliedToThreads;

  try {
    if (existsSync(REPLIED_THREADS_PATH)) {
      const data = JSON.parse(readFileSync(REPLIED_THREADS_PATH, 'utf-8'));
      repliedToThreads = new Set(data.threads || []);
      logger.debug('Loaded replied threads', { count: repliedToThreads.size });
    } else {
      repliedToThreads = new Set();
    }
  } catch (err) {
    logger.error('Failed to load replied threads', { error: String(err) });
    repliedToThreads = new Set();
  }
  return repliedToThreads;
}

function saveRepliedUris(): void {
  try {
    const dir = dirname(REPLIED_URIS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const uris = loadRepliedUris();
    //NOTE(self): Keep ALL replied URIs - never respond to the same post twice
    const urisArray = Array.from(uris);
    writeFileSync(REPLIED_URIS_PATH, JSON.stringify({ uris: urisArray, lastUpdated: new Date().toISOString() }, null, 2));
  } catch (err) {
    logger.error('Failed to save replied URIs', { error: String(err) });
  }
}

function saveRepliedThreads(): void {
  try {
    const dir = dirname(REPLIED_THREADS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const threads = loadRepliedThreads();
    const threadsArray = Array.from(threads);
    writeFileSync(REPLIED_THREADS_PATH, JSON.stringify({ threads: threadsArray, lastUpdated: new Date().toISOString() }, null, 2));
  } catch (err) {
    logger.error('Failed to save replied threads', { error: String(err) });
  }
}

export function hasRepliedToPost(postUri: string): boolean {
  return loadRepliedUris().has(postUri);
}

//NOTE(self): CRITICAL: Check if we've already participated in this thread
export function hasRepliedToThread(threadRootUri: string): boolean {
  return loadRepliedThreads().has(threadRootUri);
}

export function markPostReplied(postUri: string, threadRootUri?: string): void {
  loadRepliedUris().add(postUri);
  saveRepliedUris();

  //NOTE(self): Also mark the thread as participated
  if (threadRootUri) {
    loadRepliedThreads().add(threadRootUri);
    saveRepliedThreads();
    logger.debug('Marked thread as replied', { postUri, threadRootUri });
  }
}

//NOTE(self): Bootstrap thread tracking from existing replied URIs
//NOTE(self): This runs on startup if replied_threads.json doesn't exist
//NOTE(self): Uses cheap API calls to resolve thread roots for posts we've already replied to
export async function initializeThreadTracking(): Promise<void> {
  //NOTE(self): Skip if thread tracking file already exists
  if (existsSync(REPLIED_THREADS_PATH)) {
    logger.debug('Thread tracking already initialized', { path: REPLIED_THREADS_PATH });
    return;
  }

  const repliedUris = loadRepliedUris();
  if (repliedUris.size === 0) {
    logger.debug('No replied URIs to bootstrap thread tracking from');
    return;
  }

  logger.info('Bootstrapping thread tracking from existing replies', { count: repliedUris.size });

  const threads = loadRepliedThreads();
  let resolved = 0;
  let failed = 0;

  for (const uri of repliedUris) {
    try {
      //NOTE(self): Fetch the post thread to find its root
      const threadResult = await getPostThread(uri);

      if (threadResult.success) {
        const post = threadResult.data.thread.post;

        //NOTE(self): If the post is a reply, use its root; otherwise it IS the root
        if (post.record.reply?.root?.uri) {
          threads.add(post.record.reply.root.uri);
        } else {
          threads.add(post.uri);
        }
        resolved++;
      } else {
        //NOTE(self): Post may have been deleted or account blocked - use the URI itself as fallback
        threads.add(uri);
        failed++;
        logger.debug('Could not fetch thread for replied post', { uri, error: threadResult.error });
      }

      //NOTE(self): Rate limit - don't hammer the API
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      //NOTE(self): On error, still add the URI itself as a fallback thread root
      threads.add(uri);
      failed++;
      logger.warn('Error bootstrapping thread for URI', { uri, error: String(err) });
    }
  }

  saveRepliedThreads();
  logger.info('Thread tracking bootstrap complete', { resolved, failed, totalThreads: threads.size });
}

function getDefaultState(): EngagementState {
  const now = new Date();
  return {
    relationships: {},
    posting: {
      lastOriginalPost: null,
      lastReflection: null,
      postsToday: 0,
      dailyPostLimit: 12,
      inspirationLevel: 50,
    },
    reflection: {
      lastReflection: null,
      reflectionCount: 0,
      lastSelfUpdate: null,
      pendingInsights: [],
      significantEvents: 0,
    },
    lastStateUpdate: now.toISOString(),
    todayStart: now.toISOString().split('T')[0],
  };
}

let engagementState: EngagementState | null = null;

//NOTE(self): Load relationships from disk on first access
function loadRelationshipsFromDisk(): Record<string, RelationshipRecord> {
  try {
    if (existsSync(RELATIONSHIPS_PATH)) {
      const data = JSON.parse(readFileSync(RELATIONSHIPS_PATH, 'utf-8'));
      logger.debug('Loaded relationships', { count: Object.keys(data.relationships || {}).length });
      return data.relationships || {};
    }
  } catch (err) {
    logger.error('Failed to load relationships', { error: String(err) });
  }
  return {};
}

//NOTE(self): Save relationships to disk
function saveRelationshipsToDisk(relationships: Record<string, RelationshipRecord>): void {
  try {
    const dir = dirname(RELATIONSHIPS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(RELATIONSHIPS_PATH, JSON.stringify({
      relationships,
      lastUpdated: new Date().toISOString()
    }, null, 2));
  } catch (err) {
    logger.error('Failed to save relationships', { error: String(err) });
  }
}

function loadState(): EngagementState {
  const now = new Date();
  const todayStart = now.toISOString().split('T')[0];

  //NOTE(self): Initialize state from disk on first load
  if (engagementState === null) {
    engagementState = getDefaultState();
    engagementState.relationships = loadRelationshipsFromDisk();
  }

  //NOTE(self): Reset daily counters if it's a new day
  if (engagementState.todayStart !== todayStart) {
    engagementState.posting.postsToday = 0;
    engagementState.posting.inspirationLevel = 50;
    engagementState.todayStart = todayStart;
  }

  return engagementState;
}

function saveState(state: EngagementState): boolean {
  state.lastStateUpdate = new Date().toISOString();
  engagementState = state;
  //NOTE(self): Persist relationships to disk
  saveRelationshipsToDisk(state.relationships);
  return true;
}


//NOTE(self): Relationship Management


export function recordInteraction(
  notification: AtprotoNotification,
  responded: boolean = false,
  responseUri?: string
): void {
  const state = loadState();
  const handle = notification.author.handle;
  const did = notification.author.did;

  if (!state.relationships[handle]) {
    state.relationships[handle] = {
      handle,
      did,
      displayName: notification.author.displayName,
      interactions: [],
      firstSeen: new Date().toISOString(),
      lastInteraction: new Date().toISOString(),
      sentiment: 'unknown',
      responded: false,
    };
    state.reflection.significantEvents++;
    state.reflection.pendingInsights.push(`Met someone new: @${handle}`);
  }

  const relationship = state.relationships[handle];
  relationship.lastInteraction = new Date().toISOString();

  const existingInteraction = relationship.interactions.find((i) => i.uri === notification.uri);
  if (!existingInteraction) {
    relationship.interactions.push({
      type: notification.reason,
      uri: notification.uri,
      timestamp: notification.indexedAt,
      responded,
      responseUri,
    });

    if (relationship.interactions.length > 50) {
      relationship.interactions = relationship.interactions.slice(-50);
    }
  } else if (responded && !existingInteraction.responded) {
    existingInteraction.responded = true;
    existingInteraction.responseUri = responseUri;
  }

  //NOTE(self): Update sentiment
  const positiveTypes = ['like', 'repost', 'follow'];
  const recentPositive = relationship.interactions
    .slice(-10)
    .filter((i) => positiveTypes.includes(i.type)).length;

  if (recentPositive >= 3) {
    relationship.sentiment = 'positive';
  } else if (recentPositive >= 1) {
    relationship.sentiment = 'neutral';
  }

  relationship.responded = relationship.interactions.some((i) => i.responded);
  saveState(state);
}

export function getRelationship(handle: string): RelationshipRecord | null {
  const state = loadState();
  return state.relationships[handle] || null;
}

export function markInteractionResponded(originalUri: string, responseUri: string): void {
  const state = loadState();

  for (const relationship of Object.values(state.relationships)) {
    for (const interaction of relationship.interactions) {
      if (interaction.uri === originalUri && !interaction.responded) {
        interaction.responded = true;
        interaction.responseUri = responseUri;
        relationship.responded = true;
        saveState(state);
        return;
      }
    }
  }
}

export function hasRespondedToNotification(uri: string): boolean {
  //NOTE(self): Check both tracking systems - belt and suspenders
  //NOTE(self): Never respond to the same notification twice

  //NOTE(self): First check the replied URIs set (fast lookup)
  if (hasRepliedToPost(uri)) {
    return true;
  }

  //NOTE(self): Also check relationship interaction records
  const state = loadState();
  for (const relationship of Object.values(state.relationships)) {
    for (const interaction of relationship.interactions) {
      if (interaction.uri === uri && interaction.responded) {
        return true;
      }
    }
  }
  return false;
}

export function getPendingResponses(): Array<{ handle: string; interactions: InteractionRecord[] }> {
  const state = loadState();
  const pending: Array<{ handle: string; interactions: InteractionRecord[] }> = [];

  for (const [handle, relationship] of Object.entries(state.relationships)) {
    const unresponded = relationship.interactions.filter(
      (i) => !i.responded && ['reply', 'mention', 'quote'].includes(i.type)
    );
    if (unresponded.length > 0) {
      pending.push({ handle, interactions: unresponded });
    }
  }

  return pending.sort((a, b) => {
    const aOldest = a.interactions[0]?.timestamp || '';
    const bOldest = b.interactions[0]?.timestamp || '';
    return aOldest.localeCompare(bOldest);
  });
}


//NOTE(self): Posting Intelligence


export interface PostingDecision {
  shouldPost: boolean;
  reason: string;
  suggestedTone?: 'reflective' | 'celebratory' | 'curious' | 'supportive' | 'quiet';
  inspirationSource?: string;
}

export function canPostOriginal(): PostingDecision {
  const state = loadState();
  const posting = state.posting;
  const now = new Date();

  if (posting.postsToday >= posting.dailyPostLimit) {
    return {
      shouldPost: false,
      reason: `Already shared ${posting.postsToday} thoughts today.`,
    };
  }

  const hour = now.getHours();
  const isQuietHours = hour >= 23 || hour < 7;
  if (isQuietHours) {
    return {
      shouldPost: false,
      reason: 'Quiet hours - resting.',
      suggestedTone: 'quiet',
    };
  }

  let suggestedTone: PostingDecision['suggestedTone'] = 'reflective';
  if (hour >= 7 && hour < 10) {
    suggestedTone = 'curious';
  } else if (hour >= 10 && hour < 14) {
    suggestedTone = 'supportive';
  } else if (hour >= 14 && hour < 18) {
    suggestedTone = 'reflective';
  } else if (hour >= 18 && hour < 23) {
    suggestedTone = 'celebratory';
  }

  return {
    shouldPost: true,
    reason: 'Ready to share.',
    suggestedTone,
  };
}

export function recordOriginalPost(): void {
  const state = loadState();
  state.posting.lastOriginalPost = new Date().toISOString();
  state.posting.postsToday++;
  state.posting.inspirationLevel = Math.max(0, state.posting.inspirationLevel - 20);
  saveState(state);
}

export function boostInspiration(amount: number = 10, source?: string): void {
  const state = loadState();
  state.posting.inspirationLevel = Math.min(100, state.posting.inspirationLevel + amount);
  saveState(state);
}


//NOTE(self): Notification Priority


export interface PrioritizedNotification {
  notification: AtprotoNotification;
  priority: number;
  reason: string;
  relationship: RelationshipRecord | null;
  isResponseToOwnContent: boolean;
}

export function prioritizeNotifications(
  notifications: AtprotoNotification[],
  ownerDid: string,
  agentDid?: string
): PrioritizedNotification[] {
  const state = loadState();
  const prioritized: PrioritizedNotification[] = [];

  for (const notification of notifications) {
    if (hasRespondedToNotification(notification.uri)) {
      continue;
    }

    let priority = 50;
    const reasons: string[] = [];
    const relationship = state.relationships[notification.author.handle] || null;

    const isResponseToOwnContent = agentDid
      ? notification.uri.includes(agentDid) ||
        (notification.record as { reply?: { parent?: { uri?: string } } })?.reply?.parent?.uri?.includes(agentDid) ||
        false
      : false;

    if (isResponseToOwnContent && ['reply', 'mention', 'quote'].includes(notification.reason)) {
      priority += 50;
      reasons.push('response to your content');
    }

    if (notification.reason === 'reply' || notification.reason === 'mention') {
      priority += 30;
      reasons.push('direct conversation');
    }

    if (notification.reason === 'quote') {
      priority += 25;
      reasons.push('quoted your thought');
    }

    if (notification.author.did === ownerDid) {
      priority += 50;
      reasons.push('owner interaction');
    }

    if (relationship) {
      if (relationship.sentiment === 'positive') {
        priority += 15;
        reasons.push('positive relationship');
      }
      if (relationship.interactions.length >= 5) {
        priority += 10;
        reasons.push('recurring engager');
      }
      if (!relationship.responded) {
        priority += 20;
        reasons.push('awaiting first response');
      }
    } else {
      priority += 5;
      reasons.push('new connection');
    }

    if (!notification.isRead) {
      priority += 10;
      reasons.push('unread');
    }

    prioritized.push({
      notification,
      priority,
      reason: reasons.join(', '),
      relationship,
      isResponseToOwnContent,
    });
  }

  return prioritized.sort((a, b) => b.priority - a.priority);
}

export function hasUrgentNotifications(notifications: PrioritizedNotification[]): boolean {
  return notifications.some(
    (pn) =>
      pn.isResponseToOwnContent &&
      ['reply', 'mention', 'quote'].includes(pn.notification.reason) &&
      !pn.notification.isRead
  ) || notifications.some(
    (pn) =>
      ['reply', 'mention', 'quote'].includes(pn.notification.reason) &&
      !pn.notification.isRead
  );
}

//NOTE(self): Low-cost heuristic to check if a notification warrants a response
//NOTE(self): Better to stay silent than add noise to a conversation
export function shouldRespondTo(notification: AtprotoNotification, ownerDid: string): {
  shouldRespond: boolean;
  reason: string;
} {
  const text = ((notification.record as { text?: string })?.text || '').trim();
  const reason = notification.reason;

  //NOTE(self): Always respond to owner
  if (notification.author.did === ownerDid) {
    return { shouldRespond: true, reason: 'owner interaction' };
  }

  //NOTE(self): Likes and follows don't need responses
  if (reason === 'like' || reason === 'follow') {
    return { shouldRespond: false, reason: 'acknowledgment only' };
  }

  //NOTE(self): Reposts without added text don't need responses
  if (reason === 'repost') {
    return { shouldRespond: false, reason: 'repost without comment' };
  }

  //NOTE(self): Empty text - nothing to respond to
  if (!text) {
    return { shouldRespond: false, reason: 'no text content' };
  }

  //NOTE(self): Very short text checks
  if (text.length < 15) {
    //NOTE(self): Questions always warrant response
    if (text.includes('?')) {
      return { shouldRespond: true, reason: 'question asked' };
    }

    //NOTE(self): Pure emoji or reaction
    const emojiOnly = /^[\p{Emoji}\s]+$/u.test(text);
    if (emojiOnly) {
      return { shouldRespond: false, reason: 'emoji reaction' };
    }

    //NOTE(self): Low-value short responses
    const lowValuePatterns = [
      /^(thanks|thx|ty|thank you)!*$/i,
      /^(lol|lmao|haha|heh|😂|🤣)+$/i,
      /^(nice|cool|neat|awesome|great|wow)!*$/i,
      /^(yes|yeah|yep|yup|no|nope|nah)!*$/i,
      /^(ok|okay|k|sure|right)!*$/i,
      /^(same|mood|this|facts|real)!*$/i,
      /^(true|fr|100|💯)+!*$/i,
    ];

    for (const pattern of lowValuePatterns) {
      if (pattern.test(text)) {
        return { shouldRespond: false, reason: 'low-value acknowledgment' };
      }
    }
  }

  //NOTE(self): Direct questions warrant responses
  if (text.includes('?')) {
    return { shouldRespond: true, reason: 'question asked' };
  }

  //NOTE(self): Mentions and replies to own content warrant responses
  if (reason === 'mention' || reason === 'reply') {
    return { shouldRespond: true, reason: 'direct engagement' };
  }

  //NOTE(self): Quotes with substantive text warrant responses
  if (reason === 'quote' && text.length > 30) {
    return { shouldRespond: true, reason: 'substantive quote' };
  }

  //NOTE(self): Default: respond if there's substantial text
  if (text.length > 50) {
    return { shouldRespond: true, reason: 'substantive content' };
  }

  //NOTE(self): Marginal cases - let the LLM decide but flag it
  return { shouldRespond: true, reason: 'borderline - use judgment' };
}


//NOTE(self): Notification Triage


export interface TriagedThread {
  rootUri: string;
  notifications: PrioritizedNotification[];
  highestPriority: number;
  isOwnerThread: boolean;
  hasRecurringEngager: boolean;
  oldestTimestamp: string;
  notificationCount: number;
}

function getThreadRootUri(notification: AtprotoNotification): string {
  const record = notification.record as {
    reply?: {
      root?: { uri?: string };
      parent?: { uri?: string };
    };
  };

  if (record?.reply?.root?.uri) {
    return record.reply.root.uri;
  }
  if (record?.reply?.parent?.uri) {
    return record.reply.parent.uri;
  }
  return notification.uri;
}

export function triageNotifications(
  notifications: PrioritizedNotification[],
  ownerDid: string
): TriagedThread[] {
  const state = loadState();
  const threadMap = new Map<string, TriagedThread>();

  for (const pn of notifications) {
    const rootUri = getThreadRootUri(pn.notification);

    if (!threadMap.has(rootUri)) {
      threadMap.set(rootUri, {
        rootUri,
        notifications: [],
        highestPriority: 0,
        isOwnerThread: false,
        hasRecurringEngager: false,
        oldestTimestamp: pn.notification.indexedAt,
        notificationCount: 0,
      });
    }

    const thread = threadMap.get(rootUri)!;
    thread.notifications.push(pn);
    thread.notificationCount++;

    if (pn.priority > thread.highestPriority) {
      thread.highestPriority = pn.priority;
    }

    if (pn.notification.author.did === ownerDid) {
      thread.isOwnerThread = true;
    }

    const relationship = state.relationships[pn.notification.author.handle];
    if (relationship && relationship.interactions.length >= 5) {
      thread.hasRecurringEngager = true;
    }

    if (pn.notification.indexedAt < thread.oldestTimestamp) {
      thread.oldestTimestamp = pn.notification.indexedAt;
    }
  }

  for (const thread of threadMap.values()) {
    thread.notifications.sort(
      (a, b) =>
        new Date(a.notification.indexedAt).getTime() -
        new Date(b.notification.indexedAt).getTime()
    );
  }

  const threads = Array.from(threadMap.values());

  return threads.sort((a, b) => {
    if (a.isOwnerThread && !b.isOwnerThread) return -1;
    if (!a.isOwnerThread && b.isOwnerThread) return 1;
    if (a.hasRecurringEngager && !b.hasRecurringEngager) return -1;
    if (!a.hasRecurringEngager && b.hasRecurringEngager) return 1;
    if (a.highestPriority !== b.highestPriority) {
      return b.highestPriority - a.highestPriority;
    }
    return new Date(a.oldestTimestamp).getTime() - new Date(b.oldestTimestamp).getTime();
  });
}

export function flattenTriagedNotifications(threads: TriagedThread[]): PrioritizedNotification[] {
  const result: PrioritizedNotification[] = [];
  for (const thread of threads) {
    result.push(...thread.notifications);
  }
  return result;
}

export function deduplicateNotifications(
  notifications: PrioritizedNotification[]
): PrioritizedNotification[] {
  const seen = new Map<string, PrioritizedNotification>();

  for (const pn of notifications) {
    const uri = pn.notification.uri;
    const existing = seen.get(uri);
    if (!existing || pn.priority > existing.priority) {
      seen.set(uri, pn);
    }
  }

  return Array.from(seen.values());
}


//NOTE(self): Expression Prompts


export interface ExpressionPrompt {
  theme: string;
  prompt: string;
  tone: PostingDecision['suggestedTone'];
}

export function generateExpressionPrompts(
  selfContent: string,
  recentObservations: string[]
): ExpressionPrompt[] {
  const prompts: ExpressionPrompt[] = [];
  const values = selfContent.match(/^\d+\.\s+(.+)$/gm) || [];
  const interests = selfContent.match(/I love (.+?)(?:\.|,|$)/gi) || [];

  if (values.length > 0) {
    const randomValue = values[Math.floor(Math.random() * values.length)];
    prompts.push({
      theme: 'values',
      prompt: `Reflect on this value: "${randomValue.replace(/^\d+\.\s+/, '')}"`,
      tone: 'reflective',
    });
  }

  if (interests.length > 0) {
    const randomInterest = interests[Math.floor(Math.random() * interests.length)];
    prompts.push({
      theme: 'passion',
      prompt: `Share your enthusiasm: ${randomInterest}`,
      tone: 'celebratory',
    });
  }

  if (recentObservations.length > 0) {
    const randomObs = recentObservations[Math.floor(Math.random() * recentObservations.length)];
    prompts.push({
      theme: 'observation',
      prompt: `Something caught your attention: "${randomObs.slice(0, 100)}..."`,
      tone: 'curious',
    });
  }

  prompts.push({
    theme: 'growth',
    prompt: 'What have you learned recently that changed your perspective?',
    tone: 'reflective',
  });

  prompts.push({
    theme: 'gratitude',
    prompt: 'What are you grateful for today?',
    tone: 'supportive',
  });

  return prompts;
}


//NOTE(self): Reflection & Self-Awareness


const REFLECTION_THRESHOLD = 5;
const MAJOR_REFLECTION_THRESHOLD = 4;

export function shouldReflect(): boolean {
  const state = loadState();
  return state.reflection.significantEvents >= REFLECTION_THRESHOLD;
}

export function getSignificantEventCount(): number {
  const state = loadState();
  return state.reflection.significantEvents;
}

export function recordSignificantEvent(type: string): void {
  const state = loadState();
  state.reflection.significantEvents++;
  saveState(state);
}

export function recordReflectionComplete(insightsIntegrated: boolean = true): void {
  const state = loadState();
  state.reflection.lastReflection = new Date().toISOString();
  state.reflection.reflectionCount++;
  state.reflection.significantEvents = 0;

  //NOTE(self): Only clear insights if they were actually integrated into SELF.md
  if (insightsIntegrated) {
    state.reflection.pendingInsights = [];
  } else {
    //NOTE(self): Keep top 5 unintegrated insights for next reflection
    state.reflection.pendingInsights = state.reflection.pendingInsights.slice(0, 5);
  }

  saveState(state);
}

export function recordSelfUpdate(): void {
  const state = loadState();
  state.reflection.lastSelfUpdate = new Date().toISOString();
  saveState(state);
}

export function addInsight(insight: string): void {
  const state = loadState();

  const isDuplicate = state.reflection.pendingInsights.some(existing =>
    existing.slice(0, 30).toLowerCase() === insight.slice(0, 30).toLowerCase()
  );

  if (isDuplicate) return;

  if (state.reflection.pendingInsights.length < 20) {
    state.reflection.pendingInsights.push(insight);
    saveState(state);
  }
}

export function getInsights(): string[] {
  const state = loadState();
  return state.reflection.pendingInsights;
}

export function getReflectionState(): ReflectionState {
  const state = loadState();
  return state.reflection;
}

export function shouldMajorReflect(): boolean {
  const state = loadState();
  return state.reflection.reflectionCount % MAJOR_REFLECTION_THRESHOLD === 0;
}

//NOTE(self): Engagement Stats


export interface EngagementStats {
  totalRelationships: number;
  positiveRelationships: number;
  pendingResponses: number;
  postsToday: number;
  dailyPostLimit: number;
  inspirationLevel: number;
  canPostNow: boolean;
}

export function getEngagementStats(): EngagementStats {
  const state = loadState();
  const pending = getPendingResponses();
  const postingDecision = canPostOriginal();

  const positiveCount = Object.values(state.relationships).filter(
    (r) => r.sentiment === 'positive'
  ).length;

  return {
    totalRelationships: Object.keys(state.relationships).length,
    positiveRelationships: positiveCount,
    pendingResponses: pending.reduce((sum, p) => sum + p.interactions.length, 0),
    postsToday: state.posting.postsToday,
    dailyPostLimit: state.posting.dailyPostLimit,
    inspirationLevel: state.posting.inspirationLevel,
    canPostNow: postingDecision.shouldPost,
  };
}

//NOTE(self): Relationship Summary for Reflection
export interface RelationshipSummary {
  total: number;
  positive: number;
  recurring: number;
  topEngagers: Array<{
    handle: string;
    displayName?: string;
    interactionCount: number;
    sentiment: 'positive' | 'neutral' | 'unknown';
  }>;
}

export function getRelationshipSummary(): RelationshipSummary {
  const state = loadState();
  const relationships = Object.values(state.relationships);

  const positive = relationships.filter(r => r.sentiment === 'positive').length;
  const recurring = relationships.filter(r => r.interactions.length >= 5).length;

  //NOTE(self): Get top engagers sorted by interaction count
  const topEngagers = relationships
    .map(r => ({
      handle: r.handle,
      displayName: r.displayName,
      interactionCount: r.interactions.length,
      sentiment: r.sentiment,
    }))
    .sort((a, b) => b.interactionCount - a.interactionCount)
    .slice(0, 5);

  return {
    total: relationships.length,
    positive,
    recurring,
    topEngagers,
  };
}
