/**
 * OpenAI Responses API Module
 *
 * STATELESS BY DESIGN: Each API call to /v1/responses is completely
 * independent. OpenAI does not retain any context between calls - all context
 * must be provided in the `input` array with each request. There are no
 * session IDs, thread IDs, or server-side conversation state.
 *
 * Uses gpt-5.2-pro which is only available via the Responses API.
 */

import { getConfig } from '@modules/config.js';
import { logger } from '@modules/logger.js';
import { ui } from '@modules/ui.js';
import { AGENT_TOOLS, type ToolDefinition, type ToolCall, type ToolResult } from '@modules/tools.js';

const OPENAI_API = 'https://api.openai.com/v1';
const API_TIMEOUT_MS = 180000; //NOTE(self): 3 minute timeout for API calls

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

//NOTE(self): Responses API input item types
interface ResponsesInputItem {
  type: 'message' | 'function_call' | 'function_call_output';
  role?: 'user' | 'assistant' | 'developer';
  content?: string | Array<{ type: 'input_text'; text: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

//NOTE(self): Responses API tool format
interface ResponsesTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

//NOTE(self): Responses API response format
interface ResponsesAPIResponse {
  id: string;
  object: string;
  created_at: number;
  model: string;
  output: Array<{
    type: 'message' | 'function_call';
    id?: string;
    role?: string;
    content?: Array<{ type: 'output_text'; text: string }>;
    call_id?: string;
    name?: string;
    arguments?: string;
  }>;
  output_text?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  status: 'completed' | 'failed' | 'in_progress' | 'incomplete';
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

//NOTE(self): Convert our internal message format to Responses API input format
function convertMessagesToResponses(
  messages: Message[],
  system?: string
): ResponsesInputItem[] {
  const result: ResponsesInputItem[] = [];

  //NOTE(self): Add system/developer message first if provided
  if (system) {
    result.push({
      type: 'message',
      role: 'developer',
      content: system,
    });
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({
          type: 'message',
          role: 'user',
          content: msg.content,
        });
      } else {
        //NOTE(self): Handle array content - check for tool results
        const toolResults = msg.content.filter((c) => c.type === 'tool_result');
        const textBlocks = msg.content.filter((c) => c.type === 'text');

        //NOTE(self): Add function call outputs
        for (const tr of toolResults) {
          if (tr.tool_use_id && tr.content !== undefined) {
            result.push({
              type: 'function_call_output',
              call_id: tr.tool_use_id,
              output: tr.content,
            });
          }
        }

        //NOTE(self): Add text content as user message
        if (textBlocks.length > 0) {
          const text = textBlocks.map((b) => b.text || '').join('\n');
          if (text) {
            result.push({
              type: 'message',
              role: 'user',
              content: text,
            });
          }
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({
          type: 'message',
          role: 'assistant',
          content: msg.content,
        });
      } else {
        //NOTE(self): Handle array content with tool_use
        const textBlocks = msg.content.filter((c) => c.type === 'text');
        const toolUses = msg.content.filter((c) => c.type === 'tool_use');

        //NOTE(self): Add text as assistant message
        const text = textBlocks.map((b) => b.text || '').join('\n');
        if (text) {
          result.push({
            type: 'message',
            role: 'assistant',
            content: text,
          });
        }

        //NOTE(self): Add function calls
        for (const tu of toolUses) {
          result.push({
            type: 'function_call',
            call_id: tu.id,
            name: tu.name,
            arguments: JSON.stringify(tu.input || {}),
          });
        }
      }
    }
  }

  return result;
}

//NOTE(self): Convert tool definitions to Responses API format
//NOTE(self): strict mode disabled - it requires ALL properties in required array,
//NOTE(self): which breaks optional parameters. Schema validation not worth the constraint.
function convertToolsToResponses(tools?: ToolDefinition[]): ResponsesTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema as Record<string, unknown>,
  }));
}

export async function chat(params: ChatParams): Promise<string> {
  const result = await chatWithTools(params);
  return result.text;
}

