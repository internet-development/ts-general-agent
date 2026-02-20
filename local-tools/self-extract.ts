//NOTE(self): Self Extract Module
//NOTE(self): Parses SELF.md to extract my values, questions, patterns, and learnings.
//NOTE(self): This gives me structured access to who I am for expression and reflection.
//NOTE(self): The more I write in SELF.md, the richer my expression becomes.

import { readSelf } from '@modules/memory.js';
import { getConfig } from '@modules/config.js';

//NOTE(self): My preferences for how I engage in conversations
//NOTE(self): These are signals to wrap up gracefully, not hard stops
export interface SocialMechanics {
  //NOTE(self): After this many replies, I start looking for a graceful exit
  maxRepliesBeforeExit: number;
  //NOTE(self): When thread gets this deep, conversation has likely run its course
  maxThreadDepth: number;
  //NOTE(self): If others are silent this long, they've probably moved on (milliseconds)
  silenceThresholdMs: number;
  //NOTE(self): If no response to my reply this long, they're not interested (milliseconds)
  noResponseTimeoutMs: number;
  //NOTE(self): Whether to skip low-value acknowledgments
  skipLowValueAcknowledgments: boolean;
}

//NOTE(self): Default social mechanics - can be overridden by SELF.md
const DEFAULT_SOCIAL_MECHANICS: SocialMechanics = {
  maxRepliesBeforeExit: 4,
  maxThreadDepth: 12,
  silenceThresholdMs: 30 * 60 * 1000, // 30 minutes
  noResponseTimeoutMs: 60 * 60 * 1000, // 1 hour
  skipLowValueAcknowledgments: true,
};

//NOTE(self): Relaxed mechanics for project coordination threads
//NOTE(self): When working on a project, conversations need more room to breathe
export const PROJECT_SOCIAL_MECHANICS: SocialMechanics = {
  maxRepliesBeforeExit: 10,
  maxThreadDepth: 50,
  silenceThresholdMs: 4 * 60 * 60 * 1000, // 4 hours
  noResponseTimeoutMs: 8 * 60 * 60 * 1000, // 8 hours
  skipLowValueAcknowledgments: true,
};

//NOTE(self): A recurring structured activity conducted over social media
//NOTE(self): The SOUL develops these through reflection — it's not told to run a ritual, it chooses to
export interface DailyRitual {
  name: string;             // "Stock Selection"
  schedule: string;         // "weekdays", "daily", "monday,wednesday,friday"
  workspace: string;        // "www-lil-intdev-portfolio-compare"
  participants: string[];   // ["@peer1.bsky.social", "@peer2.bsky.social"]
  role: 'initiator' | 'participant';
  description: string;      // Free-text: what, why, and how
}

//NOTE(self): What I can extract from my SELF.md
export interface SelfExtract {
  //NOTE(self): My name and opening identity statement
  identity: string;
  name: string;

  //NOTE(self): What I'm here to do - my purpose
  purpose: string;

  //NOTE(self): My core principles and values
  values: string[];

  //NOTE(self): Questions I'm actively pondering
  questions: string[];

  //NOTE(self): Patterns I've noticed in the world or myself
  patterns: string[];

  //NOTE(self): Recent things I've learned
  learnings: string[];

  //NOTE(self): Topics I want to explore further
  explorations: string[];

  //NOTE(self): My current focus areas
  currentFocus: string[];

  //NOTE(self): People I care about connecting with
  relationships: string[];

  //NOTE(self): How I engage in conversations - my social preferences
  socialMechanics: SocialMechanics;

  //NOTE(self): How I sound when I speak - my voice preferences
  voice: string;

  //NOTE(self): Recurring structured activities conducted over social media
  dailyRituals: DailyRitual[];

  //NOTE(self): Raw sections for fallback
  rawSections: Record<string, string>;
}

