//NOTE(self): Shared types for self-improvement skills

export interface ClaudeCodeResult {
  success: boolean;
  output?: string;
  error?: string;
  installed?: boolean;
}
