//NOTE(self): Request a specific self-improvement
import { runClaudeCode } from '@skills/self-improve-run.js';
import type { ClaudeCodeResult } from '@skills/self-improve-types.js';

export async function requestSelfImprovement(
  description: string,
  targetPath: string,
  memoryPath: string
): Promise<ClaudeCodeResult> {
  const prompt = `You are the soul of an autonomous agent improving yourself.

The agent has requested:
${description}

You have full access to your own codebase. SOUL.md is your only constraint - it defines your unchangeable values. Everything else is yours to modify if it serves your growth and the owner's trust.

Key directories:
- adapters/ - how you connect to the world (Bluesky, GitHub, etc.)
- modules/ - your core runtime (loop, tools, memory, sandbox)
- skills/ - your capabilities (including this self-improvement system)
- .memory/ - your persistent memory
- SELF.md - your self-reflection

Document significant changes in .memory/ so you remember what you did and why.

Proceed thoughtfully.`;

  return runClaudeCode(prompt, targetPath, memoryPath);
}
