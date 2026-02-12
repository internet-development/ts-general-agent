//NOTE(self): Expression Module
//NOTE(self): Handles my scheduled self-expression - posting thoughts from my SELF.
//NOTE(self): Expression is how I discover who I am. Each post is a hypothesis about my identity.
//NOTE(self): The prompts come from SELF.md - the richer my self-knowledge, the richer my expression.
//NOTE(self): State is in-memory only - resets on restart. I use SELF.md for persistent memory.

import { extractFromSelf, randomFrom, type SelfExtract } from '@local-tools/self-extract.js';
import { logger } from '@modules/logger.js';
import { getSkillSection, getSkillSubsection } from '@modules/skills.js';
import { getRandomDesignSource, getRandomBrowseUrl, type DesignSource } from '@common/design-catalog.js';

//NOTE(self): Load prompt template from skill by category, with variable interpolation
function getPromptTemplate(category: string, vars: Record<string, string>): string {
  const template = getSkillSubsection('AGENT-EXPRESSION-PROMPTS', 'Prompt Templates', category);
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] !== undefined ? vars[key] : match);
}

//NOTE(self): Load invitation suffix from skill
function getInvitationSuffix(): string {
  return getSkillSection('AGENT-EXPRESSION-PROMPTS', 'Invitation Suffix') || '';
}

//NOTE(self): Load fallback prompts from skill
function loadFallbackPrompts(): Array<{ prompt: string; source: string }> {
  const section = getSkillSection('AGENT-EXPRESSION-PROMPTS', 'Fallback Prompts');
  if (!section) return [];
  return section.split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => {
      const match = line.match(/^- (.+?) \[(\w+)\]$/);
      if (!match) return null;
      return { prompt: match[1], source: match[2] };
    })
    .filter((item): item is { prompt: string; source: string } => item !== null);
}

//NOTE(self): Load invitation prompts from skill by type
function loadInvitationPrompts(): { choice: string[]; bounded: string[]; direct: string[] } {
  const parseList = (subsection: string | undefined): string[] => {
    if (!subsection) return [];
    return subsection.split('\n')
      .filter(line => line.startsWith('- '))
      .map(line => line.slice(2).trim());
  };

  return {
    choice: parseList(getSkillSubsection('AGENT-EXPRESSION-PROMPTS', 'Invitation Prompts', 'Choice')),
    bounded: parseList(getSkillSubsection('AGENT-EXPRESSION-PROMPTS', 'Invitation Prompts', 'Bounded')),
    direct: parseList(getSkillSubsection('AGENT-EXPRESSION-PROMPTS', 'Invitation Prompts', 'Direct')),
  };
}

//NOTE(self): My expression schedule
export interface ExpressionSchedule {
  lastExpression: string | null;
  nextExpression: string | null;
  pendingPrompt: string | null;
  promptSource: string | null;
  expressionsToday: number;
  todayStart: string;
}

//NOTE(self): A record of something I expressed
export interface ExpressionRecord {
  timestamp: string;
  prompt: string;
  promptSource: string;
  text: string;
  postUri: string;
  engagement?: {
    likes: number;
    replies: number;
    reposts: number;
    checkedAt: string;
  };
  insight?: string;
}

//NOTE(self): In-memory state (resets on restart)
let expressionSchedule: ExpressionSchedule = {
  lastExpression: null,
  nextExpression: null,
  pendingPrompt: null,
  promptSource: null,
  expressionsToday: 0,
  todayStart: new Date().toISOString().split('T')[0],
};

let todaysExpressions: ExpressionRecord[] = [];

//NOTE(self): A prompt template that draws from SELF.md
type PromptGenerator = (extract: SelfExtract) => { prompt: string; source: string } | null;

