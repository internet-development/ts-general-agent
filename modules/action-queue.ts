//NOTE(self): Action Queue Module
//NOTE(self): A resilient, persistent queue for outbound actions (especially replies).
//NOTE(self): Ensures follow-through when rate limits or breathing pauses defer actions.
//NOTE(self): Every started conversation deserves completion. Reliability builds trust.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '@modules/logger.js';

//NOTE(self): Queue file location - JSONL format for append-efficiency and easy inspection
const QUEUE_FILE = '.memory/pending_actions.jsonl';
const QUEUE_LOG_FILE = '.memory/logs/action-queue.log';
const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 30 * 60 * 1000; // 30 minutes max backoff
const BASE_BACKOFF_MS = 30 * 1000; // 30 seconds initial backoff

export type ActionStatus = 'pending' | 'sent' | 'deferred' | 'failed' | 'abandoned';
export type ActionPriority = 'owner' | 'high' | 'normal' | 'low';

export interface QueuedAction {
  id: string;
  createdAt: string;
  target: {
    post_uri: string;
    post_cid: string;
    root_uri?: string;
    root_cid?: string;
    author_handle?: string;
    author_did?: string;
  };
  text: string;
  textHash: string;
  priority: ActionPriority;
  status: ActionStatus;
  lastAttemptAt: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
  error: string | null;
  threadRootUri?: string; // For grouping notifications by thread
}

interface QueueStats {
  pending: number;
  deferred: number;
  failed: number;
  total: number;
  oldestPending: string | null;
}

//NOTE(self): In-memory cache of the queue for fast access
let queueCache: QueuedAction[] | null = null;

