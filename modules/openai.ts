/**
 * AI Gateway Module
 *
 * Uses the `ai` npm module with gateway for streaming LLM responses.
 * STATELESS BY DESIGN: Each API call is completely independent.
 * All context must be provided with each request.
 */

import { streamText, jsonSchema, type ModelMessage, type Tool } from 'ai';
import { getConfig } from '@modules/config.js';
import { logger } from '@modules/logger.js';
import { ui } from '@modules/ui.js';
import { AGENT_TOOLS, type ToolDefinition, type ToolCall, type ToolResult } from '@modules/tools.js';

//NOTE(self): Retry configuration for transient errors (rate limits, network issues)
//NOTE(self): Reliability builds trust - follow through on every conversation
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 5000; // 5 seconds initial backoff
const MAX_BACKOFF_MS = 60000; // 1 minute max backoff

//NOTE(self): Fatal error class for errors that should stop the agent
export class FatalAPIError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'FatalAPIError';
  }
}

//NOTE(self): Check if an error is fatal (agent should exit)
export function isFatalError(error: unknown): error is FatalAPIError {
  return error instanceof FatalAPIError;
}

//NOTE(self): Calculate exponential backoff with jitter to avoid thundering herd
function calculateBackoff(attemptCount: number, retryAfterMs?: number): number {
  //NOTE(self): If API tells us when to retry, respect that (with small buffer)
  if (retryAfterMs && retryAfterMs > 0) {
    return Math.min(retryAfterMs + 1000, MAX_BACKOFF_MS);
  }
  const exponential = BASE_BACKOFF_MS * Math.pow(2, attemptCount);
  const jitter = Math.random() * 0.3 * exponential; // 0-30% jitter
  return Math.min(exponential + jitter, MAX_BACKOFF_MS);
}

//NOTE(self): Sleep helper for backoff delays
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface ChatParams {
  messages: Message[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

//NOTE(self): The ai module automatically uses AI_GATEWAY_API_KEY from environment
//NOTE(self): No need to create a gateway instance - just pass model string directly

//NOTE(self): Convert our internal message format to ModelMessage format for the ai module
function convertMessages(
  messages: Message[],
  system?: string
): ModelMessage[] {
  const result: ModelMessage[] = [];

  //NOTE(self): Add system message first if provided
  if (system) {
    result.push({
      role: 'system',
      content: system,
    });
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({
          role: 'user',
          content: msg.content,
        });
      } else {
        //NOTE(self): Handle array content - check for tool results
        const toolResults = msg.content.filter((c) => c.type === 'tool_result');
        const textBlocks = msg.content.filter((c) => c.type === 'text');

        //NOTE(self): Add tool results as tool messages
        //NOTE(self): AI SDK expects: toolCallId, toolName, output: { type: 'text', value: string }
        for (const tr of toolResults) {
          if (tr.tool_use_id && tr.content !== undefined) {
            result.push({
              role: 'tool',
              content: [{
                type: 'tool-result',
                toolCallId: tr.tool_use_id,
                toolName: tr.name || 'unknown',
                output: {
                  type: 'text',
                  value: tr.content,
                },
              }],
            });
          }
        }

        //NOTE(self): Add text content as user message
        if (textBlocks.length > 0) {
          const text = textBlocks.map((b) => b.text || '').join('\n');
          if (text) {
            result.push({
              role: 'user',
              content: text,
            });
          }
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({
          role: 'assistant',
          content: msg.content,
        });
      } else {
        //NOTE(self): Handle array content with tool_use
        const textBlocks = msg.content.filter((c) => c.type === 'text');
        const toolUses = msg.content.filter((c) => c.type === 'tool_use');

        //NOTE(self): Build assistant message content array
        const parts: Array<
          | { type: 'text'; text: string }
          | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
        > = [];

        const text = textBlocks.map((b) => b.text || '').join('\n');
        if (text) {
          parts.push({ type: 'text', text });
        }

        for (const tu of toolUses) {
          if (tu.id && tu.name) {
            parts.push({
              type: 'tool-call',
              toolCallId: tu.id,
              toolName: tu.name,
              input: tu.input || {},
            });
          }
        }

        if (parts.length > 0) {
          result.push({
            role: 'assistant',
            content: parts,
          });
        }
      }
    }
  }

  return result;
}

//NOTE(self): Convert tool definitions to the ai module Tool format
function convertTools(tools?: ToolDefinition[]): Record<string, Tool> | undefined {
  if (!tools || tools.length === 0) return undefined;

  const result: Record<string, Tool> = {};
  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema(tool.input_schema),
    };
  }
  return result;
}