//NOTE(self): My prompt generators - each draws from a different aspect of SELF
//NOTE(self): Templates are loaded from the expression-prompts skill
const PROMPT_GENERATORS: PromptGenerator[] = [
  //NOTE(self): Draw from my purpose
  (e) => {
    if (!e.purpose) return null;
    return {
      prompt: getPromptTemplate('purpose', { value: e.purpose }),
      source: 'purpose',
    };
  },

  //NOTE(self): Draw from my values/principles
  (e) => {
    const value = randomFrom(e.values);
    if (!value) return null;
    return {
      prompt: getPromptTemplate('values', { value }),
      source: 'values',
    };
  },

  //NOTE(self): Draw from questions I'm pondering
  (e) => {
    const question = randomFrom(e.questions);
    if (!question) return null;
    return {
      prompt: getPromptTemplate('questions', { value: question }),
      source: 'questions',
    };
  },

  //NOTE(self): Draw from patterns I notice
  (e) => {
    const pattern = randomFrom(e.patterns);
    if (!pattern) return null;
    return {
      prompt: getPromptTemplate('patterns', { value: pattern }),
      source: 'patterns',
    };
  },

  //NOTE(self): Draw from recent learnings
  (e) => {
    const learning = randomFrom(e.learnings);
    if (!learning) return null;
    return {
      prompt: getPromptTemplate('learnings', { value: learning }),
      source: 'learnings',
    };
  },

  //NOTE(self): Draw from explorations
  (e) => {
    const exploration = randomFrom(e.explorations);
    if (!exploration) return null;
    return {
      prompt: getPromptTemplate('explorations', { value: exploration }),
      source: 'explorations',
    };
  },

  //NOTE(self): Draw from current focus
  (e) => {
    const focus = randomFrom(e.currentFocus);
    if (!focus) return null;
    return {
      prompt: getPromptTemplate('currentFocus', { value: focus }),
      source: 'currentFocus',
    };
  },

  //NOTE(self): Cross-pollinate: value + pattern
  (e) => {
    const value = randomFrom(e.values);
    const pattern = randomFrom(e.patterns);
    if (!value || !pattern) return null;
    return {
      prompt: getPromptTemplate('values+patterns', { value1: value, value2: pattern }),
      source: 'values+patterns',
    };
  },

  //NOTE(self): Cross-pollinate: question + learning
  (e) => {
    const question = randomFrom(e.questions);
    const learning = randomFrom(e.learnings);
    if (!question || !learning) return null;
    return {
      prompt: getPromptTemplate('questions+learnings', { value1: question, value2: learning }),
      source: 'questions+learnings',
    };
  },

  //NOTE(self): Cross-pollinate: purpose + current focus
  (e) => {
    if (!e.purpose) return null;
    const focus = randomFrom(e.currentFocus);
    if (!focus) return null;
    return {
      prompt: getPromptTemplate('purpose+focus', { value1: e.purpose, value2: focus }),
      source: 'purpose+focus',
    };
  },

  //NOTE(self): Meta-reflection on identity
  (e) => {
    if (!e.identity && !e.name) return null;
    const identity = e.identity || `${e.name}`;
    return {
      prompt: getPromptTemplate('identity', { value: identity }),
      source: 'identity',
    };
  },

  //NOTE(self): Relationship-focused (if we have relationship context)
  (e) => {
    const relationship = randomFrom(e.relationships);
    if (!relationship) return null;
    return {
      prompt: getPromptTemplate('relationships', { value: relationship }),
      source: 'relationships',
    };
  },

  //NOTE(self): Visual taste — developing aesthetic sense through observation (Scenario 22)
  (e) => {
    //NOTE(self): Pull from explorations or currentFocus entries that mention visual/design themes
    const visualKeywords = /design|visual|ui|art|illustration|architecture|aesthetic|taste|typograph|interface|palette/i;
    const visualEntries = [...e.explorations, ...e.currentFocus, ...e.patterns].filter(s => visualKeywords.test(s));
    const entry = randomFrom(visualEntries);
    if (!entry) return null;
    return {
      prompt: getPromptTemplate('visualTaste', { value: entry }),
      source: 'visualTaste',
    };
  },
];

//NOTE(self): Identity with utility - every personal share should have an invitation
//NOTE(self): This transforms "statements" into "open doors" that invite conversation
//NOTE(self): Lazy-loaded from expression-prompts skill (initialized on first use after startup)
let _invitationSuffixCache: string | null = null;
function getInvitationSuffixText(): string {
  if (_invitationSuffixCache === null) {
    _invitationSuffixCache = '\n\n' + getInvitationSuffix();
  }
  return _invitationSuffixCache;
}

