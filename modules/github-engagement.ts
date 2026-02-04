/**
 * GitHub Engagement Module
 *
 * //NOTE(self): Track GitHub conversations and know when to engage
 * //NOTE(self): seenAt timestamp for restart recovery
 * //NOTE(self): Conversation state tracking to know when to stop
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';

//NOTE(self): Path to GitHub engagement state
const GITHUB_ENGAGEMENT_PATH = '.memory/github_engagement.json';

//NOTE(self): Conversation state - tracks our engagement with each issue/PR
interface ConversationRecord {
  owner: string;
  repo: string;
  number: number;
  type: 'issue' | 'pull';
  url: string;
  //NOTE(self): When we first saw this conversation
  firstSeen: string;
  //NOTE(self): When we last checked it
  lastChecked: string;
  //NOTE(self): When we last commented (null if never)
  lastCommentedAt: string | null;
  //NOTE(self): Our comment ID (for tracking)
  ourCommentId: number | null;
  //NOTE(self): Number of our comments in this thread
  ourCommentCount: number;
  //NOTE(self): State of the conversation
  state: 'new' | 'active' | 'awaiting_response' | 'concluded' | 'closed';
  //NOTE(self): Why we think the conversation is concluded
  conclusionReason?: string;
  //NOTE(self): Source that triggered our engagement (e.g., "bluesky_mention", "github_notification")
  source: string;
}

interface GitHubEngagementState {
  //NOTE(self): seenAt for GitHub notifications (restart recovery)
  seenAt: string | null;
  //NOTE(self): Active conversations we're tracking
  conversations: Record<string, ConversationRecord>;
  //NOTE(self): Last time we checked GitHub notifications
  lastNotificationCheck: string | null;
}

let engagementState: GitHubEngagementState | null = null;

function getDefaultState(): GitHubEngagementState {
  return {
    seenAt: null,
    conversations: {},
    lastNotificationCheck: null,
  };
}

function loadState(): GitHubEngagementState {
  if (engagementState !== null) return engagementState;

  try {
    if (existsSync(GITHUB_ENGAGEMENT_PATH)) {
      const data = JSON.parse(readFileSync(GITHUB_ENGAGEMENT_PATH, 'utf-8'));
      engagementState = {
        seenAt: data.seenAt || null,
        conversations: data.conversations || {},
        lastNotificationCheck: data.lastNotificationCheck || null,
      };
      logger.debug('Loaded GitHub engagement state', {
        conversationCount: Object.keys(engagementState.conversations).length,
      });
    } else {
      engagementState = getDefaultState();
    }
  } catch (err) {
    logger.error('Failed to load GitHub engagement state', { error: String(err) });
    engagementState = getDefaultState();
  }
  return engagementState;
}

function saveState(): void {
  try {
    const dir = dirname(GITHUB_ENGAGEMENT_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(GITHUB_ENGAGEMENT_PATH, JSON.stringify(engagementState, null, 2));
  } catch (err) {
    logger.error('Failed to save GitHub engagement state', { error: String(err) });
  }
}

//NOTE(self): Generate unique key for a conversation
function getConversationKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

//NOTE(self): seenAt management for GitHub notifications
export function getGitHubSeenAt(): Date | null {
  const state = loadState();
  return state.seenAt ? new Date(state.seenAt) : null;
}

export function updateGitHubSeenAt(timestamp: Date): void {
  const state = loadState();
  state.seenAt = timestamp.toISOString();
  saveState();
  logger.debug('Updated GitHub seenAt', { seenAt: state.seenAt });
}

export function getLastNotificationCheck(): Date | null {
  const state = loadState();
  return state.lastNotificationCheck ? new Date(state.lastNotificationCheck) : null;
}

export function updateLastNotificationCheck(): void {
  const state = loadState();
  state.lastNotificationCheck = new Date().toISOString();
  saveState();
}

//NOTE(self): Conversation tracking
export function getConversation(
  owner: string,
  repo: string,
  number: number
): ConversationRecord | null {
  const state = loadState();
  const key = getConversationKey(owner, repo, number);
  return state.conversations[key] || null;
}

export function trackConversation(
  owner: string,
  repo: string,
  number: number,
  type: 'issue' | 'pull',
  url: string,
  source: string
): ConversationRecord {
  const state = loadState();
  const key = getConversationKey(owner, repo, number);

  if (state.conversations[key]) {
    //NOTE(self): Update existing conversation
    state.conversations[key].lastChecked = new Date().toISOString();
    saveState();
    return state.conversations[key];
  }

  //NOTE(self): Create new conversation record
  const record: ConversationRecord = {
    owner,
    repo,
    number,
    type,
    url,
    firstSeen: new Date().toISOString(),
    lastChecked: new Date().toISOString(),
    lastCommentedAt: null,
    ourCommentId: null,
    ourCommentCount: 0,
    state: 'new',
    source,
  };

  state.conversations[key] = record;
  saveState();

  logger.info('Tracking new GitHub conversation', { key, source });
  return record;
}

export function recordOurComment(
  owner: string,
  repo: string,
  number: number,
  commentId: number
): void {
  const state = loadState();
  const key = getConversationKey(owner, repo, number);

  if (!state.conversations[key]) {
    logger.warn('Recording comment for untracked conversation', { key });
    return;
  }

  state.conversations[key].lastCommentedAt = new Date().toISOString();
  state.conversations[key].ourCommentId = commentId;
  state.conversations[key].ourCommentCount++;
  state.conversations[key].state = 'awaiting_response';
  saveState();

  logger.debug('Recorded our comment', { key, commentId });
}

export function updateConversationState(
  owner: string,
  repo: string,
  number: number,
  newState: ConversationRecord['state'],
  reason?: string
): void {
  const state = loadState();
  const key = getConversationKey(owner, repo, number);

  if (!state.conversations[key]) {
    logger.warn('Updating state for untracked conversation', { key });
    return;
  }

  state.conversations[key].state = newState;
  state.conversations[key].lastChecked = new Date().toISOString();
  if (reason) {
    state.conversations[key].conclusionReason = reason;
  }
  saveState();

  logger.debug('Updated conversation state', { key, newState, reason });
}

export function markConversationConcluded(
  owner: string,
  repo: string,
  number: number,
  reason: string
): void {
  updateConversationState(owner, repo, number, 'concluded', reason);
}

//NOTE(self): Get conversations that need attention
export interface ConversationNeedingAttention {
  conversation: ConversationRecord;
  reason: string;
}

export function getConversationsNeedingAttention(): ConversationNeedingAttention[] {
  const state = loadState();
  const results: ConversationNeedingAttention[] = [];

  for (const conversation of Object.values(state.conversations)) {
    //NOTE(self): Skip concluded or closed conversations
    if (conversation.state === 'concluded' || conversation.state === 'closed') {
      continue;
    }

    //NOTE(self): New conversations we haven't engaged with yet
    if (conversation.state === 'new') {
      results.push({
        conversation,
        reason: 'New conversation requiring initial response',
      });
      continue;
    }

    //NOTE(self): Active conversations (someone replied to us)
    if (conversation.state === 'active') {
      results.push({
        conversation,
        reason: 'Someone replied to your comment',
      });
      continue;
    }
  }

  return results;
}

//NOTE(self): Clean up old concluded conversations (housekeeping)
export function cleanupOldConversations(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
  const state = loadState();
  const now = Date.now();
  let cleaned = 0;

  for (const [key, conversation] of Object.entries(state.conversations)) {
    if (conversation.state === 'concluded' || conversation.state === 'closed') {
      const lastChecked = new Date(conversation.lastChecked).getTime();
      if (now - lastChecked > maxAgeMs) {
        delete state.conversations[key];
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    saveState();
    logger.info('Cleaned up old GitHub conversations', { count: cleaned });
  }

  return cleaned;
}

//NOTE(self): Get conversation stats for reflection
export interface GitHubEngagementStats {
  totalConversations: number;
  activeConversations: number;
  awaitingResponse: number;
  concluded: number;
  totalCommentsPosted: number;
}

export function getGitHubEngagementStats(): GitHubEngagementStats {
  const state = loadState();
  const conversations = Object.values(state.conversations);

  return {
    totalConversations: conversations.length,
    activeConversations: conversations.filter(c => c.state === 'active' || c.state === 'new').length,
    awaitingResponse: conversations.filter(c => c.state === 'awaiting_response').length,
    concluded: conversations.filter(c => c.state === 'concluded').length,
    totalCommentsPosted: conversations.reduce((sum, c) => sum + c.ourCommentCount, 0),
  };
}

//NOTE(self): Get recent GitHub conversations for reflection
//NOTE(self): Returns conversations that were active in the last N hours
export interface RecentGitHubConversation {
  url: string;
  repo: string;
  state: ConversationRecord['state'];
  ourCommentCount: number;
  source: string;
  lastChecked: string;
}

export function getRecentGitHubConversations(hoursAgo: number = 24): RecentGitHubConversation[] {
  const state = loadState();
  const cutoff = Date.now() - (hoursAgo * 60 * 60 * 1000);

  return Object.values(state.conversations)
    .filter(c => new Date(c.lastChecked).getTime() > cutoff)
    .sort((a, b) => new Date(b.lastChecked).getTime() - new Date(a.lastChecked).getTime())
    .slice(0, 10) //NOTE(self): Limit to 10 most recent for reflection
    .map(c => ({
      url: c.url,
      repo: `${c.owner}/${c.repo}`,
      state: c.state,
      ourCommentCount: c.ourCommentCount,
      source: c.source,
      lastChecked: c.lastChecked,
    }));
}
