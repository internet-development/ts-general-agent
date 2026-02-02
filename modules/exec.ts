import { exec as nodeExec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logger } from '@modules/logger.js';
import { createMemory } from '@modules/memory.js';

const execAsync = promisify(nodeExec);

export interface ExecResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export async function execCommand(
  command: string,
  cwd?: string
): Promise<ExecResult> {
  logger.info('Executing command', { command, cwd });

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 60000,
    });
    return { success: true, stdout, stderr };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      stdout: err.stdout,
      stderr: err.stderr,
      error: err.message || String(error),
    };
  }
}

export interface SelfExecContext {
  selfPath: string;
  memoryPath: string;
}

export async function execGeneratedCode(
  code: string,
  context: SelfExecContext
): Promise<ExecResult> {
  const memory = createMemory(context.memoryPath);

  // Log the execution attempt
  const execId = Date.now().toString();
  const logEntry = `
## Execution ${execId}
**Time:** ${new Date().toISOString()}
**Code:**
\`\`\`typescript
${code}
\`\`\`
`;
  memory.append('exec-log.md', logEntry);

  // Write code to .self directory
  if (!existsSync(context.selfPath)) {
    mkdirSync(context.selfPath, { recursive: true });
  }

  const tempFile = join(context.selfPath, `_temp_${execId}.ts`);

  try {
    writeFileSync(tempFile, code, 'utf-8');

    const result = await execAsync(`npx tsx "${tempFile}"`, {
      cwd: context.selfPath,
      timeout: 30000,
    });

    // Log success
    memory.append('exec-log.md', `**Result:** Success\n**Output:**\n\`\`\`\n${result.stdout}\n\`\`\`\n\n---\n`);

    return { success: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };

    // Log failure
    memory.append('exec-log.md', `**Result:** Failed\n**Error:**\n\`\`\`\n${err.message || error}\n\`\`\`\n\n---\n`);

    return {
      success: false,
      stdout: err.stdout,
      stderr: err.stderr,
      error: err.message || String(error),
    };
  } finally {
    // Cleanup temp file
    try {
      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function saveAndExecModule(
  name: string,
  code: string,
  context: SelfExecContext
): Promise<ExecResult> {
  const memory = createMemory(context.memoryPath);

  if (!existsSync(context.selfPath)) {
    mkdirSync(context.selfPath, { recursive: true });
  }

  const modulePath = join(context.selfPath, `${name}.ts`);

  // Log the module creation
  const logEntry = `
## Module Created: ${name}
**Time:** ${new Date().toISOString()}
**Path:** ${modulePath}
**Code:**
\`\`\`typescript
${code}
\`\`\`
`;
  memory.append('exec-log.md', logEntry);

  try {
    writeFileSync(modulePath, code, 'utf-8');
    logger.info('Self module created', { name, path: modulePath });
    return { success: true, stdout: `Module ${name} saved to ${modulePath}` };
  } catch (error) {
    logger.error('Failed to save self module', { name, error: String(error) });
    return { success: false, error: String(error) };
  }
}
