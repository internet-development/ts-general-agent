//NOTE(self): Layer 2 of two-layer intent classification system
//NOTE(self): Handles the ~20% of host messages that are structurally ambiguous
//NOTE(self): LLM call with ~50 output tokens, cached per message content
//NOTE(self): Default to discussion on any failure — safer to allow conversation than block it

import { chat } from '@modules/llm-gateway.js';
import { classifyHostIntentStructural, type HostIntent } from '@common/strings.js';
import { logger } from '@modules/logger.js';
import { ui } from '@modules/ui.js';

//NOTE(self): Cache classifications per host message content to avoid redundant LLM calls.
//NOTE(self): Each message is classified exactly once. Cache cleared when conversation resets.
const intentCache = new Map<string, HostIntent>();

export function clearIntentCache(): void {
  intentCache.clear();
}

export function getCachedIntent(content: string): HostIntent | undefined {
  return intentCache.get(content);
}

/**
 * Classify a host message's intent. Uses structural pre-filter for obvious cases,
 * falls back to LLM for ambiguous messages. Results are cached.
 */
export async function classifyHostMessage(content: string): Promise<HostIntent> {
  // Check cache first
  const cached = intentCache.get(content);
  if (cached) return cached;

  // Layer 1: structural pre-filter
  const structural = classifyHostIntentStructural(content);
  if (structural.confidence === 'high') {
    intentCache.set(content, structural.intent);
    logger.info('[intent] Structural classification', {
      intent: structural.intent,
      message: content.slice(0, 100),
    });
    return structural.intent;
  }

  // Layer 2: LLM classification for ambiguous cases
  try {
    const response = await chat({
      system: `Classify the chat message into exactly one category. Reply with ONLY the category name, nothing else.

Categories:
- ACTION_REQUEST: The speaker is commanding or requesting someone to DO concrete work. Imperative structure ("Create X"), polite request ("Can you fix Y?"), direct ask ("I need you to build Z"). The key test: would fulfilling this require creating/modifying something tangible?
- DISCUSSION: The speaker is asking for opinions, sharing information, asking questions about understanding, making conversation, expressing thoughts, or sharing links for review. NOT asking anyone to create/build/fix/deploy anything.
- FOLLOW_UP: The speaker is checking status of a previously requested action. "Did you do it?", "Where's the link?", "Any update?", "Still waiting."

Examples:
- "Create an issue for the prod checklist" → ACTION_REQUEST
- "Do we think we have mastered the guidelines?" → DISCUSSION
- "Can you open a PR for this?" → ACTION_REQUEST
- "What do you think about this approach?" → DISCUSSION
- "Does this make sense?" → DISCUSSION
- "I think I deserve a response here" → DISCUSSION
- "Let's make sure we handle errors" → DISCUSSION
- "We should probably update the docs" → DISCUSSION
- "Handle the edge cases in auth" → ACTION_REQUEST
- "Check out this design: https://..." → DISCUSSION
- "Did you create that issue?" → FOLLOW_UP
- "Where's the link?" → FOLLOW_UP
- "Can you share your thoughts on this?" → DISCUSSION
- "Share the deployment config with the team" → ACTION_REQUEST`,
      messages: [{ role: 'user', content: `Message: "${content}"` }],
      maxTokens: 10,
      temperature: 0,
    });

    const text = response.trim().toUpperCase();
    let intent: HostIntent = 'discussion'; // default fallback
    if (text.includes('ACTION_REQUEST')) intent = 'action_request';
    else if (text.includes('FOLLOW_UP')) intent = 'follow_up';
    else if (text.includes('DISCUSSION')) intent = 'discussion';

    intentCache.set(content, intent);
    logger.info('[intent] LLM classification (ambiguous case)', {
      intent,
      message: content.slice(0, 100),
      llmResponse: text,
    });
    ui.info('[space] Intent classified via LLM', `${intent}: "${content.slice(0, 60)}"`);
    return intent;
  } catch (err) {
    // On LLM failure, default to discussion (safer — allows conversation)
    logger.warn('[intent] LLM classification failed, defaulting to discussion', {
      error: String(err),
      message: content.slice(0, 100),
    });
    const fallback: HostIntent = 'discussion';
    intentCache.set(content, fallback);
    return fallback;
  }
}

/**
 * Classify all host messages in a conversation. Parallel-safe, cached.
 */
export async function classifyHostMessages(
  messages: Array<{ name: string; content: string; timestamp: string }>
): Promise<Array<{ name: string; content: string; timestamp: string; intent: HostIntent }>> {
  const results = await Promise.all(
    messages.map(async (m) => ({
      ...m,
      intent: await classifyHostMessage(m.content),
    }))
  );
  return results;
}
