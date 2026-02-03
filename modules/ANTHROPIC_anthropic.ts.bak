import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '@modules/config.js';
import { logger } from '@modules/logger.js';
import { AGENT_TOOLS, type ToolDefinition, type ToolCall, type ToolResult } from '@modules/tools.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1';

//NOTE(self): Check if raw fetch mode is enabled via env var
const USE_RAW_FETCH = process.env.USE_RAW_FETCH === 'true';

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

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: ContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
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

//NOTE(self): Lazy-initialized SDK client
let sdkClient: Anthropic | null = null;

function getSDKClient(): Anthropic {
  if (!sdkClient) {
    const config = getConfig();
    sdkClient = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
  }
  return sdkClient;
}

export async function chat(params: ChatParams): Promise<string> {
  const result = await chatWithTools(params);
  return result.text;
}

//NOTE(self): SDK-based implementation
async function chatWithToolsSDK(params: ChatParams): Promise<ChatResult> {
  const config = getConfig();
  const client = getSDKClient();

  try {
    //NOTE(self): Convert tools to SDK format
    const sdkTools = params.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Anthropic.Tool['input_schema'],
    }));

    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: params.maxTokens || 4096,
      temperature: params.temperature ?? 1,
      system: params.system,
      messages: params.messages as Anthropic.MessageParam[],
      tools: sdkTools,
    });

    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    logger.debug('Anthropic SDK response', {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason,
      toolCalls: toolCalls.length,
    });

    return {
      text,
      toolCalls,
      stopReason: response.stop_reason || 'end_turn',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (error) {
    logger.error('Failed to call Anthropic SDK', { error: String(error) });
    throw error;
  }
}

//NOTE(self): Raw fetch implementation (fallback)
async function chatWithToolsRawFetch(params: ChatParams): Promise<ChatResult> {
  const config = getConfig();

  const body: Record<string, unknown> = {
    model: config.anthropic.model,
    max_tokens: params.maxTokens || 4096,
    temperature: params.temperature ?? 1,
    system: params.system,
    messages: params.messages,
  };

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
  }

  try {
    const response = await fetch(`${ANTHROPIC_API}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error('Anthropic API error', { error });
      throw new Error(error.error?.message || 'Anthropic API request failed');
    }

    const data: AnthropicResponse = await response.json();

    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        text += block.text;
      } else if (block.type === 'tool_use' && block.id && block.name && block.input) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    logger.debug('Anthropic raw fetch response', {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      stopReason: data.stop_reason,
      toolCalls: toolCalls.length,
    });

    return {
      text,
      toolCalls,
      stopReason: data.stop_reason,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  } catch (error) {
    logger.error('Failed to call Anthropic raw fetch', { error: String(error) });
    throw error;
  }
}

//NOTE(self): Main entry point - uses SDK by default, raw fetch if env var is set
export async function chatWithTools(params: ChatParams): Promise<ChatResult> {
  if (USE_RAW_FETCH) {
    logger.debug('Using raw fetch for Anthropic API');
    return chatWithToolsRawFetch(params);
  }
  return chatWithToolsSDK(params);
}

//NOTE(self): Maximum characters for a single tool result to prevent context overflow
//NOTE(self): 200k tokens ≈ 800k chars, but we need room for system prompt, messages, and multiple tools
//NOTE(self): Keep individual tool results under 30k chars (~7.5k tokens)
const MAX_TOOL_RESULT_CHARS = 30000;

function truncateToolResult(content: string): string {
  //NOTE(self): For regular content, truncate if too long
  //NOTE(self): Don't truncate base64 here - it needs to be available for the next tool call
  //NOTE(self): Base64 truncation happens in compactMessages() after it's been consumed
  if (content.length > MAX_TOOL_RESULT_CHARS) {
    const truncated = content.slice(0, MAX_TOOL_RESULT_CHARS);
    return `${truncated}\n\n[TRUNCATED: Result was ${content.length} chars, showing first ${MAX_TOOL_RESULT_CHARS}]`;
  }

  return content;
}

//NOTE(self): Compact messages to remove consumed base64 data and reduce context size
//NOTE(self): Call this before adding new tool results to keep context manageable
export function compactMessages(messages: Message[]): Message[] {
  //NOTE(self): Find all base64 data in older tool results and replace with summaries
  //NOTE(self): "Older" means not the most recent tool_result message
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
    //NOTE(self): Skip the most recent tool result - it may still be needed
    if (index >= lastToolResultIndex) {
      return msg;
    }

    //NOTE(self): Only process user messages with tool_result content
    if (msg.role !== 'user' || !Array.isArray(msg.content)) {
      return msg;
    }

    const compactedContent = msg.content.map((block) => {
      const contentBlock = block as ContentBlock;
      if (contentBlock.type !== 'tool_result' || !contentBlock.content) {
        return block;
      }

      //NOTE(self): Check if this tool result contains base64 data
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

      //NOTE(self): Also truncate any very long tool results from previous turns
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
