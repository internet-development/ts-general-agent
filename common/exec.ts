import { exec as nodeExec } from 'child_process';
import { promisify } from 'util';
import { logger } from '@modules/logger.js';

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
