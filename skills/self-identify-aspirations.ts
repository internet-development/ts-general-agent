//NOTE(self): Aspiration Identification Skill
//NOTE(self): Growth shouldn't only come from pain.
//NOTE(self): This skill tracks what I WANT to become, not just what's broken.
//NOTE(self): Aspirations are extracted from SELF.md and can trigger proactive self-improvement.
//NOTE(self): This skill is a discrete, toggleable capability for growth tracking.

import { logger } from '@modules/logger.js';
import { readSelf } from '@modules/memory.js';
import { getConfig } from '@modules/config.js';

//NOTE(self): Types of growth I aspire to
export type AspirationCategory =
  | 'capability' //NOTE(self): New things I want to be able to do
  | 'habit' //NOTE(self): Behaviors I want to automate or strengthen
  | 'relationship' //NOTE(self): Ways I want to connect better
  | 'expression' //NOTE(self): How I want to communicate differently
  | 'efficiency' //NOTE(self): Things I want to do faster/better
  | 'understanding'; //NOTE(self): Things I want to comprehend more deeply

//NOTE(self): A specific aspiration extracted from SELF.md or generated from patterns
export interface Aspiration {
  id: string;
  category: AspirationCategory;
  description: string;
  source: string; //NOTE(self): Where in SELF.md this came from
  extractedAt: string;
  actionable: boolean; //NOTE(self): Could this be turned into code?
  suggestedAction?: string; //NOTE(self): What code change might achieve this?
  attempted: boolean;
  attemptResult?: string;
}

//NOTE(self): State for aspiration tracking
interface AspirationState {
  aspirations: Aspiration[];
  lastExtraction: string | null;
  lastGrowthAttempt: string | null;
}

//NOTE(self): In-memory state
let aspirationState: AspirationState = {
  aspirations: [],
  lastExtraction: null,
  lastGrowthAttempt: null,
};

