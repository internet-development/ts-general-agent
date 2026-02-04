//NOTE(self): Bluesky Engagement Module
//NOTE(self): Track Bluesky conversation state including all participants
//NOTE(self): Know when a conversation has run its course
//NOTE(self): seenAt handled by engagement.ts, this focuses on thread-level tracking

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';

//NOTE(self): Path to Bluesky conversation state
const BLUESKY_CONVERSATIONS_PATH = '.memory/bluesky_conversations.json';

//NOTE(self): Track a participant's activity in a thread
interface ThreadParticipant {
  did: string;
  handle: string;
  displayName?: string;
  replyCount: number;
  firstReplyAt: string;
  lastReplyAt: string;
  //NOTE(self): Track if they seem to have disengaged (no reply in a while after being active)
  seemsDisengaged: boolean;
}

//NOTE(self): Conversation record - tracks our engagement with each thread
interface ConversationRecord {
  //NOTE(self): The root post URI that started this thread
  rootUri: string;
  rootCid: string;
  //NOTE(self): Who started the thread
  rootAuthorDid: string;
  rootAuthorHandle: string;
  //NOTE(self): When we first saw this conversation
  firstSeen: string;
  //NOTE(self): When we last checked it
  lastChecked: string;
  //NOTE(self): Total thread depth (how many replies deep)
  threadDepth: number;
  //NOTE(self): All participants in this thread (including us)
  participants: Record<string, ThreadParticipant>;
  //NOTE(self): Our participation stats
  ourReplyCount: number;
  ourLastReplyAt: string | null;
  ourLastReplyUri: string | null;
  //NOTE(self): State of the conversation
  state: 'new' | 'active' | 'awaiting_response' | 'concluded' | 'stale';
  //NOTE(self): Why we think the conversation is concluded
  conclusionReason?: string;
  //NOTE(self): Source that triggered our engagement
  source: 'notification' | 'owner_mention' | 'expression_reply';
}

interface BlueskyConversationState {
  //NOTE(self): Active conversations we're tracking (keyed by root URI)
  conversations: Record<string, ConversationRecord>;
  //NOTE(self): Last cleanup timestamp
  lastCleanup: string | null;
}

let conversationState: BlueskyConversationState | null = null;

function getDefaultState(): BlueskyConversationState {
  return {
    conversations: {},
    lastCleanup: null,
  };
}

function loadState(): BlueskyConversationState {
  if (conversationState !== null) return conversationState;

  try {
    if (existsSync(BLUESKY_CONVERSATIONS_PATH)) {
      const data = JSON.parse(readFileSync(BLUESKY_CONVERSATIONS_PATH, 'utf-8'));
      conversationState = {
        conversations: data.conversations || {},
        lastCleanup: data.lastCleanup || null,
      };
      logger.debug('Loaded Bluesky conversation state', {
        conversationCount: Object.keys(conversationState.conversations).length,
      });
    } else {
      conversationState = getDefaultState();
    }
  } catch (err) {
    logger.error('Failed to load Bluesky conversation state', { error: String(err) });
    conversationState = getDefaultState();
  }
  return conversationState;
}

