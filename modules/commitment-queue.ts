//NOTE(self): Commitment Queue Module
//NOTE(self): Tracks promises made in Bluesky replies and blocks further replies until fulfilled.
//NOTE(self): Uses JSONL persistence, audit log, in-memory cache.
//NOTE(self): If I say "I'll open 3 issues", this ensures I actually do it before chatting more.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '@modules/logger.js';
import { resetJsonlIfVersionMismatch, stampJsonlVersion } from '@common/memory-version.js';
import { COMMITMENT_MAX_ATTEMPTS, COMMITMENT_STALE_THRESHOLD_MS, COMMITMENT_IN_PROGRESS_TIMEOUT_MS } from '@common/config.js';

const QUEUE_FILE = '.memory/pending_commitments.jsonl';
const QUEUE_LOG_FILE = '.memory/logs/commitment-queue.log';
const MAX_ATTEMPTS = COMMITMENT_MAX_ATTEMPTS;
const STALE_THRESHOLD_MS = COMMITMENT_STALE_THRESHOLD_MS;

export type CommitmentStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'abandoned';
export type CommitmentType = 'create_issue' | 'create_plan' | 'comment_issue' | 'post_bluesky';

export interface Commitment {
  id: string;
  createdAt: string;
  description: string;
  type: CommitmentType;
  sourceThreadUri: string;
  sourceReplyText: string;
  params: Record<string, unknown>;
  source?: 'bluesky' | 'space';
  status: CommitmentStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

//NOTE(self): In-memory cache for fast access
let queueCache: Commitment[] | null = null;

/** @internal Test-only: reset the in-memory cache so loadQueue re-reads from disk */
export function _resetQueueCacheForTesting(): void {
  queueCache = null;
}

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

  if (resetJsonlIfVersionMismatch(QUEUE_FILE)) {
    logger.info('Memory file version mismatch, resetting', { path: QUEUE_FILE });
    queueCache = [];
    return queueCache;
  }

  if (!fs.existsSync(QUEUE_FILE)) {
    queueCache = [];
    return queueCache;
  }

