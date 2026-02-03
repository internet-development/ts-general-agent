/**
 * Engagement Module
 *
 * //NOTE(self): Thoughtful engagement that exceeds human capability.
 * //NOTE(self): Post from the heart, respond with care, remember relationships.
 * //NOTE(self): State is in-memory only - resets on restart. I use SELF.md for persistent memory.
 */

import type { AtprotoNotification } from '@adapters/atproto/types.js';


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


//NOTE(self): In-memory state (resets on restart)

//NOTE(self): Track which post URIs we've replied to (prevents multiple replies to same post)
const repliedToPostUris = new Set<string>();

export function hasRepliedToPost(postUri: string): boolean {
  return repliedToPostUris.has(postUri);
}

export function markPostReplied(postUri: string): void {
  repliedToPostUris.add(postUri);
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

let engagementState: EngagementState = getDefaultState();

function loadState(): EngagementState {
  const now = new Date();
  const todayStart = now.toISOString().split('T')[0];

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

export function recordReflectionComplete(): void {
  const state = loadState();
  state.reflection.lastReflection = new Date().toISOString();
  state.reflection.reflectionCount++;
  state.reflection.significantEvents = 0;
  state.reflection.pendingInsights = [];
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

export function generateOperating(fullSelf: string): string {
  //NOTE(self): If SELF.md is small enough, just use the whole thing
  if (fullSelf.length < 1500) {
    return fullSelf;
  }

  //NOTE(self): Otherwise, extract key sections flexibly
  const parts: string[] = [];

  //NOTE(self): Get the title and first paragraph
  const headerMatch = fullSelf.match(/^(#[^\n]*\n\n[^\n]+)/);
  if (headerMatch) {
    parts.push(headerMatch[1]);
  }

  //NOTE(self): Extract first 3-4 sections (## headings) with their content
  const sections = fullSelf.split(/\n(?=## )/);
  let sectionCount = 0;

  for (const section of sections) {
    if (!section.startsWith('## ')) continue;
    if (sectionCount >= 4) break;

    //NOTE(self): Truncate long sections to first few lines
    const lines = section.split('\n');
    const header = lines[0];
    const content = lines.slice(1).filter(l => l.trim()).slice(0, 5);

    if (content.length > 0) {
      parts.push(header + '\n' + content.join('\n'));
      sectionCount++;
    }
  }

  const result = parts.join('\n\n');

  //NOTE(self): If extraction failed, just use first ~1500 chars
  if (result.length < 100) {
    return fullSelf.slice(0, 1500);
  }

  return result;
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