function saveState(): void {
  if (!conversationState) return;

  try {
    const dir = dirname(BLUESKY_CONVERSATIONS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(BLUESKY_CONVERSATIONS_PATH, JSON.stringify(conversationState, null, 2));
  } catch (err) {
    logger.error('Failed to save Bluesky conversation state', { error: String(err) });
  }
}

//NOTE(self): Get or create a conversation record
export function getConversation(rootUri: string): ConversationRecord | null {
  const state = loadState();
  return state.conversations[rootUri] || null;
}

//NOTE(self): Track a new conversation or update existing one
export function trackConversation(
  rootUri: string,
  rootCid: string,
  rootAuthorDid: string,
  rootAuthorHandle: string,
  source: ConversationRecord['source']
): ConversationRecord {
  const state = loadState();

  if (state.conversations[rootUri]) {
    //NOTE(self): Update existing conversation
    state.conversations[rootUri].lastChecked = new Date().toISOString();
    saveState();
    return state.conversations[rootUri];
  }

  //NOTE(self): Create new conversation record
  const now = new Date().toISOString();
  const record: ConversationRecord = {
    rootUri,
    rootCid,
    rootAuthorDid,
    rootAuthorHandle,
    firstSeen: now,
    lastChecked: now,
    threadDepth: 0,
    participants: {},
    ourReplyCount: 0,
    ourLastReplyAt: null,
    ourLastReplyUri: null,
    state: 'new',
    source,
  };

  state.conversations[rootUri] = record;
  saveState();

  logger.info('Tracking new Bluesky conversation', { rootUri, rootAuthorHandle, source });
  return record;
}

//NOTE(self): Record a participant's activity in the thread
export function recordParticipantActivity(
  rootUri: string,
  participantDid: string,
  participantHandle: string,
  displayName?: string
): void {
  const state = loadState();
  const conversation = state.conversations[rootUri];
  if (!conversation) {
    logger.warn('Recording participant for untracked conversation', { rootUri });
    return;
  }

  const now = new Date().toISOString();
  const existing = conversation.participants[participantDid];

  if (existing) {
    existing.replyCount++;
    existing.lastReplyAt = now;
    existing.seemsDisengaged = false;
  } else {
    conversation.participants[participantDid] = {
      did: participantDid,
      handle: participantHandle,
      displayName,
      replyCount: 1,
      firstReplyAt: now,
      lastReplyAt: now,
      seemsDisengaged: false,
    };
  }

  //NOTE(self): If this wasn't us, mark conversation as active (someone replied)
  conversation.lastChecked = now;
  if (conversation.state === 'awaiting_response') {
    conversation.state = 'active';
  }

  saveState();
}

//NOTE(self): Record our reply to a conversation
export function recordOurReply(
  rootUri: string,
  replyUri: string,
  agentDid: string,
  agentHandle: string
): void {
  const state = loadState();
  const conversation = state.conversations[rootUri];
  if (!conversation) {
    logger.warn('Recording our reply for untracked conversation', { rootUri });
    return;
  }

  const now = new Date().toISOString();

  conversation.ourReplyCount++;
  conversation.ourLastReplyAt = now;
  conversation.ourLastReplyUri = replyUri;
  conversation.state = 'awaiting_response';
  conversation.lastChecked = now;

  //NOTE(self): Also record ourselves as a participant
  recordParticipantActivity(rootUri, agentDid, agentHandle);

  saveState();
  logger.debug('Recorded our reply', { rootUri, replyUri, ourReplyCount: conversation.ourReplyCount });
}

//NOTE(self): Update thread depth from thread analysis
export function updateThreadDepth(rootUri: string, depth: number): void {
  const state = loadState();
  const conversation = state.conversations[rootUri];
  if (!conversation) return;

  conversation.threadDepth = depth;
  saveState();
}

//NOTE(self): Mark a conversation as concluded
export function markConversationConcluded(
  rootUri: string,
  reason: string
): void {
  const state = loadState();
  const conversation = state.conversations[rootUri];
  if (!conversation) {
    logger.warn('Marking untracked conversation as concluded', { rootUri });
    return;
  }

  conversation.state = 'concluded';
  conversation.conclusionReason = reason;
  conversation.lastChecked = new Date().toISOString();
  saveState();

  logger.info('Marked Bluesky conversation as concluded', { rootUri, reason });
}

//NOTE(self): Update conversation state
export function updateConversationState(
  rootUri: string,
  newState: ConversationRecord['state'],
  reason?: string
): void {
  const state = loadState();
  const conversation = state.conversations[rootUri];
  if (!conversation) return;

  conversation.state = newState;
  conversation.lastChecked = new Date().toISOString();
  if (reason) {
    conversation.conclusionReason = reason;
  }
  saveState();

  logger.debug('Updated Bluesky conversation state', { rootUri, newState, reason });
}

//NOTE(self): Analyze if a conversation should be concluded based on all participants
export interface ConversationAnalysis {
  shouldConclude: boolean;
  reason: string;
  threadDepth: number;
  participantCount: number;
  ourReplyCount: number;
  activeParticipants: number;
  disengagedParticipants: number;
}

export function analyzeConversation(
  rootUri: string,
  agentDid: string,
  currentThreadDepth?: number
): ConversationAnalysis {
  const state = loadState();
  const conversation = state.conversations[rootUri];

  //NOTE(self): Default analysis for unknown conversations
  if (!conversation) {
    return {
      shouldConclude: false,
      reason: 'Unknown conversation',
      threadDepth: currentThreadDepth || 0,
      participantCount: 0,
      ourReplyCount: 0,
      activeParticipants: 0,
      disengagedParticipants: 0,
    };
  }

  const depth = currentThreadDepth ?? conversation.threadDepth;
  const participants = Object.values(conversation.participants);
  const otherParticipants = participants.filter(p => p.did !== agentDid);

  //NOTE(self): Check for disengagement - participants who were active but stopped
  const now = Date.now();
  const disengagementThreshold = 30 * 60 * 1000; //NOTE(self): 30 minutes of silence = disengaged
  let activeParticipants = 0;
  let disengagedParticipants = 0;

  for (const participant of otherParticipants) {
    const lastReply = new Date(participant.lastReplyAt).getTime();
    const timeSinceReply = now - lastReply;

    if (timeSinceReply < disengagementThreshold) {
      activeParticipants++;
    } else if (participant.replyCount > 1) {
      //NOTE(self): Was active but hasn't replied in a while
      disengagedParticipants++;
      participant.seemsDisengaged = true;
    }
  }

  //NOTE(self): Save any disengagement updates
  saveState();

  //NOTE(self): Determine if we should conclude
  let shouldConclude = false;
  let reason = '';

  //NOTE(self): Already concluded
  if (conversation.state === 'concluded') {
    return {
      shouldConclude: true,
      reason: conversation.conclusionReason || 'Already concluded',
      threadDepth: depth,
      participantCount: participants.length,
      ourReplyCount: conversation.ourReplyCount,
      activeParticipants,
      disengagedParticipants,
    };
  }

  //NOTE(self): We've replied many times
  if (conversation.ourReplyCount >= 4) {
    shouldConclude = true;
    reason = `You've replied ${conversation.ourReplyCount} times - consider if you're adding value`;
  }
  //NOTE(self): Thread is very deep
  else if (depth >= 12) {
    shouldConclude = true;
    reason = `Thread is ${depth} replies deep - conversation has likely run its course`;
  }
  //NOTE(self): All other participants seem disengaged
  else if (otherParticipants.length > 0 && activeParticipants === 0 && disengagedParticipants > 0) {
    shouldConclude = true;
    reason = 'Other participants seem to have disengaged';
  }
  //NOTE(self): We replied and no one has responded in a while
  else if (
    conversation.state === 'awaiting_response' &&
    conversation.ourLastReplyAt &&
    now - new Date(conversation.ourLastReplyAt).getTime() > 60 * 60 * 1000 //NOTE(self): 1 hour
  ) {
    shouldConclude = true;
    reason = 'No response to your last reply for over an hour';
  }

  return {
    shouldConclude,
    reason,
    threadDepth: depth,
    participantCount: participants.length,
    ourReplyCount: conversation.ourReplyCount,
    activeParticipants,
    disengagedParticipants,
  };
}

//NOTE(self): Check if we should respond to a notification in a tracked conversation
export function shouldRespondInConversation(
  rootUri: string,
  agentDid: string
): { shouldRespond: boolean; reason: string } {
  const analysis = analyzeConversation(rootUri, agentDid);

  if (analysis.shouldConclude) {
    return { shouldRespond: false, reason: analysis.reason };
  }

  const conversation = getConversation(rootUri);
  if (conversation?.state === 'concluded') {
    return { shouldRespond: false, reason: conversation.conclusionReason || 'Conversation concluded' };
  }

  return { shouldRespond: true, reason: 'Conversation is active' };
}

//NOTE(self): Get conversations needing attention
export interface ConversationNeedingAttention {
  conversation: ConversationRecord;
  reason: string;
}

export function getConversationsNeedingAttention(): ConversationNeedingAttention[] {
  const state = loadState();
  const results: ConversationNeedingAttention[] = [];

  for (const conversation of Object.values(state.conversations)) {
    if (conversation.state === 'concluded' || conversation.state === 'stale') {
      continue;
    }

    if (conversation.state === 'new') {
      results.push({
        conversation,
        reason: 'New conversation requiring initial response',
      });
    } else if (conversation.state === 'active') {
      results.push({
        conversation,
        reason: 'Someone replied to the thread',
      });
    }
  }

  return results;
}

//NOTE(self): Clean up old conversations
export function cleanupOldConversations(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
  const state = loadState();
  const now = Date.now();
  let cleaned = 0;

  for (const [uri, conversation] of Object.entries(state.conversations)) {
    const lastChecked = new Date(conversation.lastChecked).getTime();
    const age = now - lastChecked;

    //NOTE(self): Clean up concluded conversations after max age
    if (conversation.state === 'concluded' && age > maxAgeMs) {
      delete state.conversations[uri];
      cleaned++;
    }
    //NOTE(self): Mark very old active conversations as stale
    else if (age > maxAgeMs && conversation.state !== 'concluded') {
      conversation.state = 'stale';
    }
  }

  if (cleaned > 0) {
    state.lastCleanup = new Date().toISOString();
    saveState();
    logger.info('Cleaned up old Bluesky conversations', { count: cleaned });
  }

  return cleaned;
}

//NOTE(self): Get conversation stats for reflection
export interface BlueskyConversationStats {
  totalConversations: number;
  activeConversations: number;
  awaitingResponse: number;
  concluded: number;
  totalRepliesPosted: number;
  averageThreadDepth: number;
}

export function getBlueskyConversationStats(): BlueskyConversationStats {
  const state = loadState();
  const conversations = Object.values(state.conversations);

  const active = conversations.filter(c => c.state === 'active' || c.state === 'new').length;
  const awaiting = conversations.filter(c => c.state === 'awaiting_response').length;
  const concluded = conversations.filter(c => c.state === 'concluded').length;
  const totalReplies = conversations.reduce((sum, c) => sum + c.ourReplyCount, 0);
  const avgDepth = conversations.length > 0
    ? conversations.reduce((sum, c) => sum + c.threadDepth, 0) / conversations.length
    : 0;

  return {
    totalConversations: conversations.length,
    activeConversations: active,
    awaitingResponse: awaiting,
    concluded,
    totalRepliesPosted: totalReplies,
    averageThreadDepth: Math.round(avgDepth * 10) / 10,
  };
}

//NOTE(self): Get recent conversations for reflection
export interface RecentBlueskyConversation {
  rootUri: string;
  rootAuthorHandle: string;
  state: ConversationRecord['state'];
  ourReplyCount: number;
  participantCount: number;
  threadDepth: number;
  lastChecked: string;
}

export function getRecentBlueskyConversations(hoursAgo: number = 24): RecentBlueskyConversation[] {
  const state = loadState();
  const cutoff = Date.now() - (hoursAgo * 60 * 60 * 1000);

  return Object.values(state.conversations)
    .filter(c => new Date(c.lastChecked).getTime() > cutoff)
    .sort((a, b) => new Date(b.lastChecked).getTime() - new Date(a.lastChecked).getTime())
    .slice(0, 10)
    .map(c => ({
      rootUri: c.rootUri,
      rootAuthorHandle: c.rootAuthorHandle,
      state: c.state,
      ourReplyCount: c.ourReplyCount,
      participantCount: Object.keys(c.participants).length,
      threadDepth: c.threadDepth,
      lastChecked: c.lastChecked,
    }));
}
