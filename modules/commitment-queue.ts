//NOTE(self): Commitment Queue Module
//NOTE(self): Tracks promises made in Bluesky replies and blocks further replies until fulfilled.
//NOTE(self): Follows the action-queue.ts pattern: JSONL persistence, audit log, in-memory cache.
//NOTE(self): If I say "I'll open 3 issues", this ensures I actually do it before chatting more.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '@modules/logger.js';

const QUEUE_FILE = '.memory/pending_commitments.jsonl';
const QUEUE_LOG_FILE = '.memory/logs/commitment-queue.log';
const MAX_ATTEMPTS = 3;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export type CommitmentStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'abandoned';
export type CommitmentType = 'create_issue' | 'create_plan' | 'comment_issue';

export interface Commitment {
  id: string;
  createdAt: string;
  description: string;
  type: CommitmentType;
  sourceThreadUri: string;
  sourceReplyText: string;
  params: Record<string, unknown>;
  status: CommitmentStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

interface CommitmentStats {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  abandoned: number;
}

//NOTE(self): In-memory cache for fast access
let queueCache: Commitment[] | null = null;

//NOTE(self): Deterministic hash for deduplication — same thread + same promise = same commitment
function generateHash(sourceThreadUri: string, description: string): string {
  const normalized = description.toLowerCase().trim().replace(/\s+/g, ' ');
  const input = `${sourceThreadUri}:${normalized}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

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

function auditLog(action: string, details: Record<string, unknown>): void {
  try {
    ensureQueueDir();
    const timestamp = new Date().toISOString();
    const entry = JSON.stringify({ timestamp, action, ...details }) + '\n';
    fs.appendFileSync(QUEUE_LOG_FILE, entry);
  } catch (err) {
    logger.warn('Failed to write commitment audit log', { error: String(err) });
  }
}

function loadQueue(): Commitment[] {
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
    queueCache = lines.map((line) => JSON.parse(line) as Commitment);

    //NOTE(self): Clean up old completed/abandoned commitments on load (keep 7 days for debugging)
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    queueCache = queueCache.filter((c) => {
      if (c.status === 'completed' || c.status === 'abandoned') {
        return new Date(c.createdAt).getTime() > oneWeekAgo;
      }
      return true;
    });

    return queueCache;
  } catch (err) {
    logger.error('Failed to load commitment queue', { error: String(err) });
    queueCache = [];
    return queueCache;
  }
}

function saveQueue(): void {
  if (queueCache === null) return;

  ensureQueueDir();

  try {
    const content = queueCache.map((c) => JSON.stringify(c)).join('\n');
    fs.writeFileSync(QUEUE_FILE, content + '\n');
  } catch (err) {
    logger.error('Failed to save commitment queue', { error: String(err) });
  }
}

//NOTE(self): Enqueue a new commitment — deduplicates via hash of thread URI + description
export function enqueueCommitment(params: {
  description: string;
  type: CommitmentType;
  sourceThreadUri: string;
  sourceReplyText: string;
  params: Record<string, unknown>;
}): Commitment | null {
  const queue = loadQueue();
  const hash = generateHash(params.sourceThreadUri, params.description);

  //NOTE(self): Dedup: check if same commitment already exists (not completed/abandoned)
  const existing = queue.find(
    (c) =>
      c.id.endsWith(hash) &&
      c.status !== 'completed' &&
      c.status !== 'abandoned'
  );
  if (existing) {
    auditLog('duplicate_rejected', { existingId: existing.id, description: params.description });
    logger.debug('Duplicate commitment rejected', { existingId: existing.id });
    return null;
  }

  const now = new Date().toISOString();
  const commitment: Commitment = {
    id: `commitment-${Date.now()}-${hash}`,
    createdAt: now,
    description: params.description,
    type: params.type,
    sourceThreadUri: params.sourceThreadUri,
    sourceReplyText: params.sourceReplyText,
    params: params.params,
    status: 'pending',
    attemptCount: 0,
    lastAttemptAt: null,
    error: null,
    result: null,
  };

  queue.push(commitment);
  queueCache = queue;
  saveQueue();

  auditLog('enqueued', {
    id: commitment.id,
    type: commitment.type,
    description: commitment.description,
  });

  logger.info('Commitment enqueued', { id: commitment.id, type: commitment.type });
  return commitment;
}

//NOTE(self): The reply-blocking check — returns true if there are unfulfilled commitments
//NOTE(self): Counts 'pending' and 'failed' with attempts < MAX as blocking
export function hasPendingCommitments(): boolean {
  const queue = loadQueue();
  return queue.some(
    (c) =>
      c.status === 'pending' ||
      c.status === 'in_progress' ||
      (c.status === 'failed' && c.attemptCount < MAX_ATTEMPTS)
  );
}

//NOTE(self): Get commitments that need work — sorted oldest first
export function getPendingCommitments(): Commitment[] {
  const queue = loadQueue();
  return queue
    .filter(
      (c) =>
        c.status === 'pending' ||
        (c.status === 'failed' && c.attemptCount < MAX_ATTEMPTS)
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function markCommitmentInProgress(id: string): void {
  const queue = loadQueue();
  const commitment = queue.find((c) => c.id === id);
  if (!commitment) return;

  commitment.status = 'in_progress';
  commitment.lastAttemptAt = new Date().toISOString();
  queueCache = queue;
  saveQueue();

  auditLog('in_progress', { id });
}

export function markCommitmentCompleted(id: string, result: Record<string, unknown>): void {
  const queue = loadQueue();
  const commitment = queue.find((c) => c.id === id);
  if (!commitment) return;

  commitment.status = 'completed';
  commitment.lastAttemptAt = new Date().toISOString();
  commitment.attemptCount++;
  commitment.result = result;
  commitment.error = null;
  queueCache = queue;
  saveQueue();

  auditLog('completed', { id, result });
  logger.info('Commitment completed', { id, type: commitment.type });
}

//NOTE(self): Mark failed — auto-abandons at MAX_ATTEMPTS
export function markCommitmentFailed(id: string, error: string): void {
  const queue = loadQueue();
  const commitment = queue.find((c) => c.id === id);
  if (!commitment) return;

  commitment.attemptCount++;
  commitment.lastAttemptAt = new Date().toISOString();
  commitment.error = error;

  if (commitment.attemptCount >= MAX_ATTEMPTS) {
    commitment.status = 'abandoned';
    auditLog('auto_abandoned', { id, attemptCount: commitment.attemptCount, error });
    logger.warn('Commitment auto-abandoned after max attempts', { id, attempts: commitment.attemptCount });
  } else {
    commitment.status = 'failed';
    auditLog('failed', { id, attemptCount: commitment.attemptCount, error });
    logger.warn('Commitment failed', { id, attempt: commitment.attemptCount, error });
  }

  queueCache = queue;
  saveQueue();
}

//NOTE(self): Commitments older than 24h that haven't been fulfilled → abandoned
//NOTE(self): Prevents permanent reply blocking from unfulfillable commitments
export function abandonStaleCommitments(): void {
  const queue = loadQueue();
  const now = Date.now();
  let abandoned = 0;

  for (const c of queue) {
    if (
      (c.status === 'pending' || c.status === 'failed' || c.status === 'in_progress') &&
      now - new Date(c.createdAt).getTime() > STALE_THRESHOLD_MS
    ) {
      c.status = 'abandoned';
      c.error = 'Stale: exceeded 24h threshold';
      auditLog('stale_abandoned', { id: c.id, age: now - new Date(c.createdAt).getTime() });
      abandoned++;
    }
  }

  if (abandoned > 0) {
    queueCache = queue;
    saveQueue();
    logger.info('Abandoned stale commitments', { count: abandoned });
  }
}

export function getCommitmentStats(): CommitmentStats {
  const queue = loadQueue();
  return {
    pending: queue.filter((c) => c.status === 'pending').length,
    inProgress: queue.filter((c) => c.status === 'in_progress').length,
    completed: queue.filter((c) => c.status === 'completed').length,
    failed: queue.filter((c) => c.status === 'failed').length,
    abandoned: queue.filter((c) => c.status === 'abandoned').length,
  };
}
