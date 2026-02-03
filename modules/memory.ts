import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '@modules/logger.js';

export interface Memory {
  read(key: string): string | null;
  write(key: string, content: string): void;
  append(key: string, content: string): void;
  exists(key: string): boolean;
  list(directory?: string): string[];
  readJson<T>(key: string): T | null;
  writeJson<T>(key: string, data: T): void;
}

export function createMemory(basePath: string): Memory {
  try {
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true });
    }
  } catch (err) {
    logger.error('Failed to create memory directory', { basePath, error: String(err) });
    //NOTE(self): Continue anyway - individual operations will handle their own errors
  }

  function resolvePath(key: string): string {
    return join(basePath, key);
  }

  function ensureDir(filePath: string): boolean {
    try {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      return true;
    } catch (err) {
      logger.error('Failed to create directory', { filePath, error: String(err) });
      return false;
    }
  }

  return {
    read(key: string): string | null {
      const path = resolvePath(key);
      if (!existsSync(path)) {
        return null;
      }
      try {
        return readFileSync(path, 'utf-8');
      } catch (err) {
        logger.error('Failed to read memory', { key, error: String(err) });
        return null;
      }
    },

    write(key: string, content: string): void {
      const path = resolvePath(key);
      ensureDir(path);
      try {
        writeFileSync(path, content, 'utf-8');
        logger.debug('Memory written', { key });
      } catch (err) {
        logger.error('Failed to write memory', { key, error: String(err) });
      }
    },

    append(key: string, content: string): void {
      const path = resolvePath(key);
      ensureDir(path);
      try {
        const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
        writeFileSync(path, existing + content, 'utf-8');
        logger.debug('Memory appended', { key });
      } catch (err) {
        logger.error('Failed to append memory', { key, error: String(err) });
      }
    },

    exists(key: string): boolean {
      return existsSync(resolvePath(key));
    },

    list(directory?: string): string[] {
      const path = directory ? resolvePath(directory) : basePath;
      if (!existsSync(path)) {
        return [];
      }
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },

    readJson<T>(key: string): T | null {
      const content = this.read(key);
      if (!content) return null;
      try {
        return JSON.parse(content) as T;
      } catch (err) {
        logger.error('Failed to parse JSON memory', { key, error: String(err) });
        return null;
      }
    },

    writeJson<T>(key: string, data: T): void {
      try {
        this.write(key, JSON.stringify(data, null, 2));
      } catch (err) {
        logger.error('Failed to write JSON memory', { key, error: String(err) });
      }
    },
  };
}

export function readSoul(soulPath: string): string {
  if (!existsSync(soulPath)) {
    throw new Error('SOUL.md not found - agent identity is undefined');
  }
  try {
    return readFileSync(soulPath, 'utf-8');
  } catch (err) {
    logger.error('Failed to read SOUL.md', { soulPath, error: String(err) });
    throw new Error('SOUL.md unreadable - agent identity is undefined');
  }
}

export function readSelf(selfPath: string): string {
  try {
    if (!existsSync(selfPath)) {
      return '';
    }
    return readFileSync(selfPath, 'utf-8');
  } catch (err) {
    logger.error('Failed to read SELF.md', { selfPath, error: String(err) });
    return ''; // Graceful degradation - return empty string
  }
}

export function writeSelf(selfPath: string, content: string): boolean {
  try {
    const dir = dirname(selfPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(selfPath, content, 'utf-8');
    return true;
  } catch (err) {
    logger.error('Failed to write SELF.md', { selfPath, error: String(err) });
    return false; // Graceful degradation - return false instead of crashing
  }
}

