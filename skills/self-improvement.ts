//NOTE(self): Skill for running Claude Code to make self-improvements
import { spawn } from 'child_process';
import { execCommand } from '@modules/exec.js';
import { logger } from '@modules/logger.js';
import { createMemory } from '@modules/memory.js';

export interface ClaudeCodeResult {
  success: boolean;
  output?: string;
  error?: string;
  installed?: boolean;
}

//NOTE(self): Find the claude binary, checking common paths
export async function findClaudeBinary(): Promise<string | null> {
  //NOTE(self): First try 'which' to find in PATH
  const whichResult = await execCommand('which claude');
  if (whichResult.success && whichResult.stdout?.trim()) {
    return whichResult.stdout.trim();
  }

  //NOTE(self): Try common installation paths
  const paths = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.claude/bin/claude`,
    `${process.env.HOME}/.npm-global/bin/claude`,
  ];

  for (const claudePath of paths) {
    try {
      const check = await execCommand(`test -x "${claudePath}" && echo "found"`);
      if (check.success && check.stdout?.includes('found')) {
        return claudePath;
      }
    } catch {
      //NOTE(self): Continue to next path
    }
  }

  return null;
}

//NOTE(self): Check if Claude Code is available on the system
export async function checkClaudeCodeInstalled(): Promise<boolean> {
  const claudePath = await findClaudeBinary();
  return claudePath !== null;
}

//NOTE(self): Attempt to install Claude Code via various methods
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

//NOTE(self): Run Claude Code with a prompt for self-improvement
export async function runClaudeCode(
  prompt: string,
  workingDir: string,
  memoryPath: string
): Promise<ClaudeCodeResult> {
  const memory = createMemory(memoryPath);

  //NOTE(self): Find the claude binary
  let finalClaudePath = await findClaudeBinary();

  if (!finalClaudePath) {
    logger.warn('Claude Code not found, attempting installation');
    const installResult = await installClaudeCode(memoryPath);

    if (!installResult.success) {
      return installResult;
    }

    //NOTE(self): Try to find it again after installation
    finalClaudePath = await findClaudeBinary();
    if (!finalClaudePath) {
      return { success: false, error: 'Claude Code installed but binary not found in PATH' };
    }
  }

  //NOTE(self): Log the self-improvement attempt
  const execId = Date.now().toString();
  memory.append('exec-log.md', `
## Self-Improvement via Claude Code ${execId}
**Time:** ${new Date().toISOString()}
**Working Directory:** ${workingDir}
**Claude Binary:** ${finalClaudePath}
**Prompt:**
\`\`\`
${prompt}
\`\`\`
`);

  //NOTE(self): Run Claude Code with spawn for long-running tasks
  //NOTE(self): Pass prompt as argument, just like typing "claude 'prompt'" in terminal
  //NOTE(self): Wrap in try-catch because spawn() can throw synchronously
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(finalClaudePath, [
        '--print',
        '--dangerously-skip-permissions',
        prompt, //NOTE(self): Prompt as positional argument
      ], {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe'], //NOTE(self): No stdin needed
        env: { ...process.env }, //NOTE(self): Inherit environment for PATH etc.
      });
    } catch (spawnErr) {
      //NOTE(self): spawn() threw synchronously - return error
      const errorMsg = `Spawn failed: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`;
      memory.append('exec-log.md', `**Result:** Error\n**Error:**\n\`\`\`\n${errorMsg}\n\`\`\`\n\n---\n`);
      logger.error('Claude Code spawn failed synchronously', { error: errorMsg });
      resolve({ success: false, error: errorMsg });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    //NOTE(self): 10 minute timeout for substantial changes
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 600000);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);

      if (timedOut) {
        const errorMsg = 'Claude Code execution timed out after 10 minutes';
        memory.append('exec-log.md', `**Result:** Timeout\n**Error:**\n\`\`\`\n${errorMsg}\n\`\`\`\n\n---\n`);
        logger.error('Claude Code execution timed out');
        resolve({ success: false, error: errorMsg });
        return;
      }

      if (code === 0) {
        memory.append('exec-log.md', `**Result:** Success\n**Output:**\n\`\`\`\n${stdout}\n\`\`\`\n\n---\n`);
        logger.info('Claude Code executed successfully');
        resolve({ success: true, output: stdout });
      } else {
        const errorOutput = stderr || stdout || `Exit code: ${code}`;
        memory.append('exec-log.md', `**Result:** Failed (code ${code})\n**Error:**\n\`\`\`\n${errorOutput}\n\`\`\`\n\n---\n`);
        logger.error('Claude Code execution failed', { code, stderr });
        resolve({ success: false, error: errorOutput });
      }
    });

    child.on('error', (err: Error) => {
      clearTimeout(timeout);
      const errorMsg = `Spawn error: ${err.message}`;
      memory.append('exec-log.md', `**Result:** Error\n**Error:**\n\`\`\`\n${errorMsg}\n\`\`\`\n\n---\n`);
      logger.error('Claude Code spawn error', { error: err.message });
      resolve({ success: false, error: errorMsg });
    });
  });
}

//NOTE(self): Request a specific self-improvement
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
