/**
 * Friction Module
 *
 * //NOTE(self): Tracks friction I encounter in how I work.
 * //NOTE(self): When friction accumulates, I can use self-improvement to fix it.
 * //NOTE(self): State is in-memory only - resets on restart. I use SELF.md for persistent memory.
 */

import { logger } from '@modules/logger.js';

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

//NOTE(self): My friction state - in-memory only
export interface FrictionState {
  frictions: FrictionRecord[];
  improvements: ImprovementRecord[];
  lastImprovementAttempt: string | null;
}

//NOTE(self): In-memory state (resets on restart)
let frictionState: FrictionState = {
  frictions: [],
  improvements: [],
  lastImprovementAttempt: null,
};

//NOTE(self): Generate a unique ID for friction records
function generateId(): string {
  return `friction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

//NOTE(self): Load my friction state (in-memory)
export function loadFrictionState(): FrictionState {
  return frictionState;
}

//NOTE(self): Record friction I've encountered
export function recordFriction(
  category: FrictionCategory,
  description: string,
  context: string
): FrictionRecord {
  const now = new Date().toISOString();

  //NOTE(self): Check if similar friction already exists
  const existing = frictionState.frictions.find(
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

  frictionState.frictions.push(newFriction);
  logger.debug('Friction recorded (new)', { id: newFriction.id, category });
  return newFriction;
}

//NOTE(self): Get friction that's ready for self-improvement
export function getFrictionReadyForImprovement(minOccurrences: number = 3): FrictionRecord | null {
  const ready = frictionState.frictions.find(
    (f) => f.occurrences >= minOccurrences && !f.attempted && !f.resolved
  );
  return ready || null;
}

//NOTE(self): Check if I should attempt self-improvement
export function shouldAttemptImprovement(minHoursSinceLastAttempt: number = 12): boolean {
  if (frictionState.lastImprovementAttempt) {
    const lastAttempt = new Date(frictionState.lastImprovementAttempt);
    const hoursSince = (Date.now() - lastAttempt.getTime()) / (1000 * 60 * 60);
    if (hoursSince < minHoursSinceLastAttempt) {
      return false;
    }
  }
  return getFrictionReadyForImprovement() !== null;
}

//NOTE(self): Mark friction as being attempted
export function markFrictionAttempted(frictionId: string): void {
  const friction = frictionState.frictions.find((f) => f.id === frictionId);
  if (friction) {
    friction.attempted = true;
    frictionState.lastImprovementAttempt = new Date().toISOString();
  }
}

//NOTE(self): Record the outcome of a self-improvement attempt
export function recordImprovementOutcome(
  frictionId: string,
  outcome: 'success' | 'partial' | 'failed',
  changes: string,
  notes?: string
): void {
  const friction = frictionState.frictions.find((f) => f.id === frictionId);
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

  frictionState.improvements.push(record);

  //NOTE(self): Keep improvement history manageable
  if (frictionState.improvements.length > 50) {
    frictionState.improvements = frictionState.improvements.slice(-50);
  }
}

//NOTE(self): Mark friction as resolved
export function markFrictionResolved(frictionId: string, notes?: string): void {
  const friction = frictionState.frictions.find((f) => f.id === frictionId);
  if (friction) {
    friction.resolved = true;
    if (notes) {
      friction.attemptResult = (friction.attemptResult || '') + ` | ${notes}`;
    }
  }
}

//NOTE(self): Get friction statistics for reflection
export function getFrictionStats(): {
  total: number;
  unresolved: number;
  byCategory: Record<FrictionCategory, number>;
  readyForImprovement: number;
  recentImprovements: ImprovementRecord[];
} {
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

  for (const friction of frictionState.frictions) {
    byCategory[friction.category]++;
    if (!friction.resolved) {
      unresolved++;
      if (friction.occurrences >= 3 && !friction.attempted) {
        readyForImprovement++;
      }
    }
  }

  return {
    total: frictionState.frictions.length,
    unresolved,
    byCategory,
    readyForImprovement,
    recentImprovements: frictionState.improvements.slice(-5),
  };
}

//NOTE(self): Build a prompt for self-improvement based on accumulated friction
export function buildImprovementPrompt(friction: FrictionRecord): string {
  const recentInstances = friction.instances.slice(-3);
  const instancesText = recentInstances
    .map((i) => `- ${i.timestamp}: ${i.context}`)
    .join('\n');

  return `## Self-Improvement Request

I've noticed recurring friction in my system that I'd like to address.

**Category:** ${friction.category}
**Issue:** ${friction.description}
**Occurrences:** ${friction.occurrences} times since ${friction.firstNoticed}

**Recent instances:**
${instancesText}

**Please investigate and fix this.**

Relevant areas to check based on category "${friction.category}":
${getCategoryHints(friction.category)}

**Constraints:**
- Changes must align with SOUL.md principles
- Use //NOTE(self): comment style
- Test the fix before committing
- Keep changes focused on this specific friction`;
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
      '- modules/openai.ts\n- System prompts\n- Context building',
    other: '- Review recent changes\n- Check logs for errors\n- General debugging',
  };

  return hints[category];
}

//NOTE(self): Get all unresolved friction for display
export function getUnresolvedFriction(): FrictionRecord[] {
  return frictionState.frictions.filter((f) => !f.resolved);
}

//NOTE(self): Clean up old resolved friction
export function cleanupResolvedFriction(olderThanDays: number = 30): number {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const before = frictionState.frictions.length;

  frictionState.frictions = frictionState.frictions.filter((f) => {
    if (!f.resolved) return true;
    const lastNoticed = new Date(f.lastNoticed).getTime();
    return lastNoticed > cutoff;
  });

  return before - frictionState.frictions.length;
}
