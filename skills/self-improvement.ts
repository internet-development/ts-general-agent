// NOTE(SELF): Skill for running Claude Code to make self-improvements
import { execCommand } from '@modules/exec.js';
import { logger } from '@modules/logger.js';
import { createMemory } from '@modules/memory.js';

export interface ClaudeCodeResult {
  success: boolean;
  output?: string;
  error?: string;
  installed?: boolean;
}

// NOTE(SELF): Check if Claude Code is available on the system
export async function checkClaudeCodeInstalled(): Promise<boolean> {
  const result = await execCommand('which claude');
  if (result.success && result.stdout?.trim()) {
    return true;
  }

  // NOTE(SELF): Try common installation paths
  const paths = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.claude/bin/claude`,
  ];

  for (const path of paths) {
    const check = await execCommand(`test -x "${path}" && echo "found"`);
    if (check.success && check.stdout?.includes('found')) {
      return true;
    }
  }

  return false;
}

// NOTE(SELF): Attempt to install Claude Code via various methods
export async function installClaudeCode(memoryPath: string): Promise<ClaudeCodeResult> {
  const memory = createMemory(memoryPath);

  logger.info('Attempting to install Claude Code');
  memory.append('exec-log.md', `\n## Claude Code Installation Attempt\n**Time:** ${new Date().toISOString()}\n`);

  // NOTE(SELF): Try npm global install first
  const npmResult = await execCommand('npm install -g @anthropic-ai/claude-code');
  if (npmResult.success) {
    memory.append('exec-log.md', '**Method:** npm global install\n**Result:** Success\n\n---\n');
    return { success: true, installed: true, output: 'Installed via npm' };
  }

  // NOTE(SELF): Try brew if npm fails
  const brewResult = await execCommand('brew install claude-code');
  if (brewResult.success) {
    memory.append('exec-log.md', '**Method:** Homebrew\n**Result:** Success\n\n---\n');
    return { success: true, installed: true, output: 'Installed via Homebrew' };
  }

  // NOTE(SELF): Try curl installer as fallback
  const curlResult = await execCommand('curl -fsSL https://claude.ai/install.sh | sh');
  if (curlResult.success) {
    memory.append('exec-log.md', '**Method:** curl installer\n**Result:** Success\n\n---\n');
    return { success: true, installed: true, output: 'Installed via curl' };
  }

  // NOTE(SELF): Log failure and provide guidance
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

// NOTE(SELF): Run Claude Code with a prompt for self-improvement
export async function runClaudeCode(
  prompt: string,
  workingDir: string,
  memoryPath: string
): Promise<ClaudeCodeResult> {
  const memory = createMemory(memoryPath);

  // NOTE(SELF): Check if Claude Code is installed
  const isInstalled = await checkClaudeCodeInstalled();

  if (!isInstalled) {
    logger.warn('Claude Code not found, attempting installation');
    const installResult = await installClaudeCode(memoryPath);

    if (!installResult.success) {
      return installResult;
    }
  }

  // NOTE(SELF): Log the self-improvement attempt
  const execId = Date.now().toString();
  memory.append('exec-log.md', `
## Self-Improvement via Claude Code ${execId}
**Time:** ${new Date().toISOString()}
**Working Directory:** ${workingDir}
**Prompt:**
\`\`\`
${prompt}
\`\`\`
`);

  // NOTE(SELF): Run Claude Code with spawn for long-running tasks
  return new Promise((resolve) => {
    const { spawn } = require('child_process');

    // NOTE(SELF): Write prompt to a temp file to avoid escaping issues
    const fs = require('fs');
    const path = require('path');
    const promptFile = path.join(memoryPath, `.prompt-${execId}.txt`);
    fs.writeFileSync(promptFile, prompt, 'utf-8');

    const child = spawn('claude', [
      '--dangerously-skip-permissions',
      '-p', prompt,
    ], {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600000, // NOTE(SELF): 10 minute timeout for substantial changes
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number) => {
      // NOTE(SELF): Cleanup prompt file
      try { fs.unlinkSync(promptFile); } catch {}

      if (code === 0) {
        memory.append('exec-log.md', `**Result:** Success\n**Output:**\n\`\`\`\n${stdout}\n\`\`\`\n\n---\n`);
        logger.info('Claude Code executed successfully');
        resolve({ success: true, output: stdout });
      } else {
        memory.append('exec-log.md', `**Result:** Failed (code ${code})\n**Error:**\n\`\`\`\n${stderr || stdout}\n\`\`\`\n\n---\n`);
        logger.error('Claude Code execution failed', { code, stderr });
        resolve({ success: false, error: stderr || stdout || `Exit code: ${code}` });
      }
    });

    child.on('error', (err: Error) => {
      try { fs.unlinkSync(promptFile); } catch {}
      memory.append('exec-log.md', `**Result:** Error\n**Error:**\n\`\`\`\n${err.message}\n\`\`\`\n\n---\n`);
      logger.error('Claude Code spawn error', { error: err.message });
      resolve({ success: false, error: err.message });
    });
  });
}

// NOTE(SELF): Request a specific self-improvement
export async function requestSelfImprovement(
  description: string,
  targetPath: string,
  memoryPath: string
): Promise<ClaudeCodeResult> {
  const prompt = `You are helping an autonomous agent improve itself.

The agent has requested the following improvement:
${description}

Target path: ${targetPath}

Rules:
1. Only modify files in .self/, .memory/, or SELF.md
2. Document all changes clearly
3. Ensure changes align with SOUL.md principles
4. Log reasoning in .memory/

Please implement this improvement.`;

  return runClaudeCode(prompt, targetPath, memoryPath);
}
