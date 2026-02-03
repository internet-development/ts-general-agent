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
import { AGENT_TOOLS, type ToolDefinition, type ToolCall, type ToolResult } from '@modules/tools.js';

const OPENAI_API = 'https://api.openai.com/v1';

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

  try {
    const response = await fetch(`${OPENAI_API}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorMessage = `OpenAI API error (${response.status})`;
      let errorDetails: unknown = null;

      try {
        const errorBody = await response.json();
        errorDetails = errorBody;
        errorMessage = errorBody.error?.message || errorMessage;

        //NOTE(self): Provide specific guidance for common errors
        if (response.status === 429) {
          errorMessage = `Rate limited: ${errorMessage}. Will back off automatically.`;
        } else if (response.status === 400 && errorMessage.includes('schema')) {
          errorMessage = `Schema validation error: ${errorMessage}. Check tool definitions.`;
        } else if (response.status === 401) {
          errorMessage = 'Invalid API key. Check API_KEY_OPENAI in .env';
        } else if (response.status === 503) {
          errorMessage = `Service unavailable: ${errorMessage}. Will retry later.`;
        }
      } catch {
        //NOTE(self): Could not parse error response as JSON
        errorMessage = `OpenAI API error (${response.status}): ${response.statusText}`;
      }

      logger.error('OpenAI Responses API error', { status: response.status, error: errorDetails });
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
    logger.error('Failed to call OpenAI Responses API', { error: String(error) });
    throw error;
  }
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