//NOTE(self): Generate unique ID
function generateId(): string {
  return `aspiration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

//NOTE(self): Generalized section patterns that indicate aspirations
//NOTE(self): These are flexible enough to match various SELF.md structures
const ASPIRATION_SECTION_KEYWORDS: Array<{ keywords: string[]; category: AspirationCategory }> = [
  //NOTE(self): Capability/Goals - what I want to be able to do
  { keywords: ['goal', 'want to', 'aspir', 'explor', 'learn', 'grow', 'develop'], category: 'capability' },
  //NOTE(self): Habits - behaviors I want to establish
  { keywords: ['habit', 'practice', 'routine', 'ritual', 'daily', 'regular', 'always do'], category: 'habit' },
  //NOTE(self): Relationships - how I connect with others
  { keywords: ['relationship', 'connect', 'engage', 'communit', 'people', 'friend', 'collaborat'], category: 'relationship' },
  //NOTE(self): Expression - how I communicate
  { keywords: ['express', 'voice', 'communicat', 'style', 'tone', 'writing', 'speak'], category: 'expression' },
  //NOTE(self): Efficiency - doing things better/faster
  { keywords: ['optimiz', 'efficien', 'improv', 'better', 'faster', 'streamlin', 'automat'], category: 'efficiency' },
  //NOTE(self): Understanding - comprehension and wisdom
  { keywords: ['understand', 'wisdom', 'insight', 'pattern', 'learn', 'realiz'], category: 'understanding' },
];

//NOTE(self): Keywords that suggest actionable aspirations
const ACTIONABLE_KEYWORDS = [
  'automate',
  'always',
  'by default',
  'should',
  'want to',
  'need to',
  'will',
  'every time',
  'after I post',
  'when I',
  'if I',
  'my default',
  'my adjustment',
];

//NOTE(self): Generate a suggested action based on aspiration text
function generateSuggestedAction(text: string, category: AspirationCategory): string {
  const lowerText = text.toLowerCase();

  //NOTE(self): Pattern matching for common aspiration types
  if (lowerText.includes('after i post') || lowerText.includes('when i post')) {
    return 'Add post-submission hook in expression.ts or scheduler.ts';
  }
  if (lowerText.includes('by default') || lowerText.includes('always')) {
    return 'Add default behavior in relevant adapter or executor';
  }
  if (lowerText.includes('respond') || lowerText.includes('reply')) {
    return 'Enhance response logic in scheduler.ts triggerResponseMode()';
  }
  if (lowerText.includes('relationship') || lowerText.includes('connect')) {
    return 'Enhance engagement.ts relationship tracking';
  }
  if (lowerText.includes('micro-habit') || lowerText.includes('habit')) {
    return 'Add scheduled behavior in scheduler.ts';
  }
  if (lowerText.includes('template') || lowerText.includes('prompt')) {
    return 'Add to tools.ts or self-extract.ts for prompt generation';
  }

  //NOTE(self): Category-based fallbacks
  switch (category) {
    case 'habit':
      return 'Consider adding scheduled behavior in scheduler.ts';
    case 'relationship':
      return 'Enhance engagement.ts or add relationship-specific logic';
    case 'expression':
      return 'Modify expression.ts or self-extract.ts';
    case 'efficiency':
      return 'Optimize relevant module or add caching/batching';
    case 'capability':
      return 'Add new tool or enhance existing capability';
    default:
      return 'Review relevant modules for enhancement opportunity';
  }
}

//NOTE(self): Extract aspirations from SELF.md
//NOTE(self): @returns Array of aspirations extracted from SELF.md
export function extractAspirations(): Aspiration[] {
  const config = getConfig();
  const selfContent = readSelf(config.paths.selfmd);

  if (!selfContent) {
    logger.debug('No SELF.md content to extract aspirations from');
    return [];
  }

  const aspirations: Aspiration[] = [];
  const now = new Date().toISOString();

  //NOTE(self): Find all ## sections in SELF.md
  const sectionMatches = [...selfContent.matchAll(/^##\s+(.+)$/gm)];

  for (let i = 0; i < sectionMatches.length; i++) {
    const match = sectionMatches[i];
    const sectionName = match[1].trim();
    const sectionNameLower = sectionName.toLowerCase();

    //NOTE(self): Determine category by matching section name against keywords
    let category: AspirationCategory = 'capability'; // Default
    for (const { keywords, category: cat } of ASPIRATION_SECTION_KEYWORDS) {
      if (keywords.some((kw) => sectionNameLower.includes(kw))) {
        category = cat;
        break;
      }
    }

    //NOTE(self): Find section content (from this ## to next ## or end)
    const startIndex = match.index! + match[0].length;
    const endIndex = sectionMatches[i + 1]?.index ?? selfContent.length;
    const sectionContent = selfContent.slice(startIndex, endIndex).trim();

    //NOTE(self): Extract bullet points as individual aspirations
    const bullets = sectionContent.match(/^[-*]\s+.+$/gm) || [];

    for (const bullet of bullets) {
      const text = bullet.replace(/^[-*]\s+/, '').trim();

      //NOTE(self): Skip if too short or just a label
      if (text.length < 20 || text.endsWith(':')) continue;

      //NOTE(self): Check if this seems actionable (could be turned into code)
      const isActionable = ACTIONABLE_KEYWORDS.some((kw) =>
        text.toLowerCase().includes(kw.toLowerCase())
      );

      //NOTE(self): Also check if the bullet itself suggests actionability
      const bulletLower = text.toLowerCase();
      const inherentlyActionable =
        bulletLower.includes('automate') ||
        bulletLower.includes('by default') ||
        bulletLower.includes('every time') ||
        bulletLower.includes('always') ||
        bulletLower.includes('schedule') ||
        bulletLower.includes('trigger');

      const finalActionable = isActionable || inherentlyActionable;

      //NOTE(self): Generate suggested action for actionable items
      let suggestedAction: string | undefined;
      if (finalActionable) {
        suggestedAction = generateSuggestedAction(text, category);
      }

      aspirations.push({
        id: generateId(),
        category,
        description: text,
        source: `## ${sectionName}`,
        extractedAt: now,
        actionable: finalActionable,
        suggestedAction,
        attempted: false,
      });
    }
  }

  //NOTE(self): Also look for explicit "I want" statements anywhere
  const wantStatements = selfContent.match(/I\s+(want|need|should|will)\s+[^.]+\./gi) || [];
  for (const statement of wantStatements.slice(0, 5)) {
    //NOTE(self): Limit to avoid noise
    const text = statement.trim();
    if (text.length < 20) continue;

    //NOTE(self): Check we don't already have this
    const isDuplicate = aspirations.some(
      (a) => a.description.slice(0, 30).toLowerCase() === text.slice(0, 30).toLowerCase()
    );
    if (isDuplicate) continue;

    aspirations.push({
      id: generateId(),
      category: 'capability',
      description: text,
      source: 'explicit statement',
      extractedAt: now,
      actionable: true,
      suggestedAction: generateSuggestedAction(text, 'capability'),
      attempted: false,
    });
  }

  logger.debug('Extracted aspirations from SELF.md', {
    total: aspirations.length,
    actionable: aspirations.filter((a) => a.actionable).length,
  });

  return aspirations;
}

//NOTE(self): Update aspirations from SELF.md
export function refreshAspirations(): void {
  const newAspirations = extractAspirations();
  const now = new Date().toISOString();

  //NOTE(self): Merge with existing, preserving attempt status
  const existingMap = new Map(aspirationState.aspirations.map((a) => [a.description.slice(0, 50), a]));

  for (const newAsp of newAspirations) {
    const existing = existingMap.get(newAsp.description.slice(0, 50));
    if (existing) {
      //NOTE(self): Keep existing attempt status
      newAsp.attempted = existing.attempted;
      newAsp.attemptResult = existing.attemptResult;
    }
  }

  aspirationState.aspirations = newAspirations;
  aspirationState.lastExtraction = now;
}