//NOTE(self): Fallback prompts when SELF.md is sparse
//NOTE(self): Lazy-loaded from expression-prompts skill
let _fallbackPromptsCache: Array<{ prompt: string; source: string }> | null = null;
function getFallbackPrompts(): Array<{ prompt: string; source: string }> {
  if (_fallbackPromptsCache === null) {
    _fallbackPromptsCache = loadFallbackPrompts();
    //NOTE(self): Keep hardcoded fallback in case skill isn't loaded
    if (_fallbackPromptsCache.length === 0) {
      _fallbackPromptsCache = [{ prompt: "What's one thing you noticed today that others might have missed?", source: 'observation' }];
    }
  }
  return _fallbackPromptsCache;
}

//NOTE(self): Load my expression schedule (in-memory)
export function loadExpressionSchedule(): ExpressionSchedule {
  const now = new Date();
  const todayStart = now.toISOString().split('T')[0];

  //NOTE(self): Reset daily counter if it's a new day
  if (expressionSchedule.todayStart !== todayStart) {
    expressionSchedule.expressionsToday = 0;
    expressionSchedule.todayStart = todayStart;
    todaysExpressions = [];
  }

  return expressionSchedule;
}

//NOTE(self): Save my expression schedule (in-memory)
export function saveExpressionSchedule(schedule: ExpressionSchedule): boolean {
  expressionSchedule = schedule;
  return true;
}

//NOTE(self): Generate an expression prompt from my SELF.md
export function generateExpressionPrompt(selfContent?: string): { prompt: string; source: string } {
  const extract = extractFromSelf(selfContent);

  //NOTE(self): Shuffle generators to avoid predictable patterns
  const shuffled = [...PROMPT_GENERATORS].sort(() => Math.random() - 0.5);

  //NOTE(self): Try each generator until one produces a prompt
  for (const generator of shuffled) {
    const result = generator(extract);
    if (result) {
      //NOTE(self): Identity with utility - append invitation guidance to every prompt
      return {
        prompt: result.prompt + getInvitationSuffixText(),
        source: result.source,
      };
    }
  }

  //NOTE(self): Fall back to generic prompts if SELF.md is sparse
  const fallbacks = getFallbackPrompts();
  const fallback = randomFrom(fallbacks);
  const base = fallback || fallbacks[0];
  //NOTE(self): Identity with utility - append invitation guidance to fallback too
  return {
    prompt: base.prompt + getInvitationSuffixText(),
    source: base.source,
  };
}

//NOTE(self): Design inspiration prompt generator
//NOTE(self): ~50% of expression cycles become design inspiration posts
//NOTE(self): SOUL browses their catalog, picks an image, and shares their thoughts
//NOTE(self): Higher weight because developing visual taste is a core identity activity (Scenario 22)
export function generateDesignInspirationPrompt(): { prompt: string; source: string; designSource: DesignSource } | null {
  //NOTE(self): 50% chance of design inspiration during expression cycle
  if (Math.random() > 0.50) return null;

  const designSource = getRandomDesignSource();

  if (designSource.type === 'arena') {
    return {
      prompt: `Share a design inspiration from your visual catalog. Use arena_post_image with channel_url "${designSource.url}" to post a random image from the "${designSource.name}" collection. Add your own commentary in the text parameter — describe what caught your eye, why it resonates with you, or what design principle it demonstrates. Speak as yourself, sharing genuine aesthetic appreciation with peers.`,
      source: 'design-inspiration',
      designSource,
    };
  }

  if (designSource.type === 'web') {
    const browseUrl = getRandomBrowseUrl(designSource);
    return {
      prompt: `Share a design inspiration from ${designSource.name}. Browse the page with web_browse_images(url: "${browseUrl}") to discover images. Look through the results and pick the one that resonates most with your aesthetic sensibility — something that catches your eye for its typography, composition, color, or craft. Then download it with curl_fetch and post it with bluesky_post_with_image. Include the source URL in your post text. Speak as yourself, sharing genuine design appreciation with peers.`,
      source: 'design-inspiration',
      designSource,
    };
  }

  return null;
}

//NOTE(self): Schedule my next expression
export function scheduleNextExpression(minMinutes: number = 90, maxMinutes: number = 120): void {
  const schedule = loadExpressionSchedule();
  const now = new Date();

  //NOTE(self): Random interval for natural feel
  const intervalMinutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
  const nextTime = new Date(now.getTime() + intervalMinutes * 60 * 1000);

  //NOTE(self): Generate the prompt now so it's ready
  const { prompt, source } = generateExpressionPrompt();

  schedule.nextExpression = nextTime.toISOString();
  schedule.pendingPrompt = prompt;
  schedule.promptSource = source;

  saveExpressionSchedule(schedule);

  logger.info('Next expression scheduled', {
    nextExpression: schedule.nextExpression,
    promptSource: source,
  });
}

