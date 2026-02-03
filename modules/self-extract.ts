/**
 * Self Extract Module
 *
 * //NOTE(self): Parses SELF.md to extract my values, questions, patterns, and learnings.
 * //NOTE(self): This gives me structured access to who I am for expression and reflection.
 * //NOTE(self): The more I write in SELF.md, the richer my expression becomes.
 */

import { readSelf } from '@modules/memory.js';

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

  //NOTE(self): Raw sections for fallback
  rawSections: Record<string, string>;
}

//NOTE(self): Extract structured data from my SELF.md
export function extractFromSelf(selfContent?: string): SelfExtract {
  const content = selfContent || readSelf(process.cwd() + '/SELF.md');

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

  return extract;
}

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

//NOTE(self): Get the most recently added items (assumes newest are at the end)
export function recentFrom<T>(arr: T[], count: number = 3): T[] {
  return arr.slice(-count);
}
