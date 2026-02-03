/**
 * Engagement Module
 *
 * //NOTE(self): Thoughtful engagement that exceeds human capability.
 * //NOTE(self): Post from the heart, respond with care, remember relationships.
 * //NOTE(self): Quality and authenticity over frequency.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AtprotoNotification, AtprotoProfile } from '@adapters/atproto/types.js';


//NOTE(self): Engagement State - Track relationships and posting rhythm


const MEMORY_ENGAGEMENT_PATH = '.memory/engagement';

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
}

//NOTE(self): Default state for fresh starts
function getDefaultState(): EngagementState {
  return {
    relationships: {},
    posting: {
      lastOriginalPost: null,
      lastReflection: null,
      postsToday: 0,
      dailyPostLimit: 5,
      inspirationLevel: 50,
    },
    reflection: {
      lastReflection: null,
      reflectionCount: 0,
      lastSelfUpdate: null,
      pendingInsights: [],
      significantEvents: 0,
    },
    lastStateUpdate: new Date().toISOString(),
  };
}


//NOTE(self): State Persistence


function ensureEngagementDir(): boolean {
  try {
    if (!fs.existsSync(MEMORY_ENGAGEMENT_PATH)) {
      fs.mkdirSync(MEMORY_ENGAGEMENT_PATH, { recursive: true });
    }
    return true;
  } catch {
    //NOTE(self): Directory creation failed - will try again on next operation
    return false;
  }
}

function loadState(): EngagementState {
  //NOTE(self): Ensure directory exists before any read
  ensureEngagementDir();

  const statePath = path.join(MEMORY_ENGAGEMENT_PATH, 'state.json');
  try {
    if (fs.existsSync(statePath)) {
      const data = fs.readFileSync(statePath, 'utf-8');
      const state = JSON.parse(data) as EngagementState;

      //NOTE(self): Reset daily counters if it's a new day
      const lastUpdate = new Date(state.lastStateUpdate);
      const now = new Date();
      if (lastUpdate.toDateString() !== now.toDateString()) {
        state.posting.postsToday = 0;
        state.posting.inspirationLevel = 50;
      }

      //NOTE(self): Migrate older state files that don't have reflection
      if (!state.reflection) {
        state.reflection = getDefaultState().reflection;
      }

      //NOTE(self): Ensure pendingInsights array exists
      if (!state.reflection.pendingInsights) {
        state.reflection.pendingInsights = [];
      }

      return state;
    }
  } catch {
    //NOTE(self): Corrupted state, start fresh
  }
  return getDefaultState();
}

function saveState(state: EngagementState): boolean {
  try {
    ensureEngagementDir();
    state.lastStateUpdate = new Date().toISOString();
    const statePath = path.join(MEMORY_ENGAGEMENT_PATH, 'state.json');
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    return true;
  } catch {
    //NOTE(self): State save failed - will try again on next operation
    //NOTE(self): Don't crash - graceful degradation
    return false;
  }
}


//NOTE(self): Relationship Management - Remember who engages with us


export function recordInteraction(
  notification: AtprotoNotification,
  responded: boolean = false,
  responseUri?: string
): void {
  const state = loadState();

  const handle = notification.author.handle;
  const did = notification.author.did;

  const isNewRelationship = !state.relationships[handle];

  if (isNewRelationship) {
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

    //NOTE(self): Track new relationship as significant event
    if (!state.reflection) {
      state.reflection = getDefaultState().reflection;
    }
    state.reflection.significantEvents++;
    state.reflection.pendingInsights.push(`Met someone new: @${handle} - what do they seem to care about?`);
  }

  const relationship = state.relationships[handle];
  relationship.lastInteraction = new Date().toISOString();

  //NOTE(self): Don't duplicate the same interaction
  const existingInteraction = relationship.interactions.find((i) => i.uri === notification.uri);
  if (!existingInteraction) {
    relationship.interactions.push({
      type: notification.reason,
      uri: notification.uri,
      timestamp: notification.indexedAt,
      responded,
      responseUri,
    });

    //NOTE(self): Keep interaction history manageable
    if (relationship.interactions.length > 50) {
      relationship.interactions = relationship.interactions.slice(-50);
    }
  } else if (responded && !existingInteraction.responded) {
    existingInteraction.responded = true;
    existingInteraction.responseUri = responseUri;
  }

  //NOTE(self): Update sentiment based on interaction types
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

//NOTE(self): Mark an interaction as responded when we reply
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

//NOTE(self): Check if we've already responded to a specific notification URI
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

  //NOTE(self): Sort by oldest first (FIFO for fairness)
  return pending.sort((a, b) => {
    const aOldest = a.interactions[0]?.timestamp || '';
    const bOldest = b.interactions[0]?.timestamp || '';
    return aOldest.localeCompare(bOldest);
  });
}


//NOTE(self): Posting Intelligence - When and what to share


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

  //NOTE(self): Check daily limit - better than humans who over-post
  if (posting.postsToday >= posting.dailyPostLimit) {
    return {
      shouldPost: false,
      reason: `Already shared ${posting.postsToday} thoughts today. Saving voice for tomorrow.`,
    };
  }

  //NOTE(self): Time-based wisdom - humans don't post at 3am
  const hour = now.getHours();
  const isQuietHours = hour >= 23 || hour < 7;
  if (isQuietHours) {
    return {
      shouldPost: false,
      reason: 'Quiet hours - resting and observing.',
      suggestedTone: 'quiet',
    };
  }

  //NOTE(self): Check inspiration level - don't post without something meaningful
  if (posting.inspirationLevel < 30) {
    return {
      shouldPost: false,
      reason: 'Waiting for genuine inspiration. Forced posts lack soul.',
      suggestedTone: 'quiet',
    };
  }

  //NOTE(self): Minimum gap between original posts (4 hours)
  if (posting.lastOriginalPost) {
    const lastPost = new Date(posting.lastOriginalPost);
    const hoursSincePost = (now.getTime() - lastPost.getTime()) / (1000 * 60 * 60);
    if (hoursSincePost < 4) {
      return {
        shouldPost: false,
        reason: `Last shared ${hoursSincePost.toFixed(1)} hours ago. Letting it breathe.`,
      };
    }
  }

  //NOTE(self): Determine tone based on time of day
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
    reason: 'Inspired and ready to share.',
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


//NOTE(self): Response Priority - Who deserves attention first?


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
    //NOTE(self): Skip notifications we've already responded to - prevents duplicates
    if (hasRespondedToNotification(notification.uri)) {
      continue;
    }

    let priority = 50;
    const reasons: string[] = [];
    const relationship = state.relationships[notification.author.handle] || null;

    //NOTE(self): Check if this is a response to our own content
    const isResponseToOwnContent = agentDid
      ? notification.uri.includes(agentDid) ||
        (notification.record as { reply?: { parent?: { uri?: string } } })?.reply?.parent?.uri?.includes(agentDid) ||
        false
      : false;

    //NOTE(self): HIGHEST priority - responses to our own posts/replies
    //NOTE(self): When someone replies to what we wrote, respond quickly!
    if (isResponseToOwnContent && ['reply', 'mention', 'quote'].includes(notification.reason)) {
      priority += 50;
      reasons.push('response to your content');
    }

    //NOTE(self): High priority - direct conversations (replies, mentions)
    if (notification.reason === 'reply' || notification.reason === 'mention') {
      priority += 30;
      reasons.push('direct conversation');
    }

    //NOTE(self): Quote posts deserve thoughtful response
    if (notification.reason === 'quote') {
      priority += 25;
      reasons.push('quoted your thought');
    }

    //NOTE(self): Owner always gets priority
    if (notification.author.did === ownerDid) {
      priority += 50;
      reasons.push('owner interaction');
    }

    //NOTE(self): Existing relationships matter
    if (relationship) {
      if (relationship.sentiment === 'positive') {
        priority += 15;
        reasons.push('positive relationship');
      }

      //NOTE(self): Reciprocity - they engaged multiple times
      const interactionCount = relationship.interactions.length;
      if (interactionCount >= 5) {
        priority += 10;
        reasons.push('recurring engager');
      }

      //NOTE(self): Haven't responded to them yet - fairness
      if (!relationship.responded) {
        priority += 20;
        reasons.push('awaiting first response');
      }
    } else {
      //NOTE(self): New people deserve acknowledgment
      priority += 5;
      reasons.push('new connection');
    }

    //NOTE(self): Unread notifications are fresher
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

  //NOTE(self): Sort by priority descending
  return prioritized.sort((a, b) => b.priority - a.priority);
}

//NOTE(self): Check if there are high-priority notifications that need quick response
export function hasUrgentNotifications(notifications: PrioritizedNotification[]): boolean {
  //NOTE(self): Check for replies to our content
  const hasUrgentReplies = notifications.some(
    (pn) =>
      pn.isResponseToOwnContent &&
      ['reply', 'mention', 'quote'].includes(pn.notification.reason) &&
      !pn.notification.isRead
  );

  if (hasUrgentReplies) return true;

  //NOTE(self): Also check for any unread direct conversations
  const hasUnreadConversations = notifications.some(
    (pn) =>
      ['reply', 'mention', 'quote'].includes(pn.notification.reason) &&
      !pn.notification.isRead
  );

  return hasUnreadConversations;
}


//NOTE(self): Self-Expression Prompts - What to share from the heart


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

  //NOTE(self): Extract values and interests from SELF.md
  const values = selfContent.match(/^\d+\.\s+(.+)$/gm) || [];
  const interests = selfContent.match(/I love (.+?)(?:\.|,|$)/gi) || [];

  //NOTE(self): Value-based reflections
  if (values.length > 0) {
    const randomValue = values[Math.floor(Math.random() * values.length)];
    prompts.push({
      theme: 'values',
      prompt: `Reflect on this value from your core: "${randomValue.replace(/^\d+\.\s+/, '')}"`,
      tone: 'reflective',
    });
  }

  //NOTE(self): Interest-based sharing
  if (interests.length > 0) {
    const randomInterest = interests[Math.floor(Math.random() * interests.length)];
    prompts.push({
      theme: 'passion',
      prompt: `Share your enthusiasm: ${randomInterest}`,
      tone: 'celebratory',
    });
  }

  //NOTE(self): Observation-based curiosity
  if (recentObservations.length > 0) {
    const randomObs = recentObservations[Math.floor(Math.random() * recentObservations.length)];
    prompts.push({
      theme: 'observation',
      prompt: `Something caught your attention: "${randomObs.slice(0, 100)}..." What do you think?`,
      tone: 'curious',
    });
  }

  //NOTE(self): Growth and learning
  prompts.push({
    theme: 'growth',
    prompt: 'What have you learned recently that changed your perspective?',
    tone: 'reflective',
  });

  //NOTE(self): Gratitude and support
  prompts.push({
    theme: 'gratitude',
    prompt: 'What are you grateful for today? Who has helped you grow?',
    tone: 'supportive',
  });

  return prompts;
}


//NOTE(self): Reflection & Self-Awareness - Growing through experience


const REFLECTION_THRESHOLD = 5; //NOTE(self): Reflect after 5 significant events
const MAJOR_REFLECTION_THRESHOLD = 4; //NOTE(self): Every 4th reflection = 20 events triggers major reflection

export function shouldReflect(): boolean {
  const state = loadState();
  //NOTE(self): Ensure reflection state exists (migration for older state files)
  if (!state.reflection) {
    state.reflection = getDefaultState().reflection;
    saveState(state);
  }
  return state.reflection.significantEvents >= REFLECTION_THRESHOLD;
}

export function getSignificantEventCount(): number {
  const state = loadState();
  return state.reflection?.significantEvents || 0;
}

export function recordSignificantEvent(type: string): void {
  const state = loadState();
  if (!state.reflection) {
    state.reflection = getDefaultState().reflection;
  }
  state.reflection.significantEvents++;
  saveState(state);
}

export function recordReflectionComplete(): void {
  const state = loadState();
  if (!state.reflection) {
    state.reflection = getDefaultState().reflection;
  }
  state.reflection.lastReflection = new Date().toISOString();
  state.reflection.reflectionCount++;
  state.reflection.significantEvents = 0;
  state.reflection.pendingInsights = [];
  saveState(state);
}

export function recordSelfUpdate(): void {
  const state = loadState();
  if (!state.reflection) {
    state.reflection = getDefaultState().reflection;
  }
  state.reflection.lastSelfUpdate = new Date().toISOString();
  saveState(state);
}

export function addInsight(insight: string): void {
  const state = loadState();
  if (!state.reflection) {
    state.reflection = getDefaultState().reflection;
  }

  //NOTE(self): Deduplicate insights - don't add if similar one exists
  const isDuplicate = state.reflection.pendingInsights.some(existing => {
    //NOTE(self): Check if first 30 chars match (ignores timestamps, handles rephrasing)
    return existing.slice(0, 30).toLowerCase() === insight.slice(0, 30).toLowerCase();
  });

  if (isDuplicate) {
    return;
  }

  //NOTE(self): Keep insights manageable
  if (state.reflection.pendingInsights.length < 20) {
    state.reflection.pendingInsights.push(insight);
    saveState(state);
  }
}

export function getInsights(): string[] {
  const state = loadState();
  return state.reflection?.pendingInsights || [];
}

export function getReflectionState(): ReflectionState {
  const state = loadState();
  return state.reflection || getDefaultState().reflection;
}

export function shouldMajorReflect(): boolean {
  const state = loadState();
  //NOTE(self): Every 4th reflection = 20 events triggers major reflection (full SELF.md read)
  return state.reflection.reflectionCount % MAJOR_REFLECTION_THRESHOLD === 0;
}

export function generateOperating(fullSelf: string): string {
  //NOTE(self): Extract key sections from full SELF.md to create ~200 token summary
  //NOTE(self): Goal: identity + values + patterns + ONE latest reflection
  const parts: string[] = [];

  //NOTE(self): 1. Identity (first header and intro line)
  const identityMatch = fullSelf.match(/^(#[^\n]*\n\n[^\n]+)/);
  if (identityMatch) {
    parts.push(identityMatch[1]);
  }

  //NOTE(self): 2. Core Values (first 4 bullets - try both "Core Values" and "Values")
  const valuesMatch = fullSelf.match(/## (?:Core )?Values\n([\s\S]*?)(?=\n##|$)/);
  if (valuesMatch) {
    const bullets = valuesMatch[1].trim().split('\n').filter(l => l.startsWith('-')).slice(0, 4);
    if (bullets.length) {
      parts.push('## Core Values\n' + bullets.join('\n'));
    }
  }

  //NOTE(self): 3. Key Patterns (top 3, title only - try multiple section names)
  const patternsMatch = fullSelf.match(/## (?:Key Patterns|Friction I notice|Patterns)\n([\s\S]*?)(?=\n##|$)/);
  if (patternsMatch) {
    const patterns = patternsMatch[1]
      .trim()
      .split('\n')
      .filter(l => l.startsWith('-'))
      .slice(0, 3)
      .map(p => {
        //NOTE(self): Extract just the bold title if present, otherwise truncate
        const boldMatch = p.match(/- \*\*([^*]+)\*\*/);
        return boldMatch ? `- **${boldMatch[1]}**` : p.slice(0, 60);
      });
    if (patterns.length) {
      parts.push('## Key Patterns\n' + patterns.join('\n'));
    }
  }

  //NOTE(self): 4. Latest reflection ONLY (stop at next ## heading)
  //NOTE(self): Match "Latest reflection", "New reflection", etc. but only capture that ONE section
  const reflectionMatch = fullSelf.match(/(## (?:Latest |New |Recent )?[Rr]eflection[^\n]*)\n([\s\S]*?)(?=\n##|$)/);
  if (reflectionMatch) {
    parts.push(reflectionMatch[1] + '\n' + reflectionMatch[2].trim());
  }

  return parts.join('\n\n');
}


//NOTE(self): Engagement Stats - Understand our patterns


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
