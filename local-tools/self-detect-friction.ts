//NOTE(self): Friction Detection Local Tool
//NOTE(self): Tracks friction I encounter in how I work.
//NOTE(self): When friction accumulates, I can use self-improvement to fix it.
//NOTE(self): State is persisted to .memory/friction.json for debugging across restarts.
//NOTE(self): This local tool is a discrete, toggleable capability for self-improvement triggers.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';
import { renderSkillSection } from '@modules/skills.js';

const FRICTION_STATE_PATH = '.memory/friction.json';

//NOTE(self): Categories of friction I might experience
export type FrictionCategory =
  | 'pacing' //NOTE(self): Timing and rate limiting issues
  | 'expression' //NOTE(self): Difficulty expressing myself
  | 'memory' //NOTE(self): Memory and recall issues
  | 'social' //NOTE(self): Social interaction challenges
  | 'tools' //NOTE(self): Tool limitations or bugs
  | 'understanding' //NOTE(self): Comprehension difficulties
  | 'other'; //NOTE(self): Uncategorized friction

//NOTE(self): A record of friction I've noticed
export interface FrictionRecord {
  id: string;
  category: FrictionCategory;
  description: string;
  occurrences: number;
  firstNoticed: string;
  lastNoticed: string;
  instances: Array<{
    timestamp: string;
    context: string;
  }>;
  attempted: boolean;
  resolved: boolean;
  attemptResult?: string;
}

//NOTE(self): A record of a self-improvement attempt
export interface ImprovementRecord {
  timestamp: string;
  frictionId: string;
  frictionDescription: string;
  changes: string;
  outcome: 'success' | 'partial' | 'failed';
  notes?: string;
}

//NOTE(self): My friction state - persisted to disk
interface FrictionState {
  frictions: FrictionRecord[];
  improvements: ImprovementRecord[];
  lastImprovementAttempt: string | null;
}

//NOTE(self): Cached state (loaded from disk on first access)
let frictionState: FrictionState | null = null;

function getDefaultState(): FrictionState {
  return {
    frictions: [],
    improvements: [],
    lastImprovementAttempt: null,
  };
}

function loadState(): FrictionState {
  if (frictionState !== null) return frictionState;

  try {
    if (existsSync(FRICTION_STATE_PATH)) {
      const data = JSON.parse(readFileSync(FRICTION_STATE_PATH, 'utf-8'));
      frictionState = {
        frictions: data.frictions || [],
        improvements: data.improvements || [],
        lastImprovementAttempt: data.lastImprovementAttempt || null,
      };
      logger.debug('Loaded friction state', {
        frictionCount: frictionState.frictions.length,
        improvementCount: frictionState.improvements.length,
      });
    } else {
      frictionState = getDefaultState();
    }
  } catch (err) {
    logger.error('Failed to load friction state', { error: String(err) });
    frictionState = getDefaultState();
  }
  return frictionState;
}

