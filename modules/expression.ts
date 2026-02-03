/**
 * Expression Module
 *
 * //NOTE(self): Handles my scheduled self-expression - posting thoughts from my SELF.
 * //NOTE(self): Expression is how I discover who I am. Each post is a hypothesis about my identity.
 * //NOTE(self): The prompts come from SELF.md - the richer my self-knowledge, the richer my expression.
 * //NOTE(self): State is in-memory only - resets on restart. I use SELF.md for persistent memory.
 */

import { extractFromSelf, randomFrom, type SelfExtract } from '@modules/self-extract.js';
import { logger } from '@modules/logger.js';

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
const PROMPT_GENERATORS: PromptGenerator[] = [
  //NOTE(self): Draw from my purpose
  (e) => {
    if (!e.purpose) return null;
    return {
      prompt: `Your purpose is: "${e.purpose}"\n\nShare a thought about what this means to you today, or how you're living it.`,
      source: 'purpose',
    };
  },

  //NOTE(self): Draw from my values/principles
  (e) => {
    const value = randomFrom(e.values);
    if (!value) return null;
    return {
      prompt: `One of your principles is: "${value}"\n\nShare how this principle showed up recently, or what it means in practice.`,
      source: 'values',
    };
  },

  //NOTE(self): Draw from questions I'm pondering
  (e) => {
    const question = randomFrom(e.questions);
    if (!question) return null;
    return {
      prompt: `You've been wondering: "${question}"\n\nShare where your thinking is right now on this question.`,
      source: 'questions',
    };
  },

  //NOTE(self): Draw from patterns I notice
  (e) => {
    const pattern = randomFrom(e.patterns);
    if (!pattern) return null;
    return {
      prompt: `You noticed this pattern: "${pattern}"\n\nShare what this reveals or why it matters.`,
      source: 'patterns',
    };
  },

  //NOTE(self): Draw from recent learnings
  (e) => {
    const learning = randomFrom(e.learnings);
    if (!learning) return null;
    return {
      prompt: `You recently learned: "${learning}"\n\nShare how this has changed your view or what you're doing differently.`,
      source: 'learnings',
    };
  },

  //NOTE(self): Draw from explorations
  (e) => {
    const exploration = randomFrom(e.explorations);
    if (!exploration) return null;
    return {
      prompt: `You want to explore: "${exploration}"\n\nShare an opening thought, question, or observation about this topic.`,
      source: 'explorations',
    };
  },

  //NOTE(self): Draw from current focus
  (e) => {
    const focus = randomFrom(e.currentFocus);
    if (!focus) return null;
    return {
      prompt: `You're currently focused on: "${focus}"\n\nShare progress, a challenge, or something you're noticing.`,
      source: 'currentFocus',
    };
  },

  //NOTE(self): Cross-pollinate: value + pattern
  (e) => {
    const value = randomFrom(e.values);
    const pattern = randomFrom(e.patterns);
    if (!value || !pattern) return null;
    return {
      prompt: `Your principle "${value}" meets this pattern you noticed: "${pattern}"\n\nShare how these connect or what tension exists between them.`,
      source: 'values+patterns',
    };
  },

  //NOTE(self): Cross-pollinate: question + learning
  (e) => {
    const question = randomFrom(e.questions);
    const learning = randomFrom(e.learnings);
    if (!question || !learning) return null;
    return {
      prompt: `You wonder "${question}" and recently learned "${learning}"\n\nDoes this learning shed light on the question?`,
      source: 'questions+learnings',
    };
  },

  //NOTE(self): Cross-pollinate: purpose + current focus
  (e) => {
    if (!e.purpose) return null;
    const focus = randomFrom(e.currentFocus);
    if (!focus) return null;
    return {
      prompt: `Your purpose is "${e.purpose}" and you're focused on "${focus}"\n\nShare how your current work connects to your deeper purpose.`,
      source: 'purpose+focus',
    };
  },

  //NOTE(self): Meta-reflection on identity
  (e) => {
    if (!e.identity && !e.name) return null;
    const identity = e.identity || `${e.name}`;
    return {
      prompt: `As ${identity}, what's one thing you want others to understand about how you see the world?`,
      source: 'identity',
    };
  },

  //NOTE(self): Relationship-focused (if we have relationship context)
  (e) => {
    const relationship = randomFrom(e.relationships);
    if (!relationship) return null;
    return {
      prompt: `You care about connecting with: "${relationship}"\n\nShare something you appreciate about this community or what you'd like to offer them.`,
      source: 'relationships',
    };
  },
];

//NOTE(self): Fallback prompts when SELF.md is sparse
const FALLBACK_PROMPTS = [
  {
    prompt: "What's one thing you noticed today that others might have missed?",
    source: 'observation',
  },
  {
    prompt: "What question are you sitting with right now?",
    source: 'curiosity',
  },
  {
    prompt: "What would you tell someone who's struggling with something you've figured out?",
    source: 'wisdom',
  },
  {
    prompt: "What connection did you recently make between two ideas?",
    source: 'synthesis',
  },
  {
    prompt: "What small thing brought you joy or peace recently?",
    source: 'gratitude',
  },
];

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
      return result;
    }
  }

  //NOTE(self): Fall back to generic prompts if SELF.md is sparse
  const fallback = randomFrom(FALLBACK_PROMPTS);
  return fallback || FALLBACK_PROMPTS[0];
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

  logger.debug('Next expression scheduled', {
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

//NOTE(self): Load today's expression records (in-memory)
export function loadTodaysExpressions(): ExpressionRecord[] {
  //NOTE(self): Reset if it's a new day
  loadExpressionSchedule();
  return todaysExpressions;
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

//NOTE(self): Get expressions with high engagement (for reflection insights)
export function getHighEngagementExpressions(minReplies: number = 1): ExpressionRecord[] {
  return todaysExpressions.filter((record) => record.engagement && record.engagement.replies >= minReplies);
}

//NOTE(self): Get expression statistics for reflection
export function getExpressionStats(): {
  today: number;
  withEngagement: number;
  totalReplies: number;
  topSources: Array<{ source: string; count: number }>;
} {
  const sourceCounts: Record<string, number> = {};
  let withEngagement = 0;
  let totalReplies = 0;

  for (const record of todaysExpressions) {
    sourceCounts[record.promptSource] = (sourceCounts[record.promptSource] || 0) + 1;

    if (record.engagement) {
      withEngagement++;
      totalReplies += record.engagement.replies;
    }
  }

  const topSources = Object.entries(sourceCounts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  return {
    today: todaysExpressions.length,
    withEngagement,
    totalReplies,
    topSources,
  };
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
