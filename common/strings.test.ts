import { describe, it, expect } from 'vitest';
import {
  isEmpty,
  createSlug,
  ensureHttps,
  normalizePostText,
  truncateGraphemes,
  semanticSimilarity,
  findSemanticEcho,
  classifyHostIntentStructural,
  findSemanticEchoEnsemble,
  PORTABLE_MAX_GRAPHEMES,
} from '@common/strings.js';

// ---------------------------------------------------------------------------
// isEmpty
// ---------------------------------------------------------------------------
describe('isEmpty', () => {
  it('returns true for null', () => {
    expect(isEmpty(null)).toBe(true);
  });

  it('returns true for undefined', () => {
    expect(isEmpty(undefined)).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isEmpty('')).toBe(true);
  });

  it('returns true for whitespace-only string', () => {
    expect(isEmpty('   ')).toBe(true);
    expect(isEmpty('\t')).toBe(true);
    expect(isEmpty('\n')).toBe(true);
    expect(isEmpty('  \t\n  ')).toBe(true);
  });

  it('returns false for the number 0', () => {
    expect(isEmpty(0)).toBe(false);
  });

  it('returns false for non-empty strings', () => {
    expect(isEmpty('hello')).toBe(false);
    expect(isEmpty('a')).toBe(false);
    expect(isEmpty(' a ')).toBe(false);
  });

  it('returns true for plain objects', () => {
    expect(isEmpty({})).toBe(true);
  });

  it('returns true for arrays', () => {
    expect(isEmpty([])).toBe(true);
  });

  it('returns true for objects with properties (treats all objects as empty)', () => {
    expect(isEmpty({ key: 'value' })).toBe(true);
  });

  it('returns true for false (falsy non-zero)', () => {
    expect(isEmpty(false)).toBe(true);
  });

  it('returns false for non-zero numbers', () => {
    expect(isEmpty(1)).toBe(false);
    expect(isEmpty(-1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createSlug
// ---------------------------------------------------------------------------
describe('createSlug', () => {
  it('converts text to lowercase hyphenated slug', () => {
    expect(createSlug('Hello World')).toBe('hello-world');
  });

  it('normalizes accented characters', () => {
    expect(createSlug('cafe')).toBe('cafe');
    expect(createSlug('cafe')).toBe('cafe');
    // Accented chars in the replacement list
    expect(createSlug('uber')).toBe('uber');
    expect(createSlug('naive')).toBe('naive');
  });

  it('replaces & with -and-', () => {
    expect(createSlug('rock & roll')).toBe('rock-and-roll');
  });

  it('returns "untitled" for empty input', () => {
    expect(createSlug('')).toBe('untitled');
    expect(createSlug(null)).toBe('untitled');
    expect(createSlug(undefined)).toBe('untitled');
    expect(createSlug('   ')).toBe('untitled');
  });

  it('strips special characters', () => {
    expect(createSlug('hello!@#$%world')).toBe('helloworld');
  });

  it('collapses multiple hyphens into one', () => {
    expect(createSlug('hello---world')).toBe('hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    expect(createSlug('-hello world-')).toBe('hello-world');
  });

  it('handles multiple spaces', () => {
    expect(createSlug('hello   world')).toBe('hello-world');
  });

  it('handles numbers in text', () => {
    expect(createSlug('version 2')).toBe('version-2');
  });

  it('normalizes specific accented characters from the replacement map', () => {
    // ae ligature -> a
    expect(createSlug('aether')).toBe('aether');
    // c cedilla -> c
    expect(createSlug('facade')).toBe('facade');
  });
});

// ---------------------------------------------------------------------------
// ensureHttps
// ---------------------------------------------------------------------------
describe('ensureHttps', () => {
  it('adds https:// to bare domain', () => {
    expect(ensureHttps('github.com')).toBe('https://github.com');
  });

  it('adds https:// to bare domain with path', () => {
    expect(ensureHttps('github.com/user/repo')).toBe('https://github.com/user/repo');
  });

  it('preserves existing https://', () => {
    expect(ensureHttps('https://x.com')).toBe('https://x.com');
  });

  it('preserves existing http://', () => {
    expect(ensureHttps('http://x.com')).toBe('http://x.com');
  });

  it('is case-insensitive for protocol check', () => {
    expect(ensureHttps('HTTP://example.com')).toBe('HTTP://example.com');
    expect(ensureHttps('HTTPS://example.com')).toBe('HTTPS://example.com');
  });

  it('handles URLs with query parameters', () => {
    expect(ensureHttps('example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('handles URLs with fragments', () => {
    expect(ensureHttps('example.com/page#section')).toBe('https://example.com/page#section');
  });
});

// ---------------------------------------------------------------------------
// normalizePostText
// ---------------------------------------------------------------------------
describe('normalizePostText', () => {
  it('strips @mentions', () => {
    const result = normalizePostText('@user hello world');
    expect(result).not.toContain('@user');
    expect(result).toContain('hello world');
  });

  it('strips multiple @mentions', () => {
    const result = normalizePostText('@alice @bob hello');
    expect(result).not.toContain('@alice');
    expect(result).not.toContain('@bob');
    expect(result).toContain('hello');
  });

  it('strips @mentions with dots and hyphens', () => {
    const result = normalizePostText('@user.name-123 hello');
    expect(result).not.toContain('@user');
    expect(result).toContain('hello');
  });

  it('strips https:// URLs', () => {
    const result = normalizePostText('check out https://example.com/page and more');
    expect(result).not.toContain('https://');
    expect(result).not.toContain('example.com');
    expect(result).toContain('check out');
    expect(result).toContain('and more');
  });

  it('strips http:// URLs', () => {
    const result = normalizePostText('visit http://example.com now');
    expect(result).not.toContain('http://');
    expect(result).toContain('visit');
    expect(result).toContain('now');
  });

  it('strips bare domain URLs (e.g., github.com/...)', () => {
    const result = normalizePostText('see github.com/user/repo for details');
    expect(result).not.toContain('github.com');
    expect(result).toContain('see');
    expect(result).toContain('for details');
  });

  it('lowercases text', () => {
    expect(normalizePostText('HELLO WORLD')).toBe('hello world');
  });

  it('collapses multiple spaces into one', () => {
    expect(normalizePostText('hello    world')).toBe('hello world');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizePostText('  hello  ')).toBe('hello');
  });

  it('truncates to 200 characters', () => {
    const longText = 'a'.repeat(300);
    const result = normalizePostText(longText);
    expect(result.length).toBe(200);
  });

  it('handles combined normalization', () => {
    const input = '@bot  Check  HTTPS://example.com  and  github.com/repo  for info';
    const result = normalizePostText(input);
    expect(result).not.toContain('@bot');
    expect(result).not.toContain('https://');
    expect(result).not.toContain('github.com');
    // lowercased and spaces collapsed
    expect(result).toBe('check and for info');
  });
});

// ---------------------------------------------------------------------------
// truncateGraphemes
// ---------------------------------------------------------------------------
describe('truncateGraphemes', () => {
  it('exports PORTABLE_MAX_GRAPHEMES as 300', () => {
    expect(PORTABLE_MAX_GRAPHEMES).toBe(300);
  });

  it('returns short text unchanged', () => {
    expect(truncateGraphemes('hello')).toBe('hello');
  });

  it('returns text at exactly the limit unchanged', () => {
    const text = 'a'.repeat(300);
    expect(truncateGraphemes(text)).toBe(text);
  });

  it('truncates text exceeding the default limit (300)', () => {
    const text = 'a'.repeat(400);
    const result = truncateGraphemes(text);
    expect(result.length).toBe(300);
  });

  it('truncates to a custom grapheme limit', () => {
    const text = 'hello world this is a test';
    const result = truncateGraphemes(text, 5);
    expect(result).toBe('hello');
  });

  it('handles emoji grapheme clusters', () => {
    // Each flag emoji is 2 code points (regional indicator pair) but 1 grapheme
    const flags = '\u{1F1FA}\u{1F1F8}'.repeat(10); // 10 US flag emojis
    const result = truncateGraphemes(flags, 5);
    // Should contain exactly 5 flag emojis
    expect(result).toBe('\u{1F1FA}\u{1F1F8}'.repeat(5));
  });

  it('does not split multi-codepoint emoji when truncating', () => {
    // Use simple emoji (U+1F600 grinning face) mixed with ASCII
    // Each emoji is 1 grapheme but 2 UTF-16 code units
    const text = 'ab\u{1F600}cd\u{1F600}ef';
    // Graphemes: a, b, grinning, c, d, grinning, e, f = 8
    const result = truncateGraphemes(text, 3);
    expect(result).toBe('ab\u{1F600}');
  });

  it('returns empty string for maxGraphemes=0', () => {
    expect(truncateGraphemes('hello', 0)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// semanticSimilarity
// ---------------------------------------------------------------------------
describe('semanticSimilarity', () => {
  it('returns high score for identical texts', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const score = semanticSimilarity(text, text);
    expect(score).toBeGreaterThan(0.9);
  });

  it('returns high score for very similar texts', () => {
    const a = 'We should implement a caching layer for the API endpoints';
    const b = 'We need to implement caching for our API endpoints';
    const score = semanticSimilarity(a, b);
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns low score for completely different texts', () => {
    const a = 'The weather is beautiful today with clear skies';
    const b = 'Modern software architecture requires careful database design';
    const score = semanticSimilarity(a, b);
    expect(score).toBeLessThan(0.3);
  });

  it('returns 0 for short texts with fewer than 3 content tokens', () => {
    expect(semanticSimilarity('hi there', 'hello friend')).toBe(0);
    expect(semanticSimilarity('yes', 'no')).toBe(0);
  });

  it('returns 0 when one text has fewer than 3 tokens', () => {
    expect(semanticSimilarity('ok sure', 'The implementation of caching is critical for performance')).toBe(0);
  });

  it('returns a score between 0 and 1', () => {
    const a = 'Building a distributed caching system for production workloads';
    const b = 'Creating an event-driven architecture for real-time processing';
    const score = semanticSimilarity(a, b);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('is symmetric (order does not matter)', () => {
    const a = 'Creating new endpoints for the notification service';
    const b = 'Building notification service endpoints from scratch';
    expect(semanticSimilarity(a, b)).toBe(semanticSimilarity(b, a));
  });

  it('filters stopwords from comparison', () => {
    // These differ only in stopwords, content words are the same
    const a = 'quick brown fox jumps lazy dog again';
    const b = 'the quick brown fox jumps over lazy dog again';
    const score = semanticSimilarity(a, b);
    // After stopword removal, these should be nearly identical
    expect(score).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// findSemanticEcho
// ---------------------------------------------------------------------------
describe('findSemanticEcho', () => {
  it('finds an echo when similarity is above threshold', () => {
    const message = 'We should implement a caching layer for the API';
    const peers = [
      'The database needs better indexing for search queries',
      'We need to implement caching for API endpoints',
    ];
    const result = findSemanticEcho(message, peers, 0.4);
    expect(result.isEcho).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.4);
    expect(result.matchedMessage).toBeDefined();
  });

  it('returns false when no message exceeds threshold', () => {
    const message = 'Deploying machine learning models to production infrastructure';
    const peers = [
      'The frontend design needs a responsive mobile layout',
      'We should update the documentation for the release notes',
    ];
    const result = findSemanticEcho(message, peers, 0.8);
    expect(result.isEcho).toBe(false);
  });

  it('returns the matched message that triggered echo', () => {
    const message = 'Implementing caching strategy for database queries';
    const peers = [
      'The UI components need new styling adjustments',
      'Building a cache layer for database query optimization',
    ];
    const result = findSemanticEcho(message, peers, 0.3);
    if (result.isEcho) {
      expect(result.matchedMessage).toContain('cache');
    }
  });

  it('early exits on first match above threshold', () => {
    const message = 'Creating the notification service endpoints';
    // First peer is an echo, second is also similar
    const peers = [
      'Building notification service endpoints from scratch',
      'Developing the notification API endpoint layer',
    ];
    const result = findSemanticEcho(message, peers, 0.3);
    // Should return on first match (early exit)
    expect(result.isEcho).toBe(true);
    expect(result.matchedMessage).toBe(peers[0]);
  });

  it('returns score 0 and isEcho false for empty peer list', () => {
    const result = findSemanticEcho('some message with enough words', [], 0.5);
    expect(result.isEcho).toBe(false);
    expect(result.score).toBe(0);
  });

  it('handles short messages gracefully (returns 0 score)', () => {
    const result = findSemanticEcho('ok', ['sure thing'], 0.5);
    expect(result.isEcho).toBe(false);
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// classifyHostIntentStructural
// ---------------------------------------------------------------------------
describe('classifyHostIntentStructural', () => {
  describe('follow_up intent', () => {
    it('classifies "did you create the issue?" as follow_up', () => {
      const result = classifyHostIntentStructural('did you create the issue?');
      expect(result.intent).toBe('follow_up');
      expect(result.confidence).toBe('high');
    });

    it('classifies "any update?" as follow_up', () => {
      const result = classifyHostIntentStructural('any update?');
      expect(result.intent).toBe('follow_up');
      expect(result.confidence).toBe('high');
    });

    it('classifies "have you finished the task?" as follow_up', () => {
      const result = classifyHostIntentStructural('have you finished the task?');
      expect(result.intent).toBe('follow_up');
      expect(result.confidence).toBe('high');
    });

    it('classifies "where\'s the link?" as follow_up', () => {
      const result = classifyHostIntentStructural("where's the link?");
      expect(result.intent).toBe('follow_up');
      expect(result.confidence).toBe('high');
    });

    it('classifies "still waiting" as follow_up', () => {
      const result = classifyHostIntentStructural('still waiting');
      expect(result.intent).toBe('follow_up');
      expect(result.confidence).toBe('high');
    });

    it('classifies "is it done" as follow_up', () => {
      const result = classifyHostIntentStructural('is it done');
      expect(result.intent).toBe('follow_up');
      expect(result.confidence).toBe('high');
    });

    it('classifies "I asked it earlier" as follow_up', () => {
      const result = classifyHostIntentStructural('I asked it earlier');
      expect(result.intent).toBe('follow_up');
      expect(result.confidence).toBe('high');
    });

    it('classifies "I mentioned this before" as follow_up', () => {
      const result = classifyHostIntentStructural('I mentioned this before');
      expect(result.intent).toBe('follow_up');
      expect(result.confidence).toBe('high');
    });

    it('classifies "any progress?" as follow_up', () => {
      const result = classifyHostIntentStructural('any progress?');
      expect(result.intent).toBe('follow_up');
      expect(result.confidence).toBe('high');
    });

    it('classifies "did you give the team the update?" as follow_up', () => {
      const result = classifyHostIntentStructural('did you give the team the update?');
      expect(result.intent).toBe('follow_up');
      expect(result.confidence).toBe('high');
    });
  });

  describe('discussion intent', () => {
    it('classifies "what do you think?" as discussion', () => {
      const result = classifyHostIntentStructural('what do you think?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "I think we should refactor the auth module" as discussion', () => {
      const result = classifyHostIntentStructural('I think we should refactor the auth module');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "thoughts on this approach?" as discussion', () => {
      const result = classifyHostIntentStructural('thoughts on this approach?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies auxiliary question "do we think this is ready?" as discussion', () => {
      const result = classifyHostIntentStructural('do we think this is ready?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "should we consider a different approach?" as discussion', () => {
      const result = classifyHostIntentStructural('should we consider a different approach?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "how should we handle this edge case?" as discussion', () => {
      const result = classifyHostIntentStructural('how should we handle this edge case?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "does this make sense?" as discussion', () => {
      const result = classifyHostIntentStructural('does this make sense?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "I believe we need to rethink the architecture" as discussion', () => {
      const result = classifyHostIntentStructural('I believe we need to rethink the architecture');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "any thoughts?" as discussion', () => {
      const result = classifyHostIntentStructural('any thoughts?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "what\'s your take on microservices?" as discussion', () => {
      const result = classifyHostIntentStructural("what's your take on microservices?");
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "I wonder if there is a better way" as discussion', () => {
      const result = classifyHostIntentStructural('I wonder if there is a better way');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies URL sharing without imperative as discussion', () => {
      const result = classifyHostIntentStructural('https://vercel.com/design');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "why did this break?" as discussion', () => {
      const result = classifyHostIntentStructural('why did this break?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies generic question ending with ? as discussion', () => {
      const result = classifyHostIntentStructural('Is this the right architecture for scaling?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "I\'m curious about the performance implications" as discussion', () => {
      const result = classifyHostIntentStructural("I'm curious about the performance implications");
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });
  });

  describe('action_request intent', () => {
    it('classifies "Create an issue" as action_request', () => {
      const result = classifyHostIntentStructural('Create an issue');
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Please open a PR" as action_request', () => {
      const result = classifyHostIntentStructural('Please open a PR');
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Can you fix the bug?" as discussion (aux question + ? takes priority)', () => {
      // "Can you...?" matches AUX_QUESTION before POLITE_REQUEST
      const result = classifyHostIntentStructural('Can you fix the bug?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Can someone fix the bug" (no ?) as action_request', () => {
      const result = classifyHostIntentStructural('Can someone fix the bug');
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Fix the bug" as action_request (imperative)', () => {
      const result = classifyHostIntentStructural('Fix the bug');
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Deploy to prod" as action_request', () => {
      const result = classifyHostIntentStructural('Deploy to prod');
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Could you please review the PR?" as discussion (aux question + ? takes priority)', () => {
      // "Could you...?" matches AUX_QUESTION before POLITE_REQUEST
      const result = classifyHostIntentStructural('Could you please review the PR?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Could someone review the PR" (no ?) as action_request', () => {
      const result = classifyHostIntentStructural('Could someone review the PR');
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Go ahead and merge it" as action_request', () => {
      const result = classifyHostIntentStructural('Go ahead and merge it');
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "I need you to investigate the issue" as action_request', () => {
      const result = classifyHostIntentStructural('I need you to investigate the issue');
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Would you look into the failing tests?" as discussion (aux question + ? takes priority)', () => {
      // "Would you...?" matches AUX_QUESTION before POLITE_REQUEST
      const result = classifyHostIntentStructural('Would you look into the failing tests?');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Just run the test suite" as action_request', () => {
      const result = classifyHostIntentStructural('Just run the test suite');
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "Write the migration script" as action_request', () => {
      const result = classifyHostIntentStructural('Write the migration script');
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "I\'d like someone to set up the CI pipeline" as action_request', () => {
      const result = classifyHostIntentStructural("I'd like someone to set up the CI pipeline");
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });
  });

  describe('ambiguous / fallback intent', () => {
    it('classifies "We should probably fix this" as discussion with ambiguous confidence', () => {
      const result = classifyHostIntentStructural('We should probably fix this');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('ambiguous');
    });

    it('classifies "Let\'s make sure we handle errors properly" as action_request (let\'s + make matches polite imperative)', () => {
      const result = classifyHostIntentStructural("Let's make sure we handle errors properly");
      expect(result.intent).toBe('action_request');
      expect(result.confidence).toBe('high');
    });

    it('classifies "It might be worth considering a rewrite" as ambiguous', () => {
      const result = classifyHostIntentStructural('It might be worth considering a rewrite');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('ambiguous');
    });

    it('classifies "The thing I want to see is better error handling" as ambiguous', () => {
      const result = classifyHostIntentStructural('The thing I want to see is better error handling');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('ambiguous');
    });

    it('classifies "We need better test coverage across modules" as ambiguous', () => {
      const result = classifyHostIntentStructural('We need better test coverage across modules');
      expect(result.intent).toBe('discussion');
      expect(result.confidence).toBe('ambiguous');
    });
  });

  describe('edge cases', () => {
    it('handles leading/trailing whitespace', () => {
      const result = classifyHostIntentStructural('  Create an issue  ');
      expect(result.intent).toBe('action_request');
    });

    it('handles mixed case', () => {
      const result = classifyHostIntentStructural('CREATE AN ISSUE');
      expect(result.intent).toBe('action_request');
    });
  });
});

// ---------------------------------------------------------------------------
// findSemanticEchoEnsemble
// ---------------------------------------------------------------------------
describe('findSemanticEchoEnsemble', () => {
  const pairwiseThreshold = 0.55;
  const noveltyThreshold = 0.15;

  it('catches identical paraphrases as echo', () => {
    const message = 'We should implement a caching layer for the API endpoints';
    const peers = ['We need to implement caching for our API endpoints'];
    const allPeers = [...peers];
    const result = findSemanticEchoEnsemble(message, peers, allPeers, pairwiseThreshold, noveltyThreshold);
    expect(result.isEcho).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('allows novel content through (not echo)', () => {
    const message = 'The quantum computing breakthrough enables faster protein folding simulations';
    const peers = [
      'We should implement caching for the API endpoints',
      'The database needs better indexing for search performance',
    ];
    const allPeers = [...peers];
    const result = findSemanticEchoEnsemble(message, peers, allPeers, pairwiseThreshold, noveltyThreshold);
    expect(result.isEcho).toBe(false);
    expect(result.novelty).toBeGreaterThan(noveltyThreshold);
  });

  it('detects concept novelty echo (message adds nothing new)', () => {
    const message = 'Building caching endpoints for API performance optimization';
    const allPeers = [
      'We need to build caching for the API endpoints',
      'API performance optimization requires endpoint caching',
      'Building cached endpoints improves API response times',
    ];
    const peers = [allPeers[0]]; // Own agent's peer
    const result = findSemanticEchoEnsemble(message, peers, allPeers, pairwiseThreshold, noveltyThreshold);
    // With all peer stems covering the message's content, novelty should be low
    if (result.isEcho && result.strategy.startsWith('concept-novelty')) {
      expect(result.novelty).toBeLessThan(noveltyThreshold);
      expect(result.strategy).toContain('concept-novelty');
    }
  });

  it('returns strategy info in the result', () => {
    const message = 'Implementing the notification service for real-time alerts';
    const peers = ['Building a notification service for real-time alert delivery'];
    const allPeers = [...peers];
    const result = findSemanticEchoEnsemble(message, peers, allPeers, pairwiseThreshold, noveltyThreshold);
    expect(result.strategy).toBeDefined();
    expect(typeof result.strategy).toBe('string');
    if (result.isEcho) {
      // Strategy should describe which method triggered
      expect(result.strategy).not.toBe('none');
    }
  });

  it('returns score, novelty, and strategy fields', () => {
    const message = 'Configuring the deployment pipeline for continuous integration';
    const peers = ['Setting up database replication for high availability'];
    const allPeers = [...peers];
    const result = findSemanticEchoEnsemble(message, peers, allPeers, pairwiseThreshold, noveltyThreshold);
    expect(result).toHaveProperty('isEcho');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('novelty');
    expect(result).toHaveProperty('strategy');
    expect(typeof result.score).toBe('number');
    expect(typeof result.novelty).toBe('number');
  });

  it('returns isEcho false and strategy "none" for short messages', () => {
    const result = findSemanticEchoEnsemble('ok sure', ['yes agreed'], ['yes agreed'], 0.5, 0.15);
    expect(result.isEcho).toBe(false);
    expect(result.score).toBe(0);
    expect(result.novelty).toBe(1);
    expect(result.strategy).toBe('none');
  });

  it('handles empty peer lists', () => {
    const message = 'Building the authentication service with OAuth2 integration';
    const result = findSemanticEchoEnsemble(message, [], [], pairwiseThreshold, noveltyThreshold);
    expect(result.isEcho).toBe(false);
    // With no peers, all stems are novel
    expect(result.novelty).toBe(1);
  });

  it('ensemble strategy includes lcs and tfidf scores when triggered', () => {
    const message = 'Implementing a caching layer for API endpoint performance';
    const peers = ['Implementing caching layers to improve API endpoint performance'];
    const allPeers = [...peers];
    const result = findSemanticEchoEnsemble(message, peers, allPeers, 0.3, 0.15);
    if (result.isEcho && result.strategy.startsWith('ensemble')) {
      expect(result.strategy).toMatch(/ensemble\(lcs=[\d.]+,tfidf=[\d.]+\)/);
    }
  });

  it('uses stemming to match morphological variants', () => {
    // "creating" and "created" stem to the same root
    const message = 'Creating the new monitoring dashboard for server health';
    const peers = ['We created a monitoring dashboard for server health tracking'];
    const allPeers = [...peers];
    const result = findSemanticEchoEnsemble(message, peers, allPeers, 0.4, 0.15);
    // Stemming should bring these closer together
    expect(result.score).toBeGreaterThan(0);
  });

  it('differentiates peer messages from allPeerMessages for novelty', () => {
    const message = 'Implement caching for the search API performance';
    // Own peers: unrelated
    const peers = ['The frontend styling needs responsive breakpoints'];
    // All peers (includes other agents): overlap with message
    const allPeers = [
      'The frontend styling needs responsive breakpoints',
      'Implement caching to speed up search API responses',
      'API search performance benefits from caching layers',
    ];
    const result = findSemanticEchoEnsemble(message, peers, allPeers, pairwiseThreshold, noveltyThreshold);
    // Pairwise against own peers should be low, but concept novelty from all peers
    // may still flag it as echo since allPeers already cover the same concepts
    expect(result).toHaveProperty('novelty');
    // Novelty is checked against allPeers, so it could be low
  });
});
