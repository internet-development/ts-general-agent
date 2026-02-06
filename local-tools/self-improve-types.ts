//NOTE(self): Shared types for self-improvement local-tools

export interface ClaudeCodeResult {
  success: boolean;
  output?: string;
  error?: string;
  installed?: boolean;
}