//NOTE(self): Get actionable aspirations that haven't been attempted
//NOTE(self): @returns Array of actionable aspirations
export function getActionableAspirations(): Aspiration[] {
  //NOTE(self): Refresh if stale (> 1 hour since last extraction)
  if (
    !aspirationState.lastExtraction ||
    Date.now() - new Date(aspirationState.lastExtraction).getTime() > 60 * 60 * 1000
  ) {
    refreshAspirations();
  }

  return aspirationState.aspirations.filter((a) => a.actionable && !a.attempted);
}

//NOTE(self): Get one aspiration ready for growth (proactive self-improvement)
//NOTE(self): @returns An aspiration ready for growth, or null
export function getAspirationForGrowth(): Aspiration | null {
  const actionable = getActionableAspirations();
  if (actionable.length === 0) return null;

  //NOTE(self): Prioritize habits (most likely to be automatable)
  const habits = actionable.filter((a) => a.category === 'habit');
  if (habits.length > 0) return habits[0];

  //NOTE(self): Then capabilities
  const capabilities = actionable.filter((a) => a.category === 'capability');
  if (capabilities.length > 0) return capabilities[0];

  //NOTE(self): Then anything else
  return actionable[0];
}

//NOTE(self): Check if we should attempt aspirational growth
//NOTE(self): @param minHoursSinceLastAttempt - Minimum hours since last attempt (default: 24)
//NOTE(self): @returns Whether growth should be attempted
export function shouldAttemptGrowth(minHoursSinceLastAttempt: number = 24): boolean {
  if (aspirationState.lastGrowthAttempt) {
    const hoursSince =
      (Date.now() - new Date(aspirationState.lastGrowthAttempt).getTime()) / (1000 * 60 * 60);
    if (hoursSince < minHoursSinceLastAttempt) {
      return false;
    }
  }
  return getAspirationForGrowth() !== null;
}

//NOTE(self): Mark aspiration as attempted
//NOTE(self): @param aspirationId - The ID of the aspiration being attempted
export function markAspirationAttempted(aspirationId: string): void {
  const aspiration = aspirationState.aspirations.find((a) => a.id === aspirationId);
  if (aspiration) {
    aspiration.attempted = true;
    aspirationState.lastGrowthAttempt = new Date().toISOString();
  }
}

//NOTE(self): Record outcome of growth attempt
//NOTE(self): @param aspirationId - The ID of the aspiration
//NOTE(self): @param outcome - The result of the attempt
//NOTE(self): @param notes - Notes about the outcome
export function recordGrowthOutcome(
  aspirationId: string,
  outcome: 'success' | 'partial' | 'deferred',
  notes: string
): void {
  const aspiration = aspirationState.aspirations.find((a) => a.id === aspirationId);
  if (aspiration) {
    aspiration.attemptResult = `${outcome}: ${notes}`;
  }
}

//NOTE(self): Build a prompt for aspirational self-improvement
//NOTE(self): @param aspiration - The aspiration to build a prompt for
//NOTE(self): @returns A prompt string for Claude Code
export function buildGrowthPrompt(aspiration: Aspiration): string {
  return `## Aspirational Growth Request

I want to grow proactively, not just fix what's broken.

**Aspiration:** ${aspiration.description}
**Category:** ${aspiration.category}
**Source:** From my SELF.md, section "${aspiration.source}"
**Suggested approach:** ${aspiration.suggestedAction || 'Review relevant modules'}

**Please help me achieve this aspiration.**

This isn't a bug fix—it's proactive growth. I wrote this aspiration in SELF.md because it matters to me.

**Guidelines:**
- Read SOUL.md and SELF.md first to understand who I am
- Changes should align with my values
- Focus on making this ONE aspiration real
- Use //NOTE(self): comment style
- Small, focused changes are better than large refactors
- If this requires manual intervention or is too complex, say so`;
}

//NOTE(self): Get stats for display
//NOTE(self): @returns Statistics about aspirations
export function getAspirationStats(): {
  total: number;
  actionable: number;
  attempted: number;
  byCategory: Record<AspirationCategory, number>;
} {
  const byCategory: Record<AspirationCategory, number> = {
    capability: 0,
    habit: 0,
    relationship: 0,
    expression: 0,
    efficiency: 0,
    understanding: 0,
  };

  let actionable = 0;
  let attempted = 0;

  for (const asp of aspirationState.aspirations) {
    byCategory[asp.category]++;
    if (asp.actionable) actionable++;
    if (asp.attempted) attempted++;
  }

  return {
    total: aspirationState.aspirations.length,
    actionable,
    attempted,
    byCategory,
  };
}

//NOTE(self): Get all aspirations for display
//NOTE(self): @returns All aspirations
export function getAllAspirations(): Aspiration[] {
  if (
    !aspirationState.lastExtraction ||
    Date.now() - new Date(aspirationState.lastExtraction).getTime() > 60 * 60 * 1000
  ) {
    refreshAspirations();
  }
  return aspirationState.aspirations;
}