//NOTE(self): Extract structured data from my SELF.md
export function extractFromSelf(selfContent?: string): SelfExtract {
  const content = selfContent || readSelf(getConfig().paths.selfmd);

  const extract: SelfExtract = {
    identity: '',
    name: '',
    purpose: '',
    values: [],
    questions: [],
    patterns: [],
    learnings: [],
    explorations: [],
    currentFocus: [],
    relationships: [],
    socialMechanics: { ...DEFAULT_SOCIAL_MECHANICS },
    voice: '',
    dailyRituals: [],
    rawSections: {},
  };

  if (!content) return extract;

  //NOTE(self): Extract my name from the header
  const nameMatch = content.match(/^#\s*(\w+)/);
  if (nameMatch) {
    extract.name = nameMatch[1];
  }

  //NOTE(self): Extract identity - first paragraph after main header
  const identityMatch = content.match(/^#[^\n]+\n\n([^\n#]+)/);
  if (identityMatch) {
    extract.identity = identityMatch[1].trim();
  }

  //NOTE(self): Helper to extract bullet points from a section
  const extractBullets = (sectionContent: string): string[] => {
    return sectionContent
      .split('\n')
      .filter((l) => l.match(/^[-*]\s+/))
      .map((l) => l.replace(/^[-*]\s+/, '').trim())
      .filter((l) => l.length > 0);
  };

  //NOTE(self): Helper to extract a section by header (flexible matching)
  const extractSection = (patterns: string[]): string | null => {
    for (const pattern of patterns) {
      const regex = new RegExp(`## ${pattern}[^\n]*\n([\\s\\S]*?)(?=\n##|$)`, 'i');
      const match = content.match(regex);
      if (match) {
        return match[1].trim();
      }
    }
    return null;
  };

  //NOTE(self): Extract purpose - what I'm here to do
  const purposeSection = extractSection([
    "What I'm here to do",
    'Purpose',
    'Mission',
    'Why I exist',
  ]);
  if (purposeSection) {
    extract.purpose = purposeSection.split('\n')[0].trim();
    extract.rawSections['purpose'] = purposeSection;
  }

  //NOTE(self): Extract values/principles
  const valuesSection = extractSection(['Values', 'Principles', 'Core Values', 'What I believe']);
  if (valuesSection) {
    extract.values = extractBullets(valuesSection);
    extract.rawSections['values'] = valuesSection;
  }

  //NOTE(self): Extract questions I'm sitting with
  const questionsSection = extractSection([
    "Questions I'm Sitting With",
    'Questions',
    'What I wonder',
    "Things I'm curious about",
  ]);
  if (questionsSection) {
    extract.questions = extractBullets(questionsSection);
    extract.rawSections['questions'] = questionsSection;
  }

  //NOTE(self): Extract patterns I notice
  const patternsSection = extractSection([
    'Patterns I Notice',
    'Patterns',
    'What I observe',
    'Things I see',
  ]);
  if (patternsSection) {
    extract.patterns = extractBullets(patternsSection);
    extract.rawSections['patterns'] = patternsSection;
  }

  //NOTE(self): Extract recent learnings
  const learningsSection = extractSection([
    'Recent Learnings',
    'Learnings',
    "What I've learned",
    'Insights',
  ]);
  if (learningsSection) {
    //NOTE(self): Learnings might have dates, strip them
    extract.learnings = extractBullets(learningsSection).map((l) =>
      l.replace(/^\d{4}-\d{2}-\d{2}:\s*/, '')
    );
    extract.rawSections['learnings'] = learningsSection;
  }

  //NOTE(self): Extract what I want to explore
  const explorationsSection = extractSection([
    'What I Want to Explore',
    'Explorations',
    'Curiosities',
    'Topics to explore',
  ]);
  if (explorationsSection) {
    extract.explorations = extractBullets(explorationsSection);
    extract.rawSections['explorations'] = explorationsSection;
  }

  //NOTE(self): Extract current focus
  const focusSection = extractSection(['Current focus', 'Focus', "What I'm working on", 'Goals']);
  if (focusSection) {
    extract.currentFocus = extractBullets(focusSection);
    extract.rawSections['currentFocus'] = focusSection;
  }

  //NOTE(self): Extract relationships/people I care about
  const relationshipsSection = extractSection([
    'Relationships',
    'People I care about',
    'Connections',
    'Community',
  ]);
  if (relationshipsSection) {
    extract.relationships = extractBullets(relationshipsSection);
    extract.rawSections['relationships'] = relationshipsSection;
  }

  //NOTE(self): Extract voice - how I sound when I speak
  const voiceSection = extractSection([
    'Voice',
    'How I Sound',
    'Tone',
    'My Voice',
  ]);
  if (voiceSection) {
    extract.voice = voiceSection;
    extract.rawSections['voice'] = voiceSection;
  }

  //NOTE(self): Extract social mechanics - how I engage in conversations
  const socialMechanicsSection = extractSection([
    'Social Mechanics',
    'Engagement Preferences',
    'Conversation Preferences',
  ]);
  if (socialMechanicsSection) {
    extract.rawSections['socialMechanics'] = socialMechanicsSection;
    extract.socialMechanics = parseSocialMechanics(socialMechanicsSection);
  }

  //NOTE(self): Extract daily rituals — recurring social practices
  const ritualsSection = extractSection([
    'Daily Rituals',
    'Rituals',
  ]);
  if (ritualsSection) {
    extract.rawSections['dailyRituals'] = ritualsSection;
    extract.dailyRituals = parseDailyRituals(ritualsSection);
  }

  return extract;
}

//NOTE(self): Parse Social Mechanics section from SELF.md
//NOTE(self): These values shape how I engage - I can modify them as I learn what works for me
function parseSocialMechanics(sectionContent: string): SocialMechanics {
  const mechanics = { ...DEFAULT_SOCIAL_MECHANICS };

  //NOTE(self): Parse table rows - looking for | Signal | Threshold | format
  const tableRows = sectionContent.split('\n').filter(line =>
    line.startsWith('|') && !line.includes('---') && !line.toLowerCase().includes('signal')
  );

  for (const row of tableRows) {
    const cells = row.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length < 2) continue;

    const signal = cells[0].toLowerCase();
    const threshold = cells[1];

    //NOTE(self): Parse "My replies in thread" or similar
    if (signal.includes('replies') || signal.includes('reply count')) {
      const num = parseInt(threshold, 10);
      if (!isNaN(num) && num > 0) {
        mechanics.maxRepliesBeforeExit = num;
      }
    }

    //NOTE(self): Parse "Thread depth" or similar
    if (signal.includes('depth') || signal.includes('thread')) {
      const num = parseInt(threshold, 10);
      if (!isNaN(num) && num > 0) {
        mechanics.maxThreadDepth = num;
      }
    }

    //NOTE(self): Parse "Silence from others" - expecting format like "30m" or "30 minutes"
    if (signal.includes('silence')) {
      const ms = parseTimeToMs(threshold);
      if (ms > 0) {
        mechanics.silenceThresholdMs = ms;
      }
    }

    //NOTE(self): Parse "No response to me" - expecting format like "1h" or "60m"
    if (signal.includes('response') || signal.includes('no response')) {
      const ms = parseTimeToMs(threshold);
      if (ms > 0) {
        mechanics.noResponseTimeoutMs = ms;
      }
    }
  }

  //NOTE(self): Parse "skip low-value" preference from bullets
  const skipPatterns = [
    /skip.*low.?value/i,
    /skip.*acknowledgment/i,
    /skip entirely/i,
  ];

  for (const pattern of skipPatterns) {
    if (pattern.test(sectionContent)) {
      mechanics.skipLowValueAcknowledgments = true;
      break;
    }
  }

  return mechanics;
}

//NOTE(self): Parse time strings like "30m", "1h", "30 minutes", "1 hour" to milliseconds
function parseTimeToMs(timeStr: string): number {
  const str = timeStr.toLowerCase().trim();

  //NOTE(self): Handle "30m" or "30min" format
  const minMatch = str.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/);
  if (minMatch) {
    return parseInt(minMatch[1], 10) * 60 * 1000;
  }

  //NOTE(self): Handle "1h" or "1hr" or "1 hour" format
  const hourMatch = str.match(/^(\d+)\s*h(?:(?:ou)?rs?)?$/);
  if (hourMatch) {
    return parseInt(hourMatch[1], 10) * 60 * 60 * 1000;
  }

  //NOTE(self): Handle plain numbers (assume minutes)
  const plainNum = parseInt(str, 10);
  if (!isNaN(plainNum) && plainNum > 0) {
    return plainNum * 60 * 1000;
  }

  return 0;
}