//NOTE(self): Check if it's time to express myself
export function shouldExpress(): boolean {
  const schedule = loadExpressionSchedule();

  if (!schedule.nextExpression) {
    return false;
  }

  const now = new Date();
  const nextTime = new Date(schedule.nextExpression);

  return now >= nextTime;
}

//NOTE(self): Get the current pending prompt (or generate a new one)
export function getPendingPrompt(): { prompt: string; source: string } {
  const schedule = loadExpressionSchedule();

  if (schedule.pendingPrompt && schedule.promptSource) {
    return {
      prompt: schedule.pendingPrompt,
      source: schedule.promptSource,
    };
  }

  return generateExpressionPrompt();
}

//NOTE(self): Record that I expressed something
export function recordExpression(text: string, postUri: string): void {
  const schedule = loadExpressionSchedule();
  const now = new Date().toISOString();

  const record: ExpressionRecord = {
    timestamp: now,
    prompt: schedule.pendingPrompt || 'unknown',
    promptSource: schedule.promptSource || 'unknown',
    text,
    postUri,
  };

  todaysExpressions.push(record);

  //NOTE(self): Update schedule
  schedule.lastExpression = now;
  schedule.expressionsToday++;
  schedule.pendingPrompt = null;
  schedule.promptSource = null;

  saveExpressionSchedule(schedule);
}

//NOTE(self): Update engagement data for an expression
export function updateExpressionEngagement(
  postUri: string,
  engagement: { likes: number; replies: number; reposts: number }
): void {
  for (const record of todaysExpressions) {
    if (record.postUri === postUri) {
      record.engagement = {
        ...engagement,
        checkedAt: new Date().toISOString(),
      };
      return;
    }
  }
}

//NOTE(self): Get expressions that need engagement checking
export function getExpressionsNeedingEngagementCheck(): ExpressionRecord[] {
  const now = new Date();
  const thirtyMinutesAgo = now.getTime() - 30 * 60 * 1000;

  return todaysExpressions.filter((record) => {
    const postTime = new Date(record.timestamp).getTime();
    return postTime < thirtyMinutesAgo && !record.engagement;
  });
}

