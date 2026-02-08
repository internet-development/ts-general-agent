//NOTE(self): Run Claude Code with a prompt for self-improvement
import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '@modules/logger.js';
import { createMemory } from '@modules/memory.js';
import { findClaudeBinary } from '@local-tools/self-improve-find-claude.js';
import { installClaudeCode } from '@local-tools/self-improve-install.js';
import type { ClaudeCodeResult } from '@local-tools/self-improve-types.js';
import type { Memory } from '@modules/memory.js';

const EXEC_LOG_MAX_BYTES = 50 * 1024; // 50KB
const EXEC_LOG_KEEP_ENTRIES = 25;
const EXEC_LOG_DELIMITER = '## Self-Improvement via Claude Code';

//NOTE(self): Truncate exec-log.md if it grows too large, keeping recent entries
function boundExecLog(memory: Memory): void {
  const content = memory.read('exec-log.md');
  if (!content || content.length < EXEC_LOG_MAX_BYTES) return;

  const parts = content.split(EXEC_LOG_DELIMITER);
  if (parts.length <= EXEC_LOG_KEEP_ENTRIES + 1) return;

  //NOTE(self): parts[0] is header before first entry, rest are entries
  const header = parts[0];
  const recentEntries = parts.slice(-EXEC_LOG_KEEP_ENTRIES);
  const truncated = header + recentEntries.map(e => EXEC_LOG_DELIMITER + e).join('');
  memory.write('exec-log.md', truncated);
  logger.debug('Bounded exec-log.md', { entriesBefore: parts.length - 1, entriesAfter: EXEC_LOG_KEEP_ENTRIES });
}

export async function runClaudeCode(
  prompt: string,
  workingDir: string,
  memoryPath: string
): Promise<ClaudeCodeResult> {
  const memory = createMemory(memoryPath);

  //NOTE(self): Prefix every prompt with instruction to check AGENTS.md first
  const prefixedPrompt = `First, read and understand AGENTS.md - it defines the system constraints and architecture.

${prompt}`;

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

  //NOTE(self): Bound exec-log.md to prevent unbounded growth
  boundExecLog(memory);

  //NOTE(self): Log the self-improvement attempt
  const execId = Date.now().toString();
  memory.append('exec-log.md', `
## Self-Improvement via Claude Code ${execId}
**Time:** ${new Date().toISOString()}
**Working Directory:** ${workingDir}
**Claude Binary:** ${finalClaudePath}
**Prompt:**
\`\`\`
${prefixedPrompt}
\`\`\`
`);

  //NOTE(self): Ensure .claude/settings.json exists to suppress co-author attribution
  try {
    const claudeDir = join(workingDir, '.claude');
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }
    const settingsPath = join(claudeDir, 'settings.json');
    const settings = { attribution: { commit: '', pr: '' } };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (settingsErr) {
    logger.debug('Failed to write .claude/settings.json (non-fatal)', { error: String(settingsErr) });
  }

  //NOTE(self): Run Claude Code with spawn for long-running tasks
  //NOTE(self): Pass prompt as argument, just like typing "claude 'prompt'" in terminal
  //NOTE(self): Wrap in try-catch because spawn() can throw synchronously
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(finalClaudePath, [
        '--print',
        '--dangerously-skip-permissions',
        prefixedPrompt, //NOTE(self): Prompt as positional argument (prefixed with AGENTS.md instruction)
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