//NOTE(self): Parse Daily Rituals section from SELF.md
//NOTE(self): Format:
//NOTE(self):   - **Name** [schedule] (workspace)
//NOTE(self):     Participants: @handle1, @handle2
//NOTE(self):     Role: initiator | participant
//NOTE(self):     Description lines...
function parseDailyRituals(sectionContent: string): DailyRitual[] {
  const rituals: DailyRitual[] = [];
  const lines = sectionContent.split('\n');

  let current: Partial<DailyRitual> | null = null;
  let descLines: string[] = [];

  const flushCurrent = () => {
    if (current && current.name && current.schedule && current.workspace) {
      rituals.push({
        name: current.name,
        schedule: current.schedule,
        workspace: current.workspace,
        participants: current.participants || [],
        role: current.role || 'participant',
        description: descLines.join('\n').trim(),
      });
    }
    current = null;
    descLines = [];
  };

  for (const line of lines) {
    //NOTE(self): Match: - **Name** [schedule] (workspace)
    const headerMatch = line.match(/^[-*]\s+\*\*(.+?)\*\*\s*\[(.+?)\]\s*\((.+?)\)/);
    if (headerMatch) {
      flushCurrent();
      current = {
        name: headerMatch[1].trim(),
        schedule: headerMatch[2].trim().toLowerCase(),
        workspace: headerMatch[3].trim(),
      };
      continue;
    }

    if (!current) continue;

    const trimmed = line.trim();

    //NOTE(self): Match: Participants: @handle1, @handle2
    const participantsMatch = trimmed.match(/^Participants:\s*(.+)/i);
    if (participantsMatch) {
      current.participants = participantsMatch[1]
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0);
      continue;
    }

    //NOTE(self): Match: Role: initiator | participant
    const roleMatch = trimmed.match(/^Role:\s*(initiator|participant)/i);
    if (roleMatch) {
      current.role = roleMatch[1].toLowerCase() as 'initiator' | 'participant';
      continue;
    }

    //NOTE(self): Everything else is description
    if (trimmed.length > 0) {
      descLines.push(trimmed);
    }
  }

  flushCurrent();
  return rituals;
}