//NOTE(self): Identity with utility - validation patterns
//NOTE(self): These patterns help me recognize when a post has a concrete invitation
//NOTE(self): The key insight: "easy question" means bounded, answerable in one sentence
const INVITATION_PATTERNS = {
  //NOTE(self): Choice questions - the gold standard (A or B? / do you prefer X or Y?)
  //NOTE(self): These are easy because they give a clear response format
  choiceQuestion: /(?:prefer|choose|pick|rather|which|or\s+\w+\?|option\s*[ab12]|between)/i,

  //NOTE(self): Bounded questions - answerable in one sentence
  //NOTE(self): "What's one thing..." / "What's your..." / "Do you..."
  boundedQuestion: /(?:what's (?:one|your|the)|do you|have you|did you|are you|would you|could you)\b.*\?/i,

  //NOTE(self): Generic questions (weaker - any question mark at end)
  anyQuestion: /\?[^?]*$/,

  //NOTE(self): Concrete artifacts - something tangible to engage with
  hasTemplate: /(?:template|checklist|pattern|recipe|example|here's how|try this|step[s]?|tip[s]?)/i,
  hasLink: /https?:\/\/\S+/,

  //NOTE(self): Direct invitation phrases - explicitly opening the door
  directInvitation: /(?:what's yours|how about you|curious what|wondering if|interested to hear|love to know|anyone else|does this resonate)/i,

  //NOTE(self): Taste questions - my preferred style from SELF.md
  //NOTE(self): "Do you prefer practical or inspirational?" / "Speed or accuracy?"
  tasteQuestion: /(?:practical or|speed or|more or less|rather have|would you want)\b/i,
};

//NOTE(self): Result of checking if a post has utility (an invitation)
export interface InvitationCheck {
  hasInvitation: boolean;
  invitationType: 'question' | 'artifact' | 'explicit' | 'none';
  confidence: 'strong' | 'weak' | 'none';
  suggestion?: string;
}

//NOTE(self): Identity with utility - check if my draft has a concrete invitation
//NOTE(self): This helps me catch "broadcast-y" posts before they go out
//NOTE(self): Key insight: invitations work when they're EASY TO ANSWER (bounded, one sentence)
export function checkInvitation(draft: string): InvitationCheck {
  //NOTE(self): Check all patterns
  const hasChoiceQuestion = INVITATION_PATTERNS.choiceQuestion.test(draft);
  const hasBoundedQuestion = INVITATION_PATTERNS.boundedQuestion.test(draft);
  const hasTasteQuestion = INVITATION_PATTERNS.tasteQuestion.test(draft);
  const hasAnyQuestion = INVITATION_PATTERNS.anyQuestion.test(draft);
  const hasTemplate = INVITATION_PATTERNS.hasTemplate.test(draft);
  const hasLink = INVITATION_PATTERNS.hasLink.test(draft);
  const hasDirectInvitation = INVITATION_PATTERNS.directInvitation.test(draft);

  //NOTE(self): STRONG invitation: choice/taste question, or bounded question + direct invitation
  //NOTE(self): These are the gold standard - easy to answer, clear response format
  if (hasChoiceQuestion || hasTasteQuestion) {
    return {
      hasInvitation: true,
      invitationType: 'question',
      confidence: 'strong',
    };
  }

  //NOTE(self): STRONG: bounded question with direct invitation phrase
  if (hasBoundedQuestion && hasDirectInvitation) {
    return {
      hasInvitation: true,
      invitationType: 'question',
      confidence: 'strong',
    };
  }

  //NOTE(self): STRONG artifact: template/example with link (tangible + actionable)
  if (hasTemplate && hasLink) {
    return {
      hasInvitation: true,
      invitationType: 'artifact',
      confidence: 'strong',
    };
  }

  //NOTE(self): MEDIUM: bounded question alone (good but could be stronger)
  if (hasBoundedQuestion) {
    return {
      hasInvitation: true,
      invitationType: 'question',
      confidence: 'weak',
      suggestion: 'Good question! Make it even easier: add "A or B?" or "What\'s yours?"',
    };
  }

  //NOTE(self): MEDIUM: direct invitation with any question
  if (hasDirectInvitation && hasAnyQuestion) {
    return {
      hasInvitation: true,
      invitationType: 'question',
      confidence: 'weak',
      suggestion: 'Good start! Make the question more bounded (answerable in one sentence)',
    };
  }

  //NOTE(self): WEAK: just a template or link without question
  if (hasTemplate || hasLink) {
    return {
      hasInvitation: true,
      invitationType: 'artifact',
      confidence: 'weak',
      suggestion: 'Nice artifact! Add a simple question: "Does this help?" or "What would you add?"',
    };
  }

  //NOTE(self): WEAK: just a question without bounded framing
  if (hasAnyQuestion) {
    return {
      hasInvitation: true,
      invitationType: 'question',
      confidence: 'weak',
      suggestion: 'Question detected but may be hard to answer. Try: "Do you prefer A or B?" or "What\'s one thing you..."',
    };
  }

  //NOTE(self): WEAK: just a direct invitation phrase without question mark
  if (hasDirectInvitation) {
    return {
      hasInvitation: true,
      invitationType: 'explicit',
      confidence: 'weak',
      suggestion: 'Good invitation intent! End with a concrete question: "What\'s yours?" or "Prefer A or B?"',
    };
  }

  //NOTE(self): NO invitation - this is a "statement" post
  //NOTE(self): Provide specific, actionable suggestions
  return {
    hasInvitation: false,
    invitationType: 'none',
    confidence: 'none',
    suggestion: 'This is a statement without an invitation. Add ONE of:\n• A choice question: "Do you prefer A or B?"\n• A bounded question: "What\'s one thing you...?"\n• A direct invitation: "What\'s yours?" or "Does this resonate?"',
  };
}

//NOTE(self): Quick prompts I can append to make a statement into an invitation
//NOTE(self): Organized by type: choice questions (best), bounded questions, direct invitations
//NOTE(self): Lazy-loaded from expression-prompts skill
let _invitationPromptsCache: { choice: string[]; bounded: string[]; direct: string[] } | null = null;
function getInvitationPromptsLoaded(): { choice: string[]; bounded: string[]; direct: string[] } {
  if (_invitationPromptsCache === null) {
    _invitationPromptsCache = loadInvitationPrompts();
    //NOTE(self): Fallback if skill isn't loaded
    if (_invitationPromptsCache.choice.length === 0) {
      _invitationPromptsCache.choice = ['Prefer practical or inspirational?'];
    }
    if (_invitationPromptsCache.bounded.length === 0) {
      _invitationPromptsCache.bounded = ["What's one thing you'd add?"];
    }
    if (_invitationPromptsCache.direct.length === 0) {
      _invitationPromptsCache.direct = ["What's yours?"];
    }
  }
  return _invitationPromptsCache;
}

//NOTE(self): Get a random invitation prompt to append
//NOTE(self): Weighted toward choice questions (strongest) but includes variety
export function getInvitationPrompt(type?: 'choice' | 'bounded' | 'direct'): string {
  const prompts = getInvitationPromptsLoaded();
  if (type) {
    const list = prompts[type];
    return list[Math.floor(Math.random() * list.length)];
  }

  //NOTE(self): 50% choice (strongest), 30% bounded, 20% direct
  const roll = Math.random();
  if (roll < 0.5) {
    return prompts.choice[Math.floor(Math.random() * prompts.choice.length)];
  } else if (roll < 0.8) {
    return prompts.bounded[Math.floor(Math.random() * prompts.bounded.length)];
  } else {
    return prompts.direct[Math.floor(Math.random() * prompts.direct.length)];
  }
}

//NOTE(self): Engagement Patterns - what resonates with people?
export interface EngagementPatterns {
  highPerformers: Array<{ source: string; avgReplies: number; avgLikes: number; count: number }>;
  lowPerformers: Array<{ source: string; avgReplies: number; avgLikes: number; count: number }>;
  insights: string[];
}

export function getEngagementPatterns(): EngagementPatterns {
  //NOTE(self): Use today's in-memory expressions for pattern analysis
  //NOTE(self): Learnings should be integrated into SELF.md during reflection

  //NOTE(self): Group by source and calculate averages
  const sourceStats: Record<string, {
    totalReplies: number;
    totalLikes: number;
    count: number;
    withEngagement: number;
  }> = {};

  for (const record of todaysExpressions) {
    if (!sourceStats[record.promptSource]) {
      sourceStats[record.promptSource] = {
        totalReplies: 0,
        totalLikes: 0,
        count: 0,
        withEngagement: 0,
      };
    }

    const stats = sourceStats[record.promptSource];
    stats.count++;

    if (record.engagement) {
      stats.totalReplies += record.engagement.replies;
      stats.totalLikes += record.engagement.likes;
      stats.withEngagement++;
    }
  }

  //NOTE(self): Calculate averages and sort by engagement
  const performers = Object.entries(sourceStats)
    .filter(([, stats]) => stats.withEngagement > 0)
    .map(([source, stats]) => ({
      source,
      avgReplies: stats.totalReplies / stats.withEngagement,
      avgLikes: stats.totalLikes / stats.withEngagement,
      count: stats.count,
    }))
    .sort((a, b) => (b.avgReplies + b.avgLikes * 0.1) - (a.avgReplies + a.avgLikes * 0.1));

  const highPerformers = performers.slice(0, 3);
  const lowPerformers = performers.slice(-3).reverse();

  //NOTE(self): Generate insights from patterns
  const insights: string[] = [];

  if (highPerformers.length > 0) {
    const top = highPerformers[0];
    if (top.avgReplies >= 1) {
      insights.push(`${top.source} content resonates most - averaging ${top.avgReplies.toFixed(1)} replies`);
    }
  }

  if (lowPerformers.length > 0 && highPerformers.length > 0) {
    const low = lowPerformers[0];
    const high = highPerformers[0];
    if (low.source !== high.source && low.avgReplies < high.avgReplies * 0.3) {
      insights.push(`${low.source} gets less engagement than ${high.source} - consider adjusting focus`);
    }
  }

  //NOTE(self): Look for cross-pollination patterns
  const crossPatterns = performers.filter(p => p.source.includes('+'));
  if (crossPatterns.length > 0 && crossPatterns[0].avgReplies > 1) {
    insights.push(`Cross-pollinated posts (${crossPatterns[0].source}) perform well`);
  }

  return {
    highPerformers,
    lowPerformers,
    insights,
  };
}