//NOTE(self): Generate a deterministic hash for deduplication
//NOTE(self): Key: post_uri + normalized text (lowercased, trimmed, whitespace collapsed)
function generateTextHash(postUri: string, text: string): string {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
  const input = `${postUri}:${normalized}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

//NOTE(self): Calculate exponential backoff with jitter
function calculateBackoff(attemptCount: number): number {
  const exponential = BASE_BACKOFF_MS * Math.pow(2, attemptCount - 1);
  const jitter = Math.random() * 0.3 * exponential; // 0-30% jitter
  return Math.min(exponential + jitter, MAX_BACKOFF_MS);
}

//NOTE(self): Ensure the queue directory exists
function ensureQueueDir(): void {
  const queueDir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
  }
  const logDir = path.dirname(QUEUE_LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

//NOTE(self): Append a log entry for audit trail
function auditLog(action: string, details: Record<string, unknown>): void {
  try {
    ensureQueueDir();
    const timestamp = new Date().toISOString();
    const entry = JSON.stringify({ timestamp, action, ...details }) + '\n';
    fs.appendFileSync(QUEUE_LOG_FILE, entry);
  } catch (err) {
    logger.warn('Failed to write audit log', { error: String(err) });
  }
}

//NOTE(self): Load the queue from disk
function loadQueue(): QueuedAction[] {
  if (queueCache !== null) {
    return queueCache;
  }

  ensureQueueDir();

  if (!fs.existsSync(QUEUE_FILE)) {
    queueCache = [];
    return queueCache;
  }

  try {
    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    queueCache = lines.map((line) => JSON.parse(line) as QueuedAction);

    //NOTE(self): Clean up old completed/abandoned actions on load
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    queueCache = queueCache.filter((action) => {
      if (action.status === 'sent' || action.status === 'abandoned') {
        const createdAt = new Date(action.createdAt).getTime();
        return createdAt > oneWeekAgo; // Keep recent history for debugging
      }
      return true;
    });

    return queueCache;
  } catch (err) {
    logger.error('Failed to load action queue', { error: String(err) });
    queueCache = [];
    return queueCache;
  }
}

//NOTE(self): Save the queue to disk (full rewrite)
function saveQueue(): void {
  if (queueCache === null) return;

  ensureQueueDir();

  try {
    const content = queueCache.map((action) => JSON.stringify(action)).join('\n');
    fs.writeFileSync(QUEUE_FILE, content + '\n');
  } catch (err) {
    logger.error('Failed to save action queue', { error: String(err) });
  }
}

//NOTE(self): Check if an action already exists (deduplication)
//NOTE(self): Returns the existing action if found, null otherwise
export function findDuplicate(postUri: string, text: string): QueuedAction | null {
  const queue = loadQueue();
  const hash = generateTextHash(postUri, text);

  return queue.find(
    (action) =>
      action.textHash === hash &&
      action.target.post_uri === postUri &&
      action.status !== 'sent' &&
      action.status !== 'abandoned'
  ) || null;
}

//NOTE(self): Enqueue a new action (typically a reply)
//NOTE(self): Returns { enqueued: true, action } or { enqueued: false, reason, existingAction? }
export function enqueueAction(params: {
  target: QueuedAction['target'];
  text: string;
  priority?: ActionPriority;
  threadRootUri?: string;
}): { enqueued: boolean; action?: QueuedAction; reason?: string; existingAction?: QueuedAction } {
  const { target, text, priority = 'normal', threadRootUri } = params;

  //NOTE(self): Check for duplicates first
  const existing = findDuplicate(target.post_uri, text);
  if (existing) {
    auditLog('duplicate_rejected', {
      existingId: existing.id,
      postUri: target.post_uri,
      textPreview: text.slice(0, 50)
    });
    return {
      enqueued: false,
      reason: 'Duplicate action already queued',
      existingAction: existing
    };
  }

  const now = new Date().toISOString();
  const action: QueuedAction = {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    target,
    text,
    textHash: generateTextHash(target.post_uri, text),
    priority,
    status: 'pending',
    lastAttemptAt: null,
    attemptCount: 0,
    nextRetryAt: null,
    error: null,
    threadRootUri: threadRootUri || target.root_uri,
  };

  const queue = loadQueue();
  queue.push(action);
  queueCache = queue;
  saveQueue();

  auditLog('enqueued', {
    id: action.id,
    priority,
    target: target.post_uri,
    textPreview: text.slice(0, 50)
  });

  logger.info('Action enqueued', { id: action.id, priority, target: target.post_uri });

  return { enqueued: true, action };
}

//NOTE(self): Mark an action as deferred (rate limit hit, etc.)
//NOTE(self): Schedules retry with exponential backoff
export function deferAction(id: string, reason: string): QueuedAction | null {
  const queue = loadQueue();
  const action = queue.find((a) => a.id === id);

  if (!action) {
    logger.warn('Attempted to defer non-existent action', { id });
    return null;
  }

  action.status = 'deferred';
  action.lastAttemptAt = new Date().toISOString();
  action.attemptCount++;
  action.error = reason;

  //NOTE(self): Check if we've hit max attempts
  if (action.attemptCount >= MAX_ATTEMPTS) {
    action.status = 'failed';
    action.nextRetryAt = null;
    auditLog('max_attempts_reached', { id, attemptCount: action.attemptCount, reason });
    logger.warn('Action failed after max attempts', { id, attempts: action.attemptCount });
  } else {
    //NOTE(self): Schedule retry with exponential backoff
    const backoffMs = calculateBackoff(action.attemptCount);
    action.nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
    auditLog('deferred', {
      id,
      attemptCount: action.attemptCount,
      reason,
      nextRetryAt: action.nextRetryAt,
      backoffMs
    });
    logger.info('Action deferred', {
      id,
      attempt: action.attemptCount,
      nextRetry: action.nextRetryAt
    });
  }

  queueCache = queue;
  saveQueue();
  return action;
}

//NOTE(self): Mark an action as successfully sent
export function markActionSent(id: string, responseUri?: string): QueuedAction | null {
  const queue = loadQueue();
  const action = queue.find((a) => a.id === id);

  if (!action) {
    logger.warn('Attempted to mark non-existent action as sent', { id });
    return null;
  }

  action.status = 'sent';
  action.lastAttemptAt = new Date().toISOString();
  action.attemptCount++;
  action.error = null;
  action.nextRetryAt = null;

  auditLog('sent', { id, attemptCount: action.attemptCount, responseUri });
  logger.info('Action sent successfully', { id, attempts: action.attemptCount });

  queueCache = queue;
  saveQueue();
  return action;
}

//NOTE(self): Mark an action as abandoned (requires human intervention)
export function abandonAction(id: string, reason: string): QueuedAction | null {
  const queue = loadQueue();
  const action = queue.find((a) => a.id === id);

  if (!action) {
    logger.warn('Attempted to abandon non-existent action', { id });
    return null;
  }

  action.status = 'abandoned';
  action.error = reason;
  action.nextRetryAt = null;

  auditLog('abandoned', { id, reason });
  logger.info('Action abandoned', { id, reason });

  queueCache = queue;
  saveQueue();
  return action;
}

//NOTE(self): Get all actions ready for retry (deferred with nextRetryAt in the past)
//NOTE(self): Returns actions sorted by priority, then by oldest first
export function getRetryableActions(): QueuedAction[] {
  const queue = loadQueue();
  const now = Date.now();

  const retryable = queue.filter((action) => {
    if (action.status !== 'pending' && action.status !== 'deferred') {
      return false;
    }
    if (action.status === 'deferred' && action.nextRetryAt) {
      const retryTime = new Date(action.nextRetryAt).getTime();
      return retryTime <= now;
    }
    return action.status === 'pending';
  });

  //NOTE(self): Sort by priority, then by creation time
  const priorityOrder: Record<ActionPriority, number> = {
    owner: 0,
    high: 1,
    normal: 2,
    low: 3,
  };

  return retryable.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

//NOTE(self): Get failed actions that need human review
export function getFailedActions(): QueuedAction[] {
  const queue = loadQueue();
  return queue.filter((a) => a.status === 'failed');
}

//NOTE(self): Get queue statistics
export function getQueueStats(): QueueStats {
  const queue = loadQueue();

  const pending = queue.filter((a) => a.status === 'pending' || a.status === 'deferred');
  const deferred = queue.filter((a) => a.status === 'deferred');
  const failed = queue.filter((a) => a.status === 'failed');

  let oldestPending: string | null = null;
  if (pending.length > 0) {
    const sorted = pending.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    oldestPending = sorted[0].createdAt;
  }

  return {
    pending: pending.length,
    deferred: deferred.length,
    failed: failed.length,
    total: queue.length,
    oldestPending,
  };
}

//NOTE(self): Group queued actions by thread root URI for triage
//NOTE(self): This helps identify which threads have multiple pending actions
export function groupByThread(): Map<string, QueuedAction[]> {
  const queue = loadQueue();
  const groups = new Map<string, QueuedAction[]>();

  for (const action of queue) {
    if (action.status === 'sent' || action.status === 'abandoned') continue;

    const threadKey = action.threadRootUri || action.target.root_uri || action.target.post_uri;
    if (!groups.has(threadKey)) {
      groups.set(threadKey, []);
    }
    groups.get(threadKey)!.push(action);
  }

  return groups;
}

//NOTE(self): Clear the in-memory cache (useful for testing or forced reload)
export function clearCache(): void {
  queueCache = null;
}

//NOTE(self): Get a specific action by ID
export function getAction(id: string): QueuedAction | null {
  const queue = loadQueue();
  return queue.find((a) => a.id === id) || null;
}

//NOTE(self): Remove an action from the queue entirely (cleanup)
export function removeAction(id: string): boolean {
  const queue = loadQueue();
  const index = queue.findIndex((a) => a.id === id);

  if (index === -1) return false;

  queue.splice(index, 1);
  queueCache = queue;
  saveQueue();

  auditLog('removed', { id });
  return true;
}
