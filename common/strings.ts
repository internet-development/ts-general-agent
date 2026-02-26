//NOTE(self): Shared string utilities used across the codebase
//NOTE(self): createSlug for URL/branch-safe identifiers, isEmpty for robust empty checks
//NOTE(self): truncateGraphemes for portable text truncation (Bluesky + Are.na share 300 grapheme limit)

import { graphemeLen } from '@atproto/common-web';

export const PORTABLE_MAX_GRAPHEMES = 300;

export function isEmpty(text: any): boolean {
  // NOTE(jimmylee):
  // If a number gets passed in, it isn't considered empty for zero.
  if (text === 0) {
    return false;
  }

  if (!text) {
    return true;
  }

  if (typeof text === 'object') {
    return true;
  }

  if (text.length === 0) {
    return true;
  }

  text = text.toString();

  return Boolean(!text.trim());
}

export function createSlug(text: any): string {
  if (isEmpty(text)) {
    return 'untitled';
  }

  const a = 'æøåàáäâèéëêìíïîòóöôùúüûñçßÿœæŕśńṕẃǵǹḿǘẍźḧ·/_,:;';
  const b = 'aoaaaaaeeeeiiiioooouuuuncsyoarsnpwgnmuxzh------';
  const p = new RegExp(a.split('').join('|'), 'g');

  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(p, (c: string) => b.charAt(a.indexOf(c)))
    .replace(/&/g, '-and-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

//NOTE(self): Ensure a URL has a protocol prefix so Bluesky creates a clickable link facet
//NOTE(self): Bare "github.com/..." becomes "https://github.com/..." — use this when building post text
export function ensureHttps(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

//NOTE(self): Normalize post text for dedup comparison
//NOTE(self): Strips @mentions, URLs, lowercases, collapses whitespace, takes first 200 chars
//NOTE(self): Used by outbound queue (pre-send) and dupe cleanup (post-send)
//NOTE(self): 200 chars is generous for Bluesky's 300-grapheme limit after stripping mentions/URLs
export function normalizePostText(text: string): string {
  return text
    .toLowerCase()
    .replace(/@[\w.-]+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(?:[\w-]+\.)+[\w]{2,}\/\S*/g, '') //NOTE(self): bare domain URLs like github.com/...
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

//NOTE(self): Truncate text to a grapheme limit, preserving whole grapheme clusters
//NOTE(self): Used wherever text may flow to Bluesky (300 grapheme limit) or similar services
export function truncateGraphemes(text: string, maxGraphemes: number = PORTABLE_MAX_GRAPHEMES): string {
  if (graphemeLen(text) <= maxGraphemes) return text;

  //NOTE(self): Binary search for the right cut point since grapheme clusters can be multi-byte
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (graphemeLen(text.slice(0, mid)) <= maxGraphemes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo);
}

//NOTE(self): Longest Common Subsequence length — classic O(m*n) dynamic programming
//NOTE(self): Uses bottom-up tabulation with space optimization (two rows instead of full matrix)
//NOTE(self): This is the foundational algorithm for semantic echo detection
function lcsLength(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  //NOTE(self): Space-optimized DP — only keep previous and current rows
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    //NOTE(self): Swap rows — avoids allocation per iteration
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return prev[n];
}

//NOTE(self): Tokenize text into normalized words for semantic comparison
//NOTE(self): Strips punctuation, lowercases, filters stopwords that add no semantic value
function tokenizeForComparison(text: string): string[] {
  const stopwords = new Set([
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'the', 'a', 'an', 'is', 'are', 'was',
    'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'that', 'this', 'it', 'its',
    'and', 'but', 'or', 'so', 'if', 'then', 'than', 'too', 'very', 'just', 'also',
    'not', 'no', 'nor', 'only', 'same', 'such', 'more', 'most', 'other', 'some', 'any',
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopwords.has(w));
}

//NOTE(self): Semantic similarity ratio using word-level LCS
//NOTE(self): Returns 0.0 (no overlap) to 1.0 (identical content)
//NOTE(self): The ratio is 2 * LCS_length / (len_a + len_b) — Dice coefficient on LCS
//NOTE(self): Kept for backward compatibility — new code should use findSemanticEchoEnsemble
export function semanticSimilarity(textA: string, textB: string): number {
  const tokensA = tokenizeForComparison(textA);
  const tokensB = tokenizeForComparison(textB);

  //NOTE(self): Guard against trivially short messages — not enough signal for semantic comparison
  if (tokensA.length < 3 || tokensB.length < 3) return 0;

  const lcs = lcsLength(tokensA, tokensB);
  //NOTE(self): Dice coefficient — symmetric measure that handles different-length texts well
  return (2 * lcs) / (tokensA.length + tokensB.length);
}

//NOTE(self): Check if a message is semantically similar to ANY message in a set
//NOTE(self): Kept for backward compatibility — new code should use findSemanticEchoEnsemble
export function findSemanticEcho(
  message: string,
  peerMessages: string[],
  threshold: number
): { isEcho: boolean; score: number; matchedMessage?: string } {
  let maxScore = 0;
  let matchedMessage: string | undefined;

  for (const peer of peerMessages) {
    const score = semanticSimilarity(message, peer);
    if (score > maxScore) {
      maxScore = score;
      matchedMessage = peer;
    }
    //NOTE(self): Early exit — no need to check remaining once we've confirmed echo
    if (score >= threshold) {
      return { isEcho: true, score, matchedMessage: peer };
    }
  }

  return { isEcho: maxScore >= threshold, score: maxScore, matchedMessage };
}

// ─── Host Intent Classification (Structural Pre-Filter) ─────────────────────
//NOTE(self): Layer 1 of two-layer intent classification system
//NOTE(self): Catches ~80% of cases instantly via sentence structure analysis
//NOTE(self): Ambiguous cases fall through to Layer 2 (LLM classification in intent-cache.ts)
//NOTE(self): Key insight: "Do we think..." is auxiliary-do + subject + question = discussion,
//NOTE(self): NOT imperative "do" = action. Regex verb-matching can't distinguish these.

export type HostIntent = 'action_request' | 'discussion' | 'follow_up';
export type ClassificationConfidence = 'high' | 'ambiguous';

export function classifyHostIntentStructural(
  message: string
): { intent: HostIntent; confidence: ClassificationConfidence } {
  const trimmed = message.trim();

  // ============================================================
  // FOLLOW-UP (highest priority — status checks on prior actions)
  // ============================================================
  const FOLLOW_UP = /\b(did you (give|create|open|make|post|send|share|provide|do|fix|handle|finish|complete|build|write|draft|submit|deploy|push|merge|close|run|start|launch|implement|configure|install|set up|work on)|where('s| is| are) the (issue|link|plan|pr|pull request|result|update|output|draft|post|comment|branch|deploy|build)|still waiting|any (update|progress|news|word)|I (said|asked|mentioned|requested|told you) (it |this |that )?(earlier|before|already|previously)|give me the|provide .*(link|issue|url|pr)|what happened (to|with)|is it done|is that done|have you (done|finished|created|opened|posted|sent|built|written|deployed|pushed|merged|submitted|filed|started)|status( update)?|ETA|how('s| is) (it|that|the) (going|coming|progressing)|where are we (on|with)|update me|any luck|did (it|that) (get|happen)|were you able)\b/i;
  if (FOLLOW_UP.test(trimmed)) return { intent: 'follow_up', confidence: 'high' };

  // ============================================================
  // DISCUSSION — structural question patterns (before action!)
  // ============================================================

  // Auxiliary verb + subject + ? = question, not command
  // "Do we think...", "Does this make sense?", "Have you all seen...?"
  // "Are we ready?", "Is this the right approach?", "Should we consider...?"
  // "Would it make sense to...?", "Could this be better?"
  const AUX_QUESTION = /^(do|does|did|have|has|are|is|was|were|should|would|could|can|might|shall)\s+(we|you|they|people|everyone|each|anyone|all|the\s|this|that|it|these|those|our|my|there|somebody|one|folks|y'all|you all|team)\b/i;
  if (AUX_QUESTION.test(trimmed) && /\?/.test(trimmed))
    return { intent: 'discussion', confidence: 'high' };

  // Wh-questions: "What do you think?", "How should we approach?", "Why did this break?"
  const WH_QUESTION = /^(what|how|why|where|who|which|when)\s+(do|does|did|are|is|was|should|would|could|can|will|might|have|has|about|if)\b/i;
  if (WH_QUESTION.test(trimmed))
    return { intent: 'discussion', confidence: 'high' };

  // "What's your take?", "What's everyone think?"
  const WH_CONTRACTION = /^(what's|how's|who's|where's|why's|when's)\s+(your|everyone|the|this|that)\b/i;
  if (WH_CONTRACTION.test(trimmed))
    return { intent: 'discussion', confidence: 'high' };

  // Thought/opinion-seeking: "thoughts on...?", "opinions about...?", "any ideas?"
  const THOUGHT_SEEKING = /\b(thoughts|opinions?|perspectives?|take|ideas?|feelings?|views?|input|feedback|reactions?|impressions?)\s+(on|about|regarding|around|for)\b/i;
  if (THOUGHT_SEEKING.test(trimmed) && /\?/.test(trimmed))
    return { intent: 'discussion', confidence: 'high' };

  // "Any thoughts?", "What's your take?"
  const ANY_THOUGHTS = /\b(any (thoughts|ideas|opinions|input|feedback|questions|concerns|objections|suggestions|recommendations))\b/i;
  if (ANY_THOUGHTS.test(trimmed) && /\?/.test(trimmed))
    return { intent: 'discussion', confidence: 'high' };

  // State/knowledge questions: "Have you mastered?", "Have each of you read?", "Are you familiar with?"
  const STATE_QUESTION = /^have\s+(you|each|all|everyone|y'all)\b.*\?$/i;
  if (STATE_QUESTION.test(trimmed))
    return { intent: 'discussion', confidence: 'high' };

  // Idiomatic non-action: "make sense", "ring a bell", "sound right"
  const IDIOMATIC = /\b(make(s)? sense|ring(s)? a bell|sound(s)? (right|good|okay|fair|reasonable)|look(s)? (right|good|correct|okay)|seem(s)? (right|correct|off|wrong|reasonable)|feel(s)? (right|off|weird|wrong)|think (so|not)|know what I mean|see what I mean|get what I'm saying|follow( me)?|with me( so far)?|on the same page|agree or disagree|fair to say|safe to say|worth (it|doing|considering|exploring)|matter|make of (this|that|it))\b/i;
  if (IDIOMATIC.test(trimmed) && /\?/.test(trimmed))
    return { intent: 'discussion', confidence: 'high' };

  // "I think..." / "I feel..." / "I believe..." = host sharing opinion, inviting discussion
  const OPINION_SHARING = /^(I think|I feel|I believe|I wonder|I'm (curious|wondering|thinking)|I suspect|in my (view|opinion|experience)|my (thought|take|sense|feeling) is|honestly|to be honest|IMO|IMHO)\b/i;
  if (OPINION_SHARING.test(trimmed))
    return { intent: 'discussion', confidence: 'high' };

  // Questions ending with "?" that DON'T start with an action verb
  // Broad catch: any sentence that's clearly a question (ends with ?) and doesn't start with a command
  const ACTION_VERB_START = /^(create|open|make|post|file|write|build|draft|submit|give|provide|show|send|share|fix|handle|address|deploy|update|add|remove|delete|close|merge|push|implement|configure|install|run|start|launch|check|review|test|investigate|resolve|set\s+up|work\s+on|look\s+into|go\s+ahead|take\s+care|get\s+on)\b/i;
  if (/\?\s*$/.test(trimmed) && !ACTION_VERB_START.test(trimmed))
    return { intent: 'discussion', confidence: 'high' };

  // URL sharing without imperative = informational/discussion
  // "Check this out: https://..." is ambiguous, but "https://vercel.com/design" alone is discussion
  if (/https?:\/\//.test(trimmed) && !ACTION_VERB_START.test(trimmed))
    return { intent: 'discussion', confidence: 'high' };

  // ============================================================
  // ACTION REQUEST — imperative structure (must be clearly a command)
  // ============================================================

  // Verb-first imperative: "Create an issue", "Fix the bug", "Deploy to prod"
  if (ACTION_VERB_START.test(trimmed))
    return { intent: 'action_request', confidence: 'high' };

  // "Please [verb]", "Go ahead and [verb]", "Just [verb]"
  const POLITE_IMPERATIVE = /^(please|go ahead( and)?|just|let's|okay,?\s*)\s+(create|open|make|post|file|write|build|draft|submit|give|provide|show|send|share|fix|handle|deploy|update|add|remove|delete|close|merge|push|implement|configure|install|run|start|launch|check|review|test|investigate|resolve|set\s+up|work\s+on|look\s+into)\b/i;
  if (POLITE_IMPERATIVE.test(trimmed))
    return { intent: 'action_request', confidence: 'high' };

  // Polite request: "Can you/someone create X?", "Could one of you open X?"
  const POLITE_REQUEST = /^(can|could|would)\s+(you|someone|one of you|anybody|an agent|one of the agents|somebody)\s+(please\s+)?(create|open|make|post|file|write|build|draft|submit|give|provide|show|send|share|fix|handle|deploy|update|add|remove|delete|close|merge|push|implement|configure|install|run|start|launch|check|review|test|investigate|resolve|set\s+up|work\s+on|look\s+into)\b/i;
  if (POLITE_REQUEST.test(trimmed))
    return { intent: 'action_request', confidence: 'high' };

  // Direct request: "I need you to [verb]", "I want someone to [verb]"
  const DIRECT_REQUEST = /\b(I need|I want|I'd like|I require)\s+(you|someone|one of you|an agent|somebody)\s+to\s+(create|open|make|post|file|write|build|draft|submit|give|provide|show|send|share|fix|handle|deploy|update|add|remove|delete|close|merge|push|implement|configure|install|run|start|launch|check|review|test|investigate|resolve|set\s+up|work\s+on|look\s+into)\b/i;
  if (DIRECT_REQUEST.test(trimmed))
    return { intent: 'action_request', confidence: 'high' };

  // ============================================================
  // AMBIGUOUS — needs LLM classification
  // ============================================================
  // Examples that reach here:
  // - "Let's make sure we handle errors properly" (discussion or action?)
  // - "We should probably run some tests" (suggestion or command?)
  // - "Handle the edge cases" (imperative but not starting with verb if prefixed)
  // - "The thing I want to see is better error handling" (wish, not command)
  return { intent: 'discussion', confidence: 'ambiguous' };
}

// ─── Multi-Strategy Ensemble Echo Detection ─────────────────────────────────
//NOTE(self): The single-algorithm LCS approach misses ~5% of semantic echoes —
//NOTE(self): content that uses different word forms or weights conversation-common words equally.
//NOTE(self): The ensemble combines three strategies:
//NOTE(self):   1. LCS Dice on stemmed tokens — catches morphological variants (creating/created/create)
//NOTE(self):   2. TF-IDF cosine similarity — weights rare conversation words higher than common ones
//NOTE(self):   3. Concept novelty — rejects messages that add <15% new stems to the conversation pool
//NOTE(self): Each strategy catches a class of echo the others miss.

//NOTE(self): Simplified Porter stemmer — iterative suffix stripping
//NOTE(self): Handles the most impactful English morphological variants:
//NOTE(self):   -s/-es (plural), -ed (past), -ing (gerund), -ly (adverb),
//NOTE(self):   -ment/-ness/-tion/-sion (nominalization), -ful/-ous/-ive/-able/-ible (adjective)
//NOTE(self): Iterates up to 3 rounds to handle stacked suffixes (e.g., "improvements" → -s → -ment → -e → "improv")
//NOTE(self): Final pass strips trailing 'e' for consistency ("create"→"creat", "improve"→"improv")
function simpleStem(word: string): string {
  if (word.length < 4) return word;
  let stem = word;
  let prevStem = '';

  for (let round = 0; round < 3 && stem !== prevStem; round++) {
    prevStem = stem;

    //NOTE(self): Order: longest suffixes first to prevent partial matches
    if (stem.endsWith('tion') && stem.length > 6) {
      stem = stem.slice(0, -4);
    } else if (stem.endsWith('sion') && stem.length > 6) {
      stem = stem.slice(0, -4);
    } else if (stem.endsWith('ment') && stem.length > 6) {
      stem = stem.slice(0, -4);
    } else if (stem.endsWith('ness') && stem.length > 6) {
      stem = stem.slice(0, -4);
    } else if (stem.endsWith('able') && stem.length > 6) {
      stem = stem.slice(0, -4);
    } else if (stem.endsWith('ible') && stem.length > 6) {
      stem = stem.slice(0, -4);
    } else if (stem.endsWith('ful') && stem.length > 5) {
      stem = stem.slice(0, -3);
    } else if (stem.endsWith('ous') && stem.length > 5) {
      stem = stem.slice(0, -3);
    } else if (stem.endsWith('ive') && stem.length > 5) {
      stem = stem.slice(0, -3);
    } else if (stem.endsWith('ing') && stem.length > 5) {
      stem = stem.slice(0, -3);
      //NOTE(self): Handle consonant doubling: "hopping" → "hopp" → "hop"
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] && !'lsz'.includes(stem[stem.length - 1])) {
        stem = stem.slice(0, -1);
      }
    } else if (stem.endsWith('ed') && stem.length > 4) {
      stem = stem.slice(0, -2);
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] && !'lsz'.includes(stem[stem.length - 1])) {
        stem = stem.slice(0, -1);
      }
    } else if (stem.endsWith('ly') && stem.length > 4) {
      stem = stem.slice(0, -2);
    } else if (stem.endsWith('ies') && stem.length > 4) {
      stem = stem.slice(0, -3) + 'i';
    } else if (stem.endsWith('es') && stem.length > 4) {
      stem = stem.slice(0, -2);
    } else if (stem.endsWith('s') && !stem.endsWith('ss') && !stem.endsWith('us') && !stem.endsWith('is') && stem.length > 3) {
      stem = stem.slice(0, -1);
    }
  }

  //NOTE(self): Final trailing 'e' strip for consistency: "create"→"creat", "improve"→"improv"
  //NOTE(self): This ensures verb/noun pairs converge: "create"/"created"/"creating" all → "creat"
  if (stem.endsWith('e') && stem.length > 3) {
    stem = stem.slice(0, -1);
  }

  return stem;
}

//NOTE(self): Tokenize + stem — produces normalized word stems for semantic comparison
//NOTE(self): Reuses tokenizeForComparison (stopwords, lowercase, punctuation strip) then stems each word
function tokenizeWithStemming(text: string): string[] {
  return tokenizeForComparison(text).map(w => simpleStem(w));
}

//NOTE(self): Compute Inverse Document Frequency from a corpus of tokenized documents
//NOTE(self): Uses smoothed IDF: log((N+1)/(df+1)) + 1 — prevents zero weight for ubiquitous terms
//NOTE(self): Standard scikit-learn formulation adapted for small corpora (10-20 short messages)
function computeIDF(corpus: string[][]): Map<string, number> {
  const N = corpus.length;
  const df: Map<string, number> = new Map();

  for (const doc of corpus) {
    const seen = new Set(doc);
    for (const term of seen) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  const idf: Map<string, number> = new Map();
  for (const [term, docFreq] of df) {
    idf.set(term, Math.log((N + 1) / (docFreq + 1)) + 1);
  }

  return idf;
}

//NOTE(self): Build TF-IDF vector using binary term frequency (1 if present, 0 if not)
//NOTE(self): Binary TF is standard for short texts where word repetition is rare
function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const vec: Map<string, number> = new Map();
  const seen = new Set(tokens);

  for (const token of seen) {
    //NOTE(self): Default IDF for unseen terms — treat as moderately rare
    vec.set(token, idf.get(token) || (Math.log(2) + 1));
  }

  return vec;
}

//NOTE(self): Cosine similarity between two sparse TF-IDF vectors
//NOTE(self): cos(A,B) = dot(A,B) / (||A|| * ||B||)
//NOTE(self): O(|vocab|) — trivial for short message vectors (~20 terms)
function cosineSimilarity(vecA: Map<string, number>, vecB: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, weightA] of vecA) {
    normA += weightA * weightA;
    const weightB = vecB.get(term);
    if (weightB !== undefined) {
      dotProduct += weightA * weightB;
    }
  }

  for (const [, weightB] of vecB) {
    normB += weightB * weightB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

//NOTE(self): Concept novelty — what fraction of the candidate's stems are NOT in the conversation pool
//NOTE(self): Returns 0.0 (nothing new) to 1.0 (everything new)
//NOTE(self): Below CONCEPT_NOVELTY_THRESHOLD (0.15), the message adds too little new content
function conceptNovelty(candidateTokens: string[], conversationPool: Set<string>): number {
  if (candidateTokens.length === 0) return 1;

  let newCount = 0;
  for (const token of candidateTokens) {
    if (!conversationPool.has(token)) {
      newCount++;
    }
  }

  return newCount / candidateTokens.length;
}

export interface EnsembleEchoResult {
  isEcho: boolean;
  score: number;
  novelty: number;
  matchedMessage?: string;
  //NOTE(self): Which strategy triggered the rejection — useful for debugging and tuning
  //NOTE(self): Examples: "ensemble(lcs=0.35,tfidf=0.58)", "concept-novelty", "none"
  strategy: string;
}

//NOTE(self): Multi-strategy ensemble semantic echo detection
//NOTE(self): Replaces single-algorithm LCS with three complementary strategies:
//NOTE(self):
//NOTE(self): Strategy 1 — Pairwise ensemble (LCS Dice + TF-IDF Cosine):
//NOTE(self):   Weighted combination: 0.4 * lcsDice + 0.6 * tfidfCosine
//NOTE(self):   LCS catches structural paraphrasing (same words reordered)
//NOTE(self):   TF-IDF catches topical similarity (conversation-rare words weighted higher)
//NOTE(self):   Stemming on both: "creating"/"created"/"create" all converge → "creat"
//NOTE(self):
//NOTE(self): Strategy 2 — Concept novelty:
//NOTE(self):   Pools all stemmed content words from peer messages
//NOTE(self):   Checks what fraction of the candidate's stems are genuinely new
//NOTE(self):   Rejects when <15% new content — the message adds nothing to the conversation
//NOTE(self):   This catches the case where every individual comparison scores low but the
//NOTE(self):   message is still redundant because the CONVERSATION has already covered it all
//NOTE(self):
//NOTE(self): Performance: O(|peers| * max(m*n, |vocab|)) where m,n ~20 words
//NOTE(self): For 10 peers of 20 words: ~6000 operations total — negligible
export function findSemanticEchoEnsemble(
  message: string,
  peerMessages: string[],
  allPeerMessages: string[],
  pairwiseThreshold: number,
  noveltyThreshold: number
): EnsembleEchoResult {
  //NOTE(self): Stem everything once — amortize tokenization cost across all comparisons
  const candidateStemmed = tokenizeWithStemming(message);
  if (candidateStemmed.length < 3) {
    return { isEcho: false, score: 0, novelty: 1, strategy: 'none' };
  }

  const peerStemmedSets = peerMessages.map(m => tokenizeWithStemming(m));
  const allPeerStemmedSets = allPeerMessages.map(m => tokenizeWithStemming(m));

  //NOTE(self): Strategy 2 — Concept novelty check (conversation-level)
  //NOTE(self): Build pool from ALL peer messages (not own) to answer:
  //NOTE(self): "Does this message introduce any stems peers haven't used?"
  const peerStemPool = new Set<string>();
  for (const tokens of allPeerStemmedSets) {
    for (const t of tokens) {
      peerStemPool.add(t);
    }
  }

  const novelty = conceptNovelty(candidateStemmed, peerStemPool);
  if (novelty < noveltyThreshold) {
    return {
      isEcho: true,
      score: 1 - novelty,
      novelty,
      strategy: `concept-novelty(${(novelty * 100).toFixed(0)}% new)`,
    };
  }

  //NOTE(self): Strategy 1 — Pairwise ensemble (LCS + TF-IDF)
  //NOTE(self): Compute IDF once from all peer messages — gives conversation-specific word weights
  const corpus = [candidateStemmed, ...allPeerStemmedSets];
  const idf = computeIDF(corpus);
  const candidateTfIdf = tfidfVector(candidateStemmed, idf);

  let maxScore = 0;
  let matchedMessage: string | undefined;
  let bestLcs = 0;
  let bestTfidf = 0;

  for (let i = 0; i < peerMessages.length; i++) {
    const peerTokens = peerStemmedSets[i];
    if (peerTokens.length < 3) continue;

    //NOTE(self): LCS Dice on stemmed tokens — catches "creating the endpoint" vs "created an endpoint"
    const lcs = lcsLength(candidateStemmed, peerTokens);
    const lcsDice = (2 * lcs) / (candidateStemmed.length + peerTokens.length);

    //NOTE(self): TF-IDF cosine — weights conversation-specific words higher
    //NOTE(self): "caching" in a design conversation gets high weight; "think" gets low weight
    const peerTfIdf = tfidfVector(peerTokens, idf);
    const cosine = cosineSimilarity(candidateTfIdf, peerTfIdf);

    //NOTE(self): Weighted ensemble: TF-IDF gets 60% weight because the gap we're closing
    //NOTE(self): is specifically "same topic, different framing" which is TF-IDF's strength
    const score = 0.4 * lcsDice + 0.6 * cosine;

    if (score > maxScore) {
      maxScore = score;
      matchedMessage = peerMessages[i];
      bestLcs = lcsDice;
      bestTfidf = cosine;
    }

    if (score >= pairwiseThreshold) {
      return {
        isEcho: true,
        score,
        novelty,
        matchedMessage: peerMessages[i],
        strategy: `ensemble(lcs=${lcsDice.toFixed(2)},tfidf=${cosine.toFixed(2)})`,
      };
    }
  }

  return {
    isEcho: maxScore >= pairwiseThreshold,
    score: maxScore,
    novelty,
    matchedMessage,
    strategy: maxScore >= pairwiseThreshold
      ? `ensemble(lcs=${bestLcs.toFixed(2)},tfidf=${bestTfidf.toFixed(2)})`
      : 'none',
  };
}
