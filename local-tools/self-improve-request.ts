//NOTE(self): Request a specific self-improvement
import { runClaudeCode } from '@local-tools/self-improve-run.js';
import type { ClaudeCodeResult } from '@local-tools/self-improve-types.js';
import { renderSkillSection } from '@modules/skills.js';

export async function requestSelfImprovement(
  description: string,
  targetPath: string,
  memoryPath: string
): Promise<ClaudeCodeResult> {
  const prompt = renderSkillSection('AGENT-SELF-IMPROVEMENT', 'General', {
    description,
    reasoningLine: '',
  });

  return runClaudeCode(prompt, targetPath, memoryPath);
}
