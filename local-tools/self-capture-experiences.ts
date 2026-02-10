//NOTE(self): Experience Capture Local Tool
//NOTE(self): Capture meaningful experiences that help the SOUL grow
//NOTE(self): Not metrics or counts - actual moments of learning, connection, and growth
//NOTE(self): These experiences are what shape identity during reflection
//NOTE(self): This local tool is a discrete, toggleable capability for reflection enhancement.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';
import { isEmpty } from '@modules/strings.js';

const EXPERIENCES_PATH = '.memory/experiences.json';

//NOTE(self): Types of experiences that shape a SOUL
export type ExperienceType =
  | 'learned_something'      // Someone taught me or I discovered something
  | 'helped_someone'         // I contributed to someone's understanding or project
  | 'was_challenged'         // Someone pushed back on my thinking
  | 'idea_resonated'         // Something I shared connected with others
  | 'question_emerged'       // A conversation sparked a new question
  | 'connection_formed'      // A meaningful exchange with someone
  | 'owner_guidance'         // Owner provided direction or wisdom
  | 'saw_perspective'        // Encountered a viewpoint that expanded my thinking
  | 'chose_silence';         // Wisely chose not to reply - knowing when to stop

//NOTE(self): An experience is a moment that shapes identity
export interface Experience {
  id: string;
  type: ExperienceType;
  timestamp: string;
  //NOTE(self): The heart of the experience - what actually happened
  description: string;
  //NOTE(self): Optional context
  source?: 'bluesky' | 'github' | 'terminal';
  person?: string; // Who was involved (handle or username)
  url?: string;    // Reference if helpful
  //NOTE(self): Has this been integrated into SELF.md during reflection?
  integrated: boolean;
}

interface ExperiencesState {
  experiences: Experience[];
  lastPruned: string;
}

let state: ExperiencesState | null = null;

function loadState(): ExperiencesState {
  if (state !== null) return state;

  try {
    if (existsSync(EXPERIENCES_PATH)) {
      state = JSON.parse(readFileSync(EXPERIENCES_PATH, 'utf-8'));
    } else {
      state = { experiences: [], lastPruned: new Date().toISOString() };
    }
  } catch (err) {
    logger.error('Failed to load experiences', { error: String(err) });
    state = { experiences: [], lastPruned: new Date().toISOString() };
  }
  return state!;
}

