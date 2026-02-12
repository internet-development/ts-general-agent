import * as path from 'path';
import * as fs from 'fs';
import { logger } from '@modules/logger.js';

let REPO_ROOT: string | null = null;

export function initSandbox(repoRoot: string): void {
  REPO_ROOT = path.resolve(repoRoot);
  logger.info('Sandbox initialized', { root: REPO_ROOT });
}

export function getRepoRoot(): string {
  if (!REPO_ROOT) {
    throw new Error('Sandbox not initialized. Call initSandbox() first.');
  }
  return REPO_ROOT;
}

export function isPathSafe(targetPath: string): boolean {
  if (!REPO_ROOT) {
    logger.error('Sandbox not initialized');
    return false;
  }

  const resolved = path.resolve(targetPath);
  const relative = path.relative(REPO_ROOT, resolved);

  //NOTE(self): Path is safe if:
  // 1. It doesn't start with '..' (not escaping root)
  // 2. It's not an absolute path outside root
  const isSafe = !relative.startsWith('..') && !path.isAbsolute(relative);

  if (!isSafe) {
    logger.warn('Path safety violation attempted', {
      requested: targetPath,
      resolved,
      repoRoot: REPO_ROOT,
    });
  }

  return isSafe;
}

function safePath(targetPath: string): string | null {
  if (!isPathSafe(targetPath)) {
    return null;
  }
  return path.resolve(targetPath);
}

function isWritablePath(targetPath: string): boolean {
  if (!isPathSafe(targetPath)) {
    return false;
  }

  const resolved = path.resolve(targetPath);
  const relative = path.relative(getRepoRoot(), resolved);

  //NOTE(self): Writable paths per AGENTS.md:
  // - .memory/ (includes .memory/code/ for generated scripts)
  // - .workrepos/
  // - SELF.md
  const writablePrefixes = ['.memory', '.workrepos'];
  const writableFiles = ['SELF.md', 'voice-phrases.json'];

  const firstSegment = relative.split(path.sep)[0];

  if (writablePrefixes.includes(firstSegment)) {
    return true;
  }

  if (writableFiles.includes(relative)) {
    return true;
  }

  logger.warn('Write to read-only path attempted', {
    path: targetPath,
    relative,
  });

  return false;
}

export function safeReadFile(filePath: string): string | null {
  const safe = safePath(filePath);
  if (!safe) {
    return null;
  }

  try {
    return fs.readFileSync(safe, 'utf-8');
  } catch (error) {
    logger.error('Failed to read file', { path: safe, error: String(error) });
    return null;
  }
}

export function safeWriteFile(filePath: string, content: string): boolean {
  if (!isWritablePath(filePath)) {
    logger.error('Write rejected - path not writable', { path: filePath });
    return false;
  }

  const safe = safePath(filePath);
  if (!safe) {
    return false;
  }

  try {
    const dir = path.dirname(safe);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(safe, content, 'utf-8');
    logger.info('File written', { path: safe });
    return true;
  } catch (error) {
    logger.error('Failed to write file', { path: safe, error: String(error) });
    return false;
  }
}


