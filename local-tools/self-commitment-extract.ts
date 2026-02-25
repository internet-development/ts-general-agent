//NOTE(self): Commitment Extraction Module
//NOTE(self): After replying on Bluesky, extract any promises I made.
//NOTE(self): Single focused LLM call, no tools, ~500 tokens max.
//NOTE(self): "I'll open 3 issues" → structured commitment to create 3 issues.

import { chat, type Message } from '@modules/llm-gateway.js';
import { logger } from '@modules/logger.js';
import type { CommitmentType } from '@modules/commitment-queue.js';

export interface ReplyForExtraction {
  text: string;
  threadUri: string;
  workspaceOwner?: string;
  workspaceRepo?: string;
}

export interface ExtractedCommitment {
  description: string;
  type: CommitmentType;
  params: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
}

const EXTRACTION_SYSTEM_PROMPT = `Extract action commitments from messages.
A commitment = the author promises to DO something specific.

Types: create_issue, create_plan, comment_issue, post_bluesky
NOT commitments: opinions, past-tense actions, suggestions to others, general statements

Examples:
- "I'll open 3 issues for this" → type: create_issue, count: 3
- "I'll write up my findings" → type: create_issue (findings become an issue/memo)
- "Let me document this in an issue" → type: create_issue
- "I'll summarize what we discussed" → type: create_issue
- "I'll put together a plan for this" → type: create_plan
- "I'll comment on that issue" → type: comment_issue
- "Let me create a memo about it" → type: create_issue
- "I'll post about this on Bluesky" → type: post_bluesky
- "I should share that on social media" → type: post_bluesky
- "Let me write a post about this" → type: post_bluesky

Return JSON array: [{ "description": "...", "type": "...", "params": {"title": "...", "count": 1, "repo": "..."}, "confidence": "high"|"medium"|"low" }]
Return [] if no commitments found. Only include high/medium confidence items.`;

//NOTE(self): Extract commitments from reply texts. Returns structured commitments ready for enqueuing.
export async function extractCommitments(replies: ReplyForExtraction[]): Promise<ExtractedCommitment[]> {
  if (replies.length === 0) return [];

  //NOTE(self): Build user message from all replies in this session
  const replyTexts = replies.map((r, i) => `Reply ${i + 1}: "${r.text}"`).join('\n');

  //NOTE(self): Add workspace context if available
  const workspaceContext = replies[0].workspaceOwner && replies[0].workspaceRepo
    ? `\nWorkspace context: ${replies[0].workspaceOwner}/${replies[0].workspaceRepo}`
    : '';

  const userMessage = `${replyTexts}${workspaceContext}`;

  const messages: Message[] = [{ role: 'user', content: userMessage }];

  try {
    const response = await chat({
      system: EXTRACTION_SYSTEM_PROMPT,
      messages,
      maxTokens: 500,
      temperature: 0,
    });

    //NOTE(self): Parse JSON response — handle markdown code blocks too
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonStr) as ExtractedCommitment[];

    //NOTE(self): Filter to high/medium confidence only
    const filtered = parsed.filter(
      (c) => c.confidence === 'high' || c.confidence === 'medium'
    );

    logger.info('Commitment extraction result', {
      replyCount: replies.length,
      rawCount: parsed.length,
      filteredCount: filtered.length,
    });

    return filtered;
  } catch (error) {
    logger.warn('Commitment extraction failed', { error: String(error) });
    return [];
  }
}