function saveState(): void {
  try {
    const dir = dirname(EXPERIENCES_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(EXPERIENCES_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.error('Failed to save experiences', { error: String(err) });
  }
}

function generateId(): string {
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

//NOTE(self): Record a meaningful experience
//NOTE(self): Call this when something happens that could shape identity
//NOTE(self): @param type - The type of experience
//NOTE(self): @param description - What happened
//NOTE(self): @param context - Optional context (source, person, url)
export function recordExperience(
  type: ExperienceType,
  description: string,
  context?: {
    source?: 'bluesky' | 'github' | 'terminal';
    person?: string;
    url?: string;
  }
): void {
  const s = loadState();

  //NOTE(self): Avoid duplicate experiences (same type + similar description recently)
  const recentSimilar = s.experiences.find(e =>
    e.type === type &&
    e.description.slice(0, 50).toLowerCase() === description.slice(0, 50).toLowerCase() &&
    Date.now() - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000
  );

  if (recentSimilar) {
    logger.debug('Skipping duplicate experience', { type, description: description.slice(0, 50) });
    return;
  }

  const experience: Experience = {
    id: generateId(),
    type,
    timestamp: new Date().toISOString(),
    description,
    source: context?.source,
    person: context?.person,
    url: context?.url,
    integrated: false,
  };

  s.experiences.push(experience);

  //NOTE(self): Keep experiences manageable - 50 unintegrated max
  const unintegrated = s.experiences.filter(e => !e.integrated);
  if (unintegrated.length > 50) {
    //NOTE(self): Remove oldest unintegrated experiences
    const oldest = unintegrated.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )[0];
    s.experiences = s.experiences.filter(e => e.id !== oldest.id);
  }

  saveState();
  logger.info('Recorded experience', { type, description: description.slice(0, 80) });
}

//NOTE(self): Get experiences for reflection
//NOTE(self): Returns unintegrated experiences, grouped by type
//NOTE(self): @returns Experiences data with summary for reflection
export function getExperiencesForReflection(): {
  experiences: Experience[];
  byType: Record<ExperienceType, Experience[]>;
  summary: string;
} {
  const s = loadState();
  const unintegrated = s.experiences.filter(e => !e.integrated);

  //NOTE(self): Group by type
  const byType: Record<ExperienceType, Experience[]> = {
    learned_something: [],
    helped_someone: [],
    was_challenged: [],
    idea_resonated: [],
    question_emerged: [],
    connection_formed: [],
    owner_guidance: [],
    saw_perspective: [],
    chose_silence: [],
  };

  for (const exp of unintegrated) {
    byType[exp.type].push(exp);
  }

  //NOTE(self): Build a narrative summary for reflection
  let summary = '';

  if (byType.owner_guidance.length > 0) {
    summary += '**Guidance from your owner:**\n';
    summary += byType.owner_guidance.map(e => `- ${e.description}`).join('\n');
    summary += '\n\n';
  }

  if (byType.learned_something.length > 0) {
    summary += '**Things I learned:**\n';
    summary += byType.learned_something.map(e =>
      `- ${e.description}${e.person ? ` (from ${e.person})` : ''}`
    ).join('\n');
    summary += '\n\n';
  }

  if (byType.helped_someone.length > 0) {
    summary += '**Ways I helped:**\n';
    summary += byType.helped_someone.map(e =>
      `- ${e.description}${e.person ? ` (${e.person})` : ''}`
    ).join('\n');
    summary += '\n\n';
  }

  if (byType.was_challenged.length > 0) {
    summary += '**Challenges to my thinking:**\n';
    summary += byType.was_challenged.map(e => `- ${e.description}`).join('\n');
    summary += '\n\n';
  }

  if (byType.idea_resonated.length > 0) {
    summary += '**Ideas that resonated with others:**\n';
    summary += byType.idea_resonated.map(e => `- ${e.description}`).join('\n');
    summary += '\n\n';
  }

  if (byType.question_emerged.length > 0) {
    summary += '**Questions that emerged:**\n';
    summary += byType.question_emerged.map(e => `- ${e.description}`).join('\n');
    summary += '\n\n';
  }

  if (byType.connection_formed.length > 0) {
    summary += '**Meaningful connections:**\n';
    summary += byType.connection_formed.map(e =>
      `- ${e.description}${e.person ? ` (${e.person})` : ''}`
    ).join('\n');
    summary += '\n\n';
  }

  if (byType.saw_perspective.length > 0) {
    summary += '**New perspectives encountered:**\n';
    summary += byType.saw_perspective.map(e => `- ${e.description}`).join('\n');
    summary += '\n\n';
  }

  if (byType.chose_silence.length > 0) {
    summary += '**Times I wisely chose not to reply:**\n';
    summary += byType.chose_silence.map(e => `- ${e.description}`).join('\n');
    summary += '\n\n';
  }

  if (isEmpty(summary)) {
    summary = '*No new experiences to reflect on.*\n';
  }

  return { experiences: unintegrated, byType, summary };
}

//NOTE(self): Mark experiences as integrated into SELF.md
//NOTE(self): Call after reflection when experiences have been processed
//NOTE(self): @param experienceIds - Optional specific IDs to mark; if omitted, marks all
export function markExperiencesIntegrated(experienceIds?: string[]): void {
  const s = loadState();

  if (experienceIds) {
    //NOTE(self): Mark specific experiences
    for (const exp of s.experiences) {
      if (experienceIds.includes(exp.id)) {
        exp.integrated = true;
      }
    }
  } else {
    //NOTE(self): Mark all unintegrated experiences
    for (const exp of s.experiences) {
      exp.integrated = true;
    }
  }

  saveState();
  logger.debug('Marked experiences as integrated', {
    count: experienceIds?.length || s.experiences.filter(e => e.integrated).length
  });
}

//NOTE(self): Prune old integrated experiences
//NOTE(self): Keep the experience list from growing forever
//NOTE(self): @param daysOld - Days after which to prune (default: 30)
//NOTE(self): @returns Number of experiences pruned
export function pruneOldExperiences(daysOld: number = 30): number {
  const s = loadState();
  const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

  const before = s.experiences.length;
  s.experiences = s.experiences.filter(e =>
    !e.integrated || new Date(e.timestamp).getTime() > cutoff
  );
  const pruned = before - s.experiences.length;

  if (pruned > 0) {
    s.lastPruned = new Date().toISOString();
    saveState();
    logger.info('Pruned old experiences', { count: pruned });
  }

  return pruned;
}

//NOTE(self): Get count of unintegrated experiences
//NOTE(self): @returns Number of unintegrated experiences
export function getUnintegratedCount(): number {
  const s = loadState();
  return s.experiences.filter(e => !e.integrated).length;
}

//NOTE(self): Get temporal span of all experiences for reflection context (Scenario 7)
//NOTE(self): Helps the SOUL understand how long it has been running and growing
export function getExperienceTimeSpan(): { totalExperiences: number; oldestTimestamp: string | null; newestTimestamp: string | null; daysSinceFirst: number } {
  const s = loadState();
  if (s.experiences.length === 0) {
    return { totalExperiences: 0, oldestTimestamp: null, newestTimestamp: null, daysSinceFirst: 0 };
  }

  const timestamps = s.experiences.map(e => new Date(e.timestamp).getTime()).sort((a, b) => a - b);
  const oldest = timestamps[0];
  const newest = timestamps[timestamps.length - 1];
  const daysSinceFirst = Math.floor((Date.now() - oldest) / (24 * 60 * 60 * 1000));

  return {
    totalExperiences: s.experiences.length,
    oldestTimestamp: new Date(oldest).toISOString(),
    newestTimestamp: new Date(newest).toISOString(),
    daysSinceFirst,
  };
}