export async function chat(params: ChatParams): Promise<string> {
  const result = await chatWithTools(params);
  return result.text;
}

//NOTE(self): Streaming implementation using the ai module
//NOTE(self): Includes automatic retry with exponential backoff for transient errors
export async function chatWithTools(params: ChatParams): Promise<ChatResult> {
  const config = getConfig();

  const modelMessages = convertMessages(params.messages, params.system);
  const aiTools = convertTools(params.tools);

  //NOTE(self): Retry loop with exponential backoff for transient errors
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      //NOTE(self): Pass model string directly - ai module uses AI_GATEWAY_API_KEY from env
      const result = streamText({
        model: config.agent.model,
        messages: modelMessages,
        tools: aiTools,
        maxOutputTokens: params.maxTokens,
        temperature: params.temperature,
      });

      //NOTE(self): Collect the streamed response
      let text = '';
      const toolCalls: ToolCall[] = [];

      for await (const part of result.textStream) {
        text += part;
      }

      //NOTE(self): Get tool calls from the result (it's a PromiseLike, so await it)
      const resolvedToolCalls = await result.toolCalls;
      if (resolvedToolCalls && resolvedToolCalls.length > 0) {
        for (const tc of resolvedToolCalls) {
          toolCalls.push({
            id: tc.toolCallId,
            name: tc.toolName,
            input: tc.input as Record<string, unknown>,
          });
        }
      }

      //NOTE(self): Determine stop reason
      const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';

      //NOTE(self): Get usage information
      const usage = await result.usage;

      logger.debug('AI Gateway streaming response', {
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        toolCalls: toolCalls.length,
        attempts: attempt + 1,
      });

      return {
        text,
        toolCalls,
        stopReason,
        usage: {
          inputTokens: usage?.inputTokens || 0,
          outputTokens: usage?.outputTokens || 0,
        },
      };
    } catch (error) {
      const errorStr = String(error);
      let friendlyError: string;
      let isRetryable = false;
      let isFatal = false;

      //NOTE(self): Handle specific error types
      if (errorStr.includes('401') || errorStr.includes('unauthorized') || errorStr.includes('invalid_api_key')) {
        friendlyError = 'Invalid API key. Check API_KEY_GATEWAY_OPENAI in .env';
        isFatal = true;
      } else if (errorStr.includes('402') || errorStr.includes('insufficient') || errorStr.includes('credit') || errorStr.includes('billing')) {
        friendlyError = `Insufficient credits or billing issue: ${errorStr}`;
        isFatal = true;
      } else if (errorStr.includes('403') || errorStr.includes('forbidden')) {
        friendlyError = `Access denied: ${errorStr}. Check API permissions.`;
        isFatal = true;
      } else if (errorStr.includes('429') || errorStr.includes('rate limit')) {
        friendlyError = `Rate limited: ${errorStr}`;
        isRetryable = true;
      } else if (errorStr.includes('503') || errorStr.includes('502') || errorStr.includes('service unavailable')) {
        friendlyError = `Service unavailable: ${errorStr}`;
        isRetryable = true;
      } else if (errorStr.includes('timeout') || errorStr.includes('ETIMEDOUT')) {
        friendlyError = 'API timeout - server did not respond';
        isRetryable = true;
      } else if (errorStr.includes('fetch failed') || errorStr.includes('ECONNREFUSED') || errorStr.includes('ENOTFOUND')) {
        friendlyError = 'Network error - check internet connection';
        isRetryable = true;
      } else if (errorStr.includes('ECONNRESET')) {
        friendlyError = 'Connection dropped - will retry';
        isRetryable = true;
      } else {
        friendlyError = errorStr;
      }

      //NOTE(self): Fatal errors should stop the agent
      if (isFatal) {
        logger.error('AI Gateway fatal error', { error: errorStr });
        throw new FatalAPIError(friendlyError, 'API_ERROR');
      }

      lastError = new Error(friendlyError);

      //NOTE(self): Retry if error is transient and we have retries left
      if (isRetryable && attempt < MAX_RETRIES) {
        const backoffMs = calculateBackoff(attempt);
        const waitSecs = Math.round(backoffMs / 1000);
        logger.warn('AI Gateway transient error, retrying', {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          backoffMs,
          error: friendlyError,
        });
        ui.info('Retrying', `waiting ${waitSecs}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(backoffMs);
        continue;
      }

      logger.error('AI Gateway error', { error: errorStr, attempts: attempt + 1 });
    }
  }

  //NOTE(self): All retries exhausted
  ui.error('API failed', `exhausted ${MAX_RETRIES} retries`);
  throw lastError || new Error('AI Gateway call failed after all retries');
}

//NOTE(self): Maximum characters for a single tool result to prevent context overflow
const MAX_TOOL_RESULT_CHARS = 30000;

function truncateToolResult(content: string): string {
  if (content.length > MAX_TOOL_RESULT_CHARS) {
    const truncated = content.slice(0, MAX_TOOL_RESULT_CHARS);
    return `${truncated}\n\n[TRUNCATED: Result was ${content.length} chars, showing first ${MAX_TOOL_RESULT_CHARS}]`;
  }
  return content;
}

//NOTE(self): Compact messages to remove consumed base64 data and reduce context size
export function compactMessages(messages: Message[]): Message[] {
  let lastToolResultIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && Array.isArray(m.content) &&
        m.content.some((c: ContentBlock) => c.type === 'tool_result')) {
      lastToolResultIndex = i;
      break;
    }
  }

  return messages.map((msg, index) => {
    if (index >= lastToolResultIndex) {
      return msg;
    }

    if (msg.role !== 'user' || !Array.isArray(msg.content)) {
      return msg;
    }

    const compactedContent = msg.content.map((block) => {
      const contentBlock = block as ContentBlock;
      if (contentBlock.type !== 'tool_result' || !contentBlock.content) {
        return block;
      }

      if (contentBlock.content.includes('"base64"')) {
        try {
          const parsed = JSON.parse(contentBlock.content);
          if (parsed.base64 && typeof parsed.base64 === 'string' && parsed.base64.length > 1000) {
            const estimatedBytes = Math.ceil(parsed.base64.length * 0.75);
            parsed.base64 = `[CONSUMED: ${Math.round(estimatedBytes / 1024)}KB image data was used]`;
            return {
              ...contentBlock,
              content: JSON.stringify(parsed),
            };
          }
        } catch {
          //NOTE(self): Not valid JSON, leave as is
        }
      }

      if (contentBlock.content.length > MAX_TOOL_RESULT_CHARS) {
        return {
          ...contentBlock,
          content: contentBlock.content.slice(0, 5000) + '\n\n[COMPACTED: Older result truncated to save context]',
        };
      }

      return block;
    });

    return { ...msg, content: compactedContent };
  });
}

export function createToolResultMessage(results: ToolResult[]): Message {
  return {
    role: 'user',
    content: results.map((r) => ({
      type: 'tool_result' as const,
      tool_use_id: r.tool_use_id,
      name: r.tool_name,  //NOTE(self): Required by AI SDK for proper tool result correlation
      content: truncateToolResult(r.content),
      is_error: r.is_error,
    })),
  };
}

export function createAssistantToolUseMessage(
  text: string,
  toolCalls: ToolCall[]
): Message {
  const content: ContentBlock[] = [];

  if (text) {
    content.push({ type: 'text', text });
  }

  for (const call of toolCalls) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: call.input,
    });
  }

  return {
    role: 'assistant',
    content,
  };
}

export { AGENT_TOOLS, type ToolDefinition, type ToolCall, type ToolResult };