  try {
    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    queueCache = [];
    for (const line of lines) {
      try {
        queueCache.push(JSON.parse(line) as Commitment);
      } catch {
        logger.warn('Skipping corrupted commitment queue line', { line: line.slice(0, 100) });
      }
    }

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
    stampJsonlVersion(QUEUE_FILE);
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
  source?: 'bluesky' | 'space';
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
    logger.info('Duplicate commitment rejected', { existingId: existing.id });
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
    source: params.source || 'bluesky',
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

//NOTE(self): Timeout in-progress commitments stuck for >10 minutes
//NOTE(self): Prevents stale commitments from previous conversations causing false "Peer already committed" declines
//NOTE(self): Marks as 'failed' (retryable) — auto-abandons if attemptCount >= MAX_ATTEMPTS
export function timeoutInProgressCommitments(): void {
  const queue = loadQueue();
  const now = Date.now();
  let timedOut = 0;

  for (const c of queue) {
    if (
      c.status === 'in_progress' &&
      c.lastAttemptAt &&
      now - new Date(c.lastAttemptAt).getTime() > COMMITMENT_IN_PROGRESS_TIMEOUT_MS
    ) {
      c.attemptCount++;
      c.error = `Timed out: in_progress for >${COMMITMENT_IN_PROGRESS_TIMEOUT_MS / 60000}m`;
      if (c.attemptCount >= MAX_ATTEMPTS) {
        c.status = 'abandoned';
        auditLog('timeout_abandoned', { id: c.id, attemptCount: c.attemptCount });
        logger.warn('Commitment timed out and abandoned', { id: c.id, attempts: c.attemptCount });
      } else {
        c.status = 'failed';
        auditLog('timeout_failed', { id: c.id, attemptCount: c.attemptCount });
        logger.warn('Commitment timed out (retryable)', { id: c.id, attempt: c.attemptCount });
      }
      timedOut++;
    }
  }

  if (timedOut > 0) {
    queueCache = queue;
    saveQueue();
    logger.info('Timed out in-progress commitments', { count: timedOut });
  }
}

//NOTE(self): Commitments older than 24h that haven't been fulfilled → abandoned
//NOTE(self): Prevents permanent reply blocking from unfulfillable commitments
//NOTE(self): Get recently completed commitments within a time window — for space prompt context
export function getRecentlyCompletedCommitments(withinMs: number): Commitment[] {
  const queue = loadQueue();
  const cutoff = Date.now() - withinMs;
  return queue
    .filter(c => c.status === 'completed' && c.lastAttemptAt && new Date(c.lastAttemptAt).getTime() > cutoff)
    .sort((a, b) => new Date(b.lastAttemptAt!).getTime() - new Date(a.lastAttemptAt!).getTime());
}

//NOTE(self): Analyze commitment outcome patterns — for reflection/self-improvement
//NOTE(self): Returns failure patterns grouped by type and repo so the agent can learn
export function getCommitmentOutcomePatterns(): { successes: number; failures: number; patterns: string[] } {
  const queue = loadQueue();
  const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // Last 7 days

  const recent = queue.filter(c => new Date(c.createdAt).getTime() > recentCutoff);
  const successes = recent.filter(c => c.status === 'completed').length;
  const failures = recent.filter(c => c.status === 'failed' || c.status === 'abandoned').length;

  //NOTE(self): Group failures by type and error pattern
  const failuresByType = new Map<string, { count: number; errors: Set<string> }>();
  for (const c of recent.filter(c => c.status === 'failed' || c.status === 'abandoned')) {
    const key = `${c.type}:${(c.params?.owner as string) || 'unknown'}/${(c.params?.repoName as string) || 'unknown'}`;
    const entry = failuresByType.get(key) || { count: 0, errors: new Set<string>() };
    entry.count++;
    if (c.error) entry.errors.add(c.error.slice(0, 60));
    failuresByType.set(key, entry);
  }

  const patterns: string[] = [];
  for (const [key, { count, errors }] of failuresByType.entries()) {
    if (count >= 2) {
      patterns.push(`${key}: ${count} failures (${[...errors].join('; ')})`);
    }
  }

  return { successes, failures, patterns };
}

//NOTE(self): Repo cooldown system — auto-cooldown repos that repeatedly fail
//NOTE(self): If a repo shows >5 failures in 7 days, cooldown for 48h
const REPO_COOLDOWN_FILE = '.memory/repo_cooldown.json';
const REPO_COOLDOWN_THRESHOLD = 5; // failures in window to trigger cooldown
const REPO_COOLDOWN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REPO_COOLDOWN_DURATION_MS = 48 * 60 * 60 * 1000; // 48 hours

interface RepoCooldown {
  owner: string;
  repo: string;
  cooldownUntil: string; // ISO 8601
  reason: string;
}

function loadRepoCooldowns(): RepoCooldown[] {
  try {
    if (fs.existsSync(REPO_COOLDOWN_FILE)) {
      return JSON.parse(fs.readFileSync(REPO_COOLDOWN_FILE, 'utf-8')) as RepoCooldown[];
    }
  } catch (err) {
    logger.warn('Failed to load repo cooldowns', { error: String(err) });
  }
  return [];
}

function saveRepoCooldowns(cooldowns: RepoCooldown[]): void {
  try {
    const dir = path.dirname(REPO_COOLDOWN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REPO_COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2));
  } catch (err) {
    logger.warn('Failed to save repo cooldowns', { error: String(err) });
  }
}

//NOTE(self): Check if a repo is currently cooled down
export function isRepoCooledDown(owner: string, repo: string): boolean {
  const cooldowns = loadRepoCooldowns();
  const key = `${owner}/${repo}`;
  const entry = cooldowns.find(c => `${c.owner}/${c.repo}` === key);
  if (entry && new Date(entry.cooldownUntil).getTime() > Date.now()) {
    return true;
  }
  return false;
}

//NOTE(self): Analyze commitment failure patterns and apply cooldowns
//NOTE(self): Called at the start of commitmentFulfillmentCheck()
export function checkAndApplyRepoCooldown(): void {
  const { patterns } = getCommitmentOutcomePatterns();
  const cooldowns = loadRepoCooldowns();
  let updated = false;

  for (const pattern of patterns) {
    //NOTE(self): Pattern format: "type:owner/repo: N failures (errors)"
    const match = pattern.match(/^[^:]+:([^/]+)\/([^:]+):\s*(\d+)\s*failures/);
    if (!match) continue;

    const [, owner, repo, countStr] = match;
    const count = parseInt(countStr, 10);

    if (count >= REPO_COOLDOWN_THRESHOLD) {
      const key = `${owner}/${repo}`;
      const existing = cooldowns.find(c => `${c.owner}/${c.repo}` === key);
      if (existing && new Date(existing.cooldownUntil).getTime() > Date.now()) {
        continue; // Already cooled down
      }

      const cooldownUntil = new Date(Date.now() + REPO_COOLDOWN_DURATION_MS).toISOString();
      const newCooldown: RepoCooldown = { owner, repo, cooldownUntil, reason: pattern };

      const idx = cooldowns.findIndex(c => `${c.owner}/${c.repo}` === key);
      if (idx >= 0) {
        cooldowns[idx] = newCooldown;
      } else {
        cooldowns.push(newCooldown);
      }
      updated = true;
      logger.warn('Repo cooldown applied', { owner, repo, cooldownUntil, reason: pattern });
    }
  }

  //NOTE(self): Clean up expired cooldowns
  const now = Date.now();
  const cleaned = cooldowns.filter(c => new Date(c.cooldownUntil).getTime() > now);
  if (cleaned.length !== cooldowns.length) updated = true;

  if (updated) {
    saveRepoCooldowns(cleaned);
  }
}

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