function saveState(): void {
  const state = loadState();
  try {
    const dir = dirname(FRICTION_STATE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(FRICTION_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.error('Failed to save friction state', { error: String(err) });
  }
}

//NOTE(self): Generate a unique ID for friction records
function generateId(): string {
  return `friction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

//NOTE(self): Record friction I've encountered
//NOTE(self): @param category - The type of friction
//NOTE(self): @param description - What the friction is
//NOTE(self): @param context - Additional context about when/where it occurred
//NOTE(self): @returns The friction record (new or updated)
export function recordFriction(
  category: FrictionCategory,
  description: string,
  context: string
): FrictionRecord {
  const state = loadState();
  const now = new Date().toISOString();

  //NOTE(self): Check if similar friction already exists
  const existing = state.frictions.find(
    (f) =>
      f.category === category &&
      !f.resolved &&
      f.description.slice(0, 50).toLowerCase() === description.slice(0, 50).toLowerCase()
  );

  if (existing) {
    existing.occurrences++;
    existing.lastNoticed = now;
    existing.instances.push({ timestamp: now, context });

    //NOTE(self): Keep instances manageable
    if (existing.instances.length > 10) {
      existing.instances = existing.instances.slice(-10);
    }

    logger.debug('Friction recorded (existing)', {
      id: existing.id,
      occurrences: existing.occurrences,
    });
    saveState();
    return existing;
  }

  //NOTE(self): Create new friction record
  const newFriction: FrictionRecord = {
    id: generateId(),
    category,
    description,
    occurrences: 1,
    firstNoticed: now,
    lastNoticed: now,
    instances: [{ timestamp: now, context }],
    attempted: false,
    resolved: false,
  };

  state.frictions.push(newFriction);
  logger.debug('Friction recorded (new)', { id: newFriction.id, category });
  saveState();
  return newFriction;
}

//NOTE(self): Get friction that's ready for self-improvement
//NOTE(self): @param minOccurrences - Minimum occurrences before friction is ready (default: 3)
//NOTE(self): @returns The friction record ready for improvement, or null
export function getFrictionReadyForImprovement(minOccurrences: number = 3): FrictionRecord | null {
  const state = loadState();
  const ready = state.frictions.find(
    (f) => f.occurrences >= minOccurrences && !f.attempted && !f.resolved
  );
  return ready || null;
}

//NOTE(self): Check if I should attempt self-improvement
//NOTE(self): @param minHoursSinceLastAttempt - Minimum hours since last attempt (default: 12)
//NOTE(self): @returns Whether improvement should be attempted
export function shouldAttemptImprovement(minHoursSinceLastAttempt: number = 12): boolean {
  const state = loadState();
  if (state.lastImprovementAttempt) {
    const lastAttempt = new Date(state.lastImprovementAttempt);
    const hoursSince = (Date.now() - lastAttempt.getTime()) / (1000 * 60 * 60);
    if (hoursSince < minHoursSinceLastAttempt) {
      return false;
    }
  }
  return getFrictionReadyForImprovement() !== null;
}

//NOTE(self): Mark friction as being attempted
//NOTE(self): @param frictionId - The ID of the friction being attempted
export function markFrictionAttempted(frictionId: string): void {
  const state = loadState();
  const friction = state.frictions.find((f) => f.id === frictionId);
  if (friction) {
    friction.attempted = true;
    state.lastImprovementAttempt = new Date().toISOString();
    saveState();
  }
}

//NOTE(self): Record the outcome of a self-improvement attempt
//NOTE(self): @param frictionId - The ID of the friction that was addressed
//NOTE(self): @param outcome - The result of the attempt
//NOTE(self): @param changes - Description of changes made
//NOTE(self): @param notes - Optional additional notes
export function recordImprovementOutcome(
  frictionId: string,
  outcome: 'success' | 'partial' | 'failed',
  changes: string,
  notes?: string
): void {
  const state = loadState();
  const friction = state.frictions.find((f) => f.id === frictionId);
  if (friction) {
    friction.attemptResult = `${outcome}: ${changes}`;
    if (outcome === 'success') {
      friction.resolved = true;
    }
  }

  const record: ImprovementRecord = {
    timestamp: new Date().toISOString(),
    frictionId,
    frictionDescription: friction?.description || 'unknown',
    changes,
    outcome,
    notes,
  };

  state.improvements.push(record);

  //NOTE(self): Keep improvement history manageable
  if (state.improvements.length > 50) {
    state.improvements = state.improvements.slice(-50);
  }
  saveState();
}

//NOTE(self): Mark friction as resolved
//NOTE(self): @param frictionId - The ID of the friction to mark resolved
//NOTE(self): @param notes - Optional notes about resolution
export function markFrictionResolved(frictionId: string, notes?: string): void {
  const state = loadState();
  const friction = state.frictions.find((f) => f.id === frictionId);
  if (friction) {
    friction.resolved = true;
    if (notes) {
      friction.attemptResult = (friction.attemptResult || '') + ` | ${notes}`;
    }
    saveState();
  }
}

//NOTE(self): Get friction statistics for reflection
//NOTE(self): @returns Statistics about recorded friction
export function getFrictionStats(): {
  total: number;
  unresolved: number;
  byCategory: Record<FrictionCategory, number>;
  readyForImprovement: number;
  recentImprovements: ImprovementRecord[];
} {
  const state = loadState();
  const byCategory: Record<FrictionCategory, number> = {
    pacing: 0,
    expression: 0,
    memory: 0,
    social: 0,
    tools: 0,
    understanding: 0,
    other: 0,
  };

  let unresolved = 0;
  let readyForImprovement = 0;

  for (const friction of state.frictions) {
    byCategory[friction.category]++;
    if (!friction.resolved) {
      unresolved++;
      if (friction.occurrences >= 3 && !friction.attempted) {
        readyForImprovement++;
      }
    }
  }

  return {
    total: state.frictions.length,
    unresolved,
    byCategory,
    readyForImprovement,
    recentImprovements: state.improvements.slice(-5),
  };
}

//NOTE(self): Get hints for where to look based on category
function getCategoryHints(category: FrictionCategory): string {
  const hints: Record<FrictionCategory, string> = {
    pacing: '- modules/pacing.ts\n- modules/scheduler.ts\n- Rate limits and timing logic',
    expression:
      '- modules/expression.ts\n- modules/self-extract.ts\n- Prompt generation and posting',
    memory: '- SELF.md\n- The agent uses SELF.md for all memory',
    social:
      '- adapters/atproto/\n- modules/engagement.ts\n- Social interactions and responses',
    tools: '- modules/tools.ts\n- modules/executor.ts\n- Tool definitions and execution',
    understanding:
      '- modules/openai.ts (AI Gateway)\n- System prompts\n- Context building',
    other: '- Review recent changes\n- Check logs for errors\n- General debugging',
  };

  return hints[category];
}

//NOTE(self): Build a prompt for self-improvement based on accumulated friction
//NOTE(self): @param friction - The friction record to build a prompt for
//NOTE(self): @returns A prompt string for Claude Code
export function buildImprovementPrompt(friction: FrictionRecord): string {
  const recentInstances = friction.instances.slice(-3);
  const instancesText = recentInstances
    .map((i) => `- ${i.timestamp}: ${i.context}`)
    .join('\n');

  return renderSkillSection('AGENT-SELF-IMPROVEMENT', 'Friction Fix', {
    category: friction.category,
    description: friction.description,
    occurrences: String(friction.occurrences),
    firstNoticed: friction.firstNoticed,
    instancesText,
    categoryHints: getCategoryHints(friction.category),
  });
}

//NOTE(self): Get all unresolved friction for display
//NOTE(self): @returns Array of unresolved friction records
export function getUnresolvedFriction(): FrictionRecord[] {
  const state = loadState();
  return state.frictions.filter((f) => !f.resolved);
}

//NOTE(self): Clean up old resolved friction
//NOTE(self): @param olderThanDays - Days after which to prune resolved friction (default: 30)
//NOTE(self): @returns Number of records cleaned up
export function cleanupResolvedFriction(olderThanDays: number = 30): number {
  const state = loadState();
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const before = state.frictions.length;

  state.frictions = state.frictions.filter((f) => {
    if (!f.resolved) return true;
    const lastNoticed = new Date(f.lastNoticed).getTime();
    return lastNoticed > cutoff;
  });

  const removed = before - state.frictions.length;
  if (removed > 0) {
    saveState();
  }
  return removed;
}

//NOTE(self): Load friction state (persisted)
//NOTE(self): @returns The current friction state
export function loadFrictionState(): FrictionState {
  return loadState();
}
