//NOTE(self): Check if Claude Code is available on the system
import { findClaudeBinary } from '@skills/self-improve-find-claude.js';

export async function checkClaudeCodeInstalled(): Promise<boolean> {
  const claudePath = await findClaudeBinary();
  return claudePath !== null;
}
