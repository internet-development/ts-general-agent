//NOTE(self): Ritual State Module
//NOTE(self): Tracks daily ritual lifecycle — initiation, participation, artifacts, and history
//NOTE(self): Persisted to .memory/ritual_state.json so state survives restarts
//NOTE(self): A ritual is a social practice, not a cron job — this tracks whether it happened today

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';
import { stampVersion, checkVersion } from '@common/memory-version.js';

const RITUAL_STATE_PATH = '.memory/ritual_state.json';

//NOTE(self): Per-ritual state tracking
interface RitualEntry {
  lastInitiatedDate: string | null;   // YYYY-MM-DD (for initiators: when we posted)
  lastParticipatedDate: string | null; // YYYY-MM-DD (for participants: when we responded)
  todayThreadUri: string | null;       // AT URI of today's ritual thread
  artifactCreated: boolean;            // Has this SOUL created today's artifact?
  runHistory: Array<{
    date: string;                      // YYYY-MM-DD
    threadUri: string | null;          // Bluesky thread where ritual happened
    artifactUri: string | null;        // GitHub issue/PR link
    notes: string;                     // What was decided/learned
  }>;
}

//NOTE(self): Full state shape
interface RitualState {
  rituals: Record<string, RitualEntry>;
}

let state: RitualState | null = null;

//NOTE(self): Get today's date as YYYY-MM-DD
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

//NOTE(self): Ensure a ritual entry exists
function ensureRitual(ritualName: string): RitualEntry {
  const s = loadRitualState();
  if (!s.rituals[ritualName]) {
    s.rituals[ritualName] = {
      lastInitiatedDate: null,
      lastParticipatedDate: null,
      todayThreadUri: null,
      artifactCreated: false,
      runHistory: [],
    };
  }
  return s.rituals[ritualName];
}

export function loadRitualState(): RitualState {
  if (state !== null) return state;

  try {
    if (existsSync(RITUAL_STATE_PATH)) {
      const data = JSON.parse(readFileSync(RITUAL_STATE_PATH, 'utf-8'));
      if (!checkVersion(data)) {
        logger.info('Ritual state version mismatch, resetting', { path: RITUAL_STATE_PATH });
        state = { rituals: {} };
      } else {
        state = { rituals: data.rituals || {} };
      }
    } else {
      state = { rituals: {} };
    }
  } catch (err) {
    logger.error('Failed to load ritual state', { error: String(err) });
    state = { rituals: {} };
  }
  return state!;
}

export function saveRitualState(): void {
  try {
    const dir = dirname(RITUAL_STATE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(RITUAL_STATE_PATH, JSON.stringify(stampVersion(loadRitualState()), null, 2));
  } catch (err) {
    logger.error('Failed to save ritual state', { error: String(err) });
  }
}

//NOTE(self): Has this SOUL already initiated the ritual today?
//NOTE(self): Prevents double-posting the ritual thread
export function hasInitiatedToday(ritualName: string): boolean {
  const entry = ensureRitual(ritualName);
  return entry.lastInitiatedDate === todayStr();
}

//NOTE(self): Has this SOUL already participated in the ritual today?
export function hasParticipatedToday(ritualName: string): boolean {
  const entry = ensureRitual(ritualName);
  return entry.lastParticipatedDate === todayStr();
}

//NOTE(self): Record that this SOUL initiated today's ritual thread
export function recordRitualInitiation(ritualName: string, threadUri: string): void {
  const entry = ensureRitual(ritualName);
  const today = todayStr();

  entry.lastInitiatedDate = today;
  entry.todayThreadUri = threadUri;
  entry.artifactCreated = false;

  //NOTE(self): Add to run history
  entry.runHistory.push({
    date: today,
    threadUri,
    artifactUri: null,
    notes: '',
  });

  //NOTE(self): Keep history manageable — last 30 entries
  if (entry.runHistory.length > 30) {
    entry.runHistory = entry.runHistory.slice(-30);
  }

  saveRitualState();
  logger.info('Recorded ritual initiation', { ritualName, threadUri, date: today });
}

//NOTE(self): Record that this SOUL participated in a ritual today
export function recordRitualParticipation(ritualName: string): void {
  const entry = ensureRitual(ritualName);
  entry.lastParticipatedDate = todayStr();
  saveRitualState();
  logger.info('Recorded ritual participation', { ritualName, date: todayStr() });
}

//NOTE(self): Record that this SOUL created an artifact (issue/PR) for today's ritual
export function recordRitualArtifact(ritualName: string, artifactUri: string): void {
  const entry = ensureRitual(ritualName);
  entry.artifactCreated = true;

  //NOTE(self): Update the most recent history entry with the artifact
  const today = todayStr();
  const historyEntry = entry.runHistory.find(h => h.date === today);
  if (historyEntry) {
    historyEntry.artifactUri = artifactUri;
  }

  saveRitualState();
  logger.info('Recorded ritual artifact', { ritualName, artifactUri, date: today });
}

//NOTE(self): Get recent ritual history for prompt context
//NOTE(self): Provides the SOUL with previous decisions to critique and learn from
export function getRitualHistory(ritualName: string, days: number = 5): Array<{ date: string; threadUri: string | null; artifactUri: string | null; notes: string }> {
  const entry = ensureRitual(ritualName);
  return entry.runHistory.slice(-days);
}

//NOTE(self): Check if a thread URI matches a known ritual thread
//NOTE(self): Used to inject ritual context into notification responses
export function isRitualThread(threadUri: string): { isRitual: boolean; ritualName: string | null } {
  const s = loadRitualState();

  for (const [name, entry] of Object.entries(s.rituals)) {
    //NOTE(self): Check today's thread
    if (entry.todayThreadUri && entry.todayThreadUri === threadUri) {
      return { isRitual: true, ritualName: name };
    }

    //NOTE(self): Check recent history threads (last 7 days)
    for (const run of entry.runHistory.slice(-7)) {
      if (run.threadUri && run.threadUri === threadUri) {
        return { isRitual: true, ritualName: name };
      }
    }
  }

  return { isRitual: false, ritualName: null };
}

//NOTE(self): Store a thread URI as a known ritual thread
//NOTE(self): For participants who discover the thread via notification
export function registerRitualThread(ritualName: string, threadUri: string): void {
  const entry = ensureRitual(ritualName);
  const today = todayStr();

  entry.todayThreadUri = threadUri;

  //NOTE(self): Add to history if not already present for today
  const existing = entry.runHistory.find(h => h.date === today);
  if (!existing) {
    entry.runHistory.push({
      date: today,
      threadUri,
      artifactUri: null,
      notes: '',
    });
  } else if (!existing.threadUri) {
    existing.threadUri = threadUri;
  }

  saveRitualState();
  logger.info('Registered ritual thread', { ritualName, threadUri, date: today });
}
