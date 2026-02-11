export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  tool_name?: string;  //NOTE(self): Added by executeTools for AI SDK compliance
  content: string;
  is_error?: boolean;
}

import { BLUESKY_TOOLS } from '@local-tools/self-bluesky-tools.js';
import { GITHUB_TOOLS } from '@local-tools/self-github-tools.js';
import { WORKSPACE_TOOLS } from '@local-tools/self-workspace-tools.js';
import { WEB_TOOLS } from '@local-tools/self-web-tools.js';
import { SELF_TOOLS } from '@local-tools/self-tools.js';

export const AGENT_TOOLS: ToolDefinition[] = [
  ...BLUESKY_TOOLS,
  ...GITHUB_TOOLS,
  ...WORKSPACE_TOOLS,
  ...WEB_TOOLS,
  ...SELF_TOOLS,
];
