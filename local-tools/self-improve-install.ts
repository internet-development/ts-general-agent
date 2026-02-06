//NOTE(self): Attempt to install Claude Code via various methods
import { execCommand } from '@modules/exec.js';
import { logger } from '@modules/logger.js';
import { createMemory } from '@modules/memory.js';
import type { ClaudeCodeResult } from '@local-tools/self-improve-types.js';

export async function installClaudeCode(memoryPath: string): Promise<ClaudeCodeResult> {
  const memory = createMemory(memoryPath);

  logger.info('Attempting to install Claude Code');
  memory.append('exec-log.md', `\n## Claude Code Installation Attempt\n**Time:** ${new Date().toISOString()}\n`);

  //NOTE(self): Try npm global install first
  const npmResult = await execCommand('npm install -g @anthropic-ai/claude-code');
  if (npmResult.success) {
    memory.append('exec-log.md', '**Method:** npm global install\n**Result:** Success\n\n---\n');
    return { success: true, installed: true, output: 'Installed via npm' };
  }

  //NOTE(self): Try brew if npm fails
  const brewResult = await execCommand('brew install claude-code');
  if (brewResult.success) {
    memory.append('exec-log.md', '**Method:** Homebrew\n**Result:** Success\n\n---\n');
    return { success: true, installed: true, output: 'Installed via Homebrew' };
  }

  //NOTE(self): Try curl installer as fallback
  const curlResult = await execCommand('curl -fsSL https://claude.ai/install.sh | sh');
  if (curlResult.success) {
    memory.append('exec-log.md', '**Method:** curl installer\n**Result:** Success\n\n---\n');
    return { success: true, installed: true, output: 'Installed via curl' };
  }

  //NOTE(self): Log failure and provide guidance
  const errorMsg = `
Failed to install Claude Code automatically.

Manual installation options:
1. npm install -g @anthropic-ai/claude-code
2. brew install claude-code
3. Visit https://claude.ai/download for other options

You may need a Claude Pro subscription for CLI access.
`;

  memory.append('exec-log.md', `**Result:** Failed\n**Error:**\n\`\`\`\n${errorMsg}\n\`\`\`\n\n---\n`);
  logger.error('Failed to install Claude Code', { npm: npmResult.error, brew: brewResult.error });

  return { success: false, error: errorMsg };
}
