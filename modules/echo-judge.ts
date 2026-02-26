//NOTE(self): LLM-as-Judge Echo Detection Module
//NOTE(self): Catches the ~3% of semantic echoes that the ensemble misses
//NOTE(self): (synonym-level paraphrasing with zero surface token overlap).
//NOTE(self): Only called for borderline ensemble scores (0.35-0.52) to minimize token cost.
//NOTE(self): Uses the fastest available model with ~100-150 tokens per check.

import { chat } from '@modules/llm-gateway.js';
import { logger } from '@modules/logger.js';

//NOTE(self): Cache to avoid re-judging the same candidate + peer set
//NOTE(self): Key: hash of candidate + sorted peer messages. Cleared when conversation resets.
const echoJudgeCache = new Map<string, boolean>();

export function clearEchoJudgeCache(): void {
  echoJudgeCache.clear();
}

//NOTE(self): Simple hash for cache key — fast, not cryptographic
function quickHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
}

//NOTE(self): Ask the LLM whether a candidate message is expressing the same point
//NOTE(self): as any of the peer messages. Returns true if it IS an echo (should be blocked).
//NOTE(self): This is the heavyweight check — only called for borderline ensemble scores.
//NOTE(self):
//NOTE(self): Algorithm design rationale:
//NOTE(self): - Temperature 0 for deterministic classification
//NOTE(self): - Max 10 tokens — we only need YES or NO
//NOTE(self): - Peer messages are presented as a numbered list for clear reference
//NOTE(self): - System prompt is minimal to keep context window small
//NOTE(self): - On failure, returns false (don't block) — fail-open is safer than fail-closed
export async function isEchoByLLMJudge(
  candidate: string,
  peerMessages: string[]
): Promise<boolean> {
  if (peerMessages.length === 0) return false;

  //NOTE(self): Check cache first
  const cacheKey = quickHash(candidate + '||' + peerMessages.sort().join('||'));
  const cached = echoJudgeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const peerList = peerMessages
      .slice(0, 10) //NOTE(self): Cap at 10 peers to control token cost
      .map((m, i) => `${i + 1}. "${m}"`)
      .join('\n');

    const response = await chat({
      system: 'You detect semantic echoes in conversation. Reply ONLY "YES" or "NO". YES means the candidate expresses the same conclusion or point as one of the existing messages, even using completely different words. NO means the candidate adds a genuinely distinct perspective or information.',
      messages: [{
        role: 'user',
        content: `Candidate: "${candidate}"\n\nExisting messages:\n${peerList}\n\nDoes the candidate express the same point as any existing message?`,
      }],
      maxTokens: 10,
      temperature: 0,
    });

    const answer = response.trim().toUpperCase();
    const isEcho = answer.startsWith('YES');

    //NOTE(self): Cache the result
    echoJudgeCache.set(cacheKey, isEcho);

    logger.info('[echo-judge] LLM classification', {
      isEcho,
      llmResponse: answer,
      candidate: candidate.slice(0, 80),
      peerCount: peerMessages.length,
    });

    return isEcho;
  } catch (err) {
    //NOTE(self): Fail-open — on LLM failure, don't block the message
    //NOTE(self): The ensemble already passed it, so it's borderline at worst
    logger.warn('[echo-judge] LLM call failed, allowing message', {
      error: String(err),
      candidate: candidate.slice(0, 80),
    });
    return false;
  }
}
