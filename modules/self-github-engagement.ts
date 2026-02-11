//NOTE(self): GitHub Engagement Module
//NOTE(self): Track GitHub conversations and know when to engage
//NOTE(self): seenAt timestamp for restart recovery
//NOTE(self): Conversation state tracking to know when to stop

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';
import { isWatchingWorkspace } from '@modules/self-github-workspace-discovery.js';

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
  //NOTE(self): When the conversation was concluded (for re-engagement detection)
  concludedAt: string | null;
  //NOTE(self): How many times we've re-engaged after concluding (cap at 1)
  reengagementCount: number;
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
  if (!engagementState) return;

  try {
    const dir = dirname(GITHUB_ENGAGEMENT_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = GITHUB_ENGAGEMENT_PATH + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(engagementState, null, 2));
    renameSync(tmpPath, GITHUB_ENGAGEMENT_PATH);
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
    concludedAt: null,
    reengagementCount: 0,
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
  if (newState === 'concluded') {
    state.conversations[key].concludedAt = new Date().toISOString();
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

  for (const [key, conversation] of Object.entries(state.conversations)) {
    //NOTE(self): Skip closed conversations entirely
    if (conversation.state === 'closed') {
      continue;
    }

    //NOTE(self): Check concluded conversations for re-engagement
    //NOTE(self): Workspace issues get unlimited re-engagement; casual threads capped at 1
    if (conversation.state === 'concluded') {
      const reengageCount = conversation.reengagementCount ?? 0;
      const isWorkspace = isWatchingWorkspace(conversation.owner, conversation.repo);
      const reengageLimit = isWorkspace ? Infinity : 1;
      if (reengageCount < reengageLimit && conversation.concludedAt) {
        const concludedTime = new Date(conversation.concludedAt).getTime();
        const lastCheckedTime = new Date(conversation.lastChecked).getTime();
        //NOTE(self): If lastChecked is newer than concludedAt, someone may have updated it
        //NOTE(self): This is a lightweight signal — the actual comment check happens when we fetch the thread
        if (lastCheckedTime > concludedTime) {
          conversation.state = 'active';
          conversation.reengagementCount = reengageCount + 1;
          saveState();
          results.push({
            conversation,
            reason: 'Re-engagement detected after conclusion',
          });
        }
      }
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