//NOTE(self): Responses API implementation for gpt-5.2-pro
//NOTE(self): Includes automatic retry with exponential backoff for transient errors
export async function chatWithTools(params: ChatParams): Promise<ChatResult> {
  const config = getConfig();

  const input = convertMessagesToResponses(params.messages, params.system);
  const tools = convertToolsToResponses(params.tools);

  const body: Record<string, unknown> = {
    model: config.openai.model,
    input: input,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  //NOTE(self): gpt-5.2-pro supports reasoning effort
  if (config.openai.model.includes('pro')) {
    body.reasoning = { effort: 'high' };
  }

  //NOTE(self): Retry loop with exponential backoff for transient errors
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    //NOTE(self): Create abort controller for timeout (fresh each attempt)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(`${OPENAI_API}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openai.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `OpenAI API error (${response.status})`;
        let errorDetails: unknown = null;
        let retryAfterMs: number | undefined;

        try {
          const errorBody = await response.json();
          errorDetails = errorBody;
          errorMessage = errorBody.error?.message || errorMessage;

          //NOTE(self): Parse retry-after header if present (OpenAI returns seconds)
          const retryAfterHeader = response.headers.get('retry-after');
          if (retryAfterHeader) {
            retryAfterMs = parseInt(retryAfterHeader, 10) * 1000;
          }
        } catch {
          //NOTE(self): Could not parse error response as JSON
          errorMessage = `OpenAI API error (${response.status}): ${response.statusText}`;
        }

        //NOTE(self): Determine if error is retryable
        const isRetryable = response.status === 429 || response.status === 503 || response.status === 502;

        if (isRetryable && attempt < MAX_RETRIES) {
          const backoffMs = calculateBackoff(attempt, retryAfterMs);
          const waitSecs = Math.round(backoffMs / 1000);
          logger.warn('OpenAI API transient error, retrying', {
            status: response.status,
            attempt: attempt + 1,
            maxRetries: MAX_RETRIES,
            backoffMs,
            error: errorMessage
          });
          ui.warn(`API error (${response.status})`, `retrying in ${waitSecs}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await sleep(backoffMs);
          continue; //NOTE(self): Retry the request
        }

        //NOTE(self): Provide specific guidance for common errors
        //NOTE(self): Some errors are fatal and should stop the agent
        if (response.status === 402 || errorMessage.toLowerCase().includes('insufficient') || errorMessage.toLowerCase().includes('credit') || errorMessage.toLowerCase().includes('billing')) {
          logger.error('OpenAI billing/credit error - FATAL', { status: response.status, error: errorDetails });
          throw new FatalAPIError(`Insufficient credits or billing issue: ${errorMessage}`, 'BILLING_ERROR');
        } else if (response.status === 401) {
          logger.error('OpenAI authentication error - FATAL', { status: response.status, error: errorDetails });
          throw new FatalAPIError('Invalid API key. Check API_KEY_OPENAI in .env', 'AUTH_ERROR');
        } else if (response.status === 403) {
          logger.error('OpenAI access denied - FATAL', { status: response.status, error: errorDetails });
          throw new FatalAPIError(`Access denied: ${errorMessage}. Check API permissions.`, 'ACCESS_DENIED');
        } else if (response.status === 429) {
          errorMessage = `Rate limited: ${errorMessage}. Exhausted ${MAX_RETRIES} retries.`;
        } else if (response.status === 400 && errorMessage.includes('schema')) {
          errorMessage = `Schema validation error: ${errorMessage}. Check tool definitions.`;
        } else if (response.status === 503) {
          errorMessage = `Service unavailable: ${errorMessage}. Exhausted ${MAX_RETRIES} retries.`;
        }

        logger.error('OpenAI Responses API error', { status: response.status, error: errorDetails, attempts: attempt + 1 });
        throw new Error(errorMessage);
      }

      const data: ResponsesAPIResponse = await response.json();

      //NOTE(self): Extract text and tool calls from output
      let text = data.output_text || '';
      const toolCalls: ToolCall[] = [];

      for (const item of data.output) {
        if (item.type === 'message' && item.content) {
          for (const block of item.content) {
            if (block.type === 'output_text') {
              text += block.text;
            }
          }
        } else if (item.type === 'function_call' && item.call_id && item.name) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(item.arguments || '{}');
          } catch (parseErr) {
            logger.warn('Failed to parse tool arguments', { name: item.name, arguments: item.arguments });
          }
          toolCalls.push({
            id: item.call_id,
            name: item.name,
            input: parsedInput,
          });
        }
      }

      //NOTE(self): Map status to stop reason
      const stopReasonMap: Record<string, string> = {
        completed: 'end_turn',
        incomplete: 'tool_use',
        failed: 'error',
        in_progress: 'max_tokens',
      };

      //NOTE(self): If there are tool calls, stop reason is tool_use
      const stopReason = toolCalls.length > 0 ? 'tool_use' : (stopReasonMap[data.status] || 'end_turn');

      logger.debug('OpenAI Responses API response', {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        status: data.status,
        toolCalls: toolCalls.length,
        attempts: attempt + 1,
      });

      return {
        text,
        toolCalls,
        stopReason,
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);

      //NOTE(self): Handle specific error types with better messages
      const errorStr = String(error);
      let friendlyError: string;
      let isRetryable = false;

      if (error instanceof Error && error.name === 'AbortError') {
        friendlyError = `API timeout after ${API_TIMEOUT_MS / 1000}s - server did not respond`;
        isRetryable = true; //NOTE(self): Timeouts are worth retrying
        logger.error('OpenAI API timeout', { timeoutMs: API_TIMEOUT_MS, attempt: attempt + 1 });
        ui.warn('API timeout', `${API_TIMEOUT_MS / 1000}s elapsed, server did not respond`);
      } else if (errorStr.includes('fetch failed') || errorStr.includes('ECONNREFUSED') || errorStr.includes('ENOTFOUND')) {
        friendlyError = 'Network error - check internet connection';
        isRetryable = true; //NOTE(self): Network errors may be transient
        logger.error('Network error calling OpenAI', { error: errorStr, attempt: attempt + 1 });
        ui.warn('Network error', 'check internet connection');
      } else if (errorStr.includes('ETIMEDOUT') || errorStr.includes('ECONNRESET')) {
        friendlyError = 'Connection dropped - will retry';
        isRetryable = true;
        logger.error('Connection error calling OpenAI', { error: errorStr, attempt: attempt + 1 });
        ui.warn('Connection dropped', 'will retry');
      } else {
        friendlyError = errorStr;
        logger.error('Failed to call OpenAI Responses API', { error: errorStr, attempt: attempt + 1 });
      }

      lastError = new Error(friendlyError);

      //NOTE(self): Retry if error is transient and we have retries left
      if (isRetryable && attempt < MAX_RETRIES) {
        const backoffMs = calculateBackoff(attempt);
        const waitSecs = Math.round(backoffMs / 1000);
        logger.warn('OpenAI API transient error, retrying', {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          backoffMs,
          error: friendlyError
        });
        ui.info('Retrying', `waiting ${waitSecs}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(backoffMs);
        continue;
      }
    }
  }

  //NOTE(self): All retries exhausted
  ui.error('API failed', `exhausted ${MAX_RETRIES} retries`);
  throw lastError || new Error('OpenAI API call failed after all retries');
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