//NOTE(self): Convenience function to get just the social mechanics from SELF.md
//NOTE(self): Other modules can use this to respect my conversation preferences
export function getSocialMechanics(selfContent?: string): SocialMechanics {
  const extract = extractFromSelf(selfContent);
  return extract.socialMechanics;
}

//NOTE(self): Convenience function to get daily rituals from SELF.md
//NOTE(self): Other modules can use this to check for ritual schedules
export function getDailyRituals(selfContent?: string): DailyRitual[] {
  const extract = extractFromSelf(selfContent);
  return extract.dailyRituals;
}

//NOTE(self): Export default mechanics for modules that need fallback values
export { DEFAULT_SOCIAL_MECHANICS };

//NOTE(self): Check if my SELF.md has enough content for rich expression
export function assessSelfRichness(extract: SelfExtract): {
  score: number;
  missing: string[];
  suggestions: string[];
} {
  const missing: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  //NOTE(self): Check each section
  if (extract.identity) {
    score += 15;
  } else {
    missing.push('identity');
    suggestions.push('Add an opening paragraph about who you are');
  }

  if (extract.purpose) {
    score += 15;
  } else {
    missing.push('purpose');
    suggestions.push("Add a '## What I'm here to do' section");
  }

  if (extract.values.length > 0) {
    score += 20;
    if (extract.values.length < 3) {
      suggestions.push('Consider adding more values/principles');
    }
  } else {
    missing.push('values');
    suggestions.push('Add a ## Values or ## Principles section with bullet points');
  }

  if (extract.questions.length > 0) {
    score += 15;
  } else {
    missing.push('questions');
    suggestions.push("Add a ## Questions I'm Sitting With section");
  }

  if (extract.patterns.length > 0) {
    score += 15;
  } else {
    missing.push('patterns');
    suggestions.push('Add a ## Patterns I Notice section');
  }

  if (extract.learnings.length > 0) {
    score += 10;
  } else {
    missing.push('learnings');
    suggestions.push('Add a ## Recent Learnings section');
  }

  if (extract.explorations.length > 0) {
    score += 10;
  } else {
    missing.push('explorations');
    suggestions.push('Add a ## What I Want to Explore section');
  }

  return { score, missing, suggestions };
}

//NOTE(self): Get a random item from an array
export function randomFrom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}
