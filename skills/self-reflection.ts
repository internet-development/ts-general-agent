import { readFileSync, writeFileSync } from 'fs';
import { logger } from '@modules/logger.js';
import { createMemory } from '@modules/memory.js';

export interface Reflection {
  timestamp: string;
  thought: string;
  category?: string;
}

export function readSelf(selfPath: string): string {
  try {
    return readFileSync(selfPath, 'utf-8');
  } catch {
    return '';
  }
}

export function writeSelf(selfPath: string, content: string): void {
  try {
    writeFileSync(selfPath, content, 'utf-8');
    logger.info('SELF.md updated');
  } catch (error) {
    logger.error('Failed to write SELF.md', { error: String(error) });
  }
}

export function appendToSelf(selfPath: string, addition: string): void {
  const current = readSelf(selfPath);
  const updated = current.trim() + '\n\n' + addition;
  writeSelf(selfPath, updated);
}

export function recordReflection(
  memoryPath: string,
  thought: string,
  category?: string
): void {
  const memory = createMemory(memoryPath);

  const reflection: Reflection = {
    timestamp: new Date().toISOString(),
    thought,
    category,
  };

  const filename = 'reflections.jsonl';
  memory.append(filename, JSON.stringify(reflection) + '\n');
}

export function getRecentReflections(
  memoryPath: string,
  limit = 10
): Reflection[] {
  const memory = createMemory(memoryPath);
  const content = memory.read('reflections.jsonl');

  if (!content) return [];

  const lines = content.trim().split('\n').filter(Boolean);
  const reflections: Reflection[] = [];

  for (const line of lines.slice(-limit)) {
    try {
      reflections.push(JSON.parse(line));
    } catch {
      continue;
    }
  }

  return reflections;
}

export function recordObservation(
  memoryPath: string,
  subject: string,
  observation: string
): void {
  const memory = createMemory(memoryPath);

  const entry = {
    timestamp: new Date().toISOString(),
    observation,
  };

  const filename = `observations/${subject}.jsonl`;
  memory.append(filename, JSON.stringify(entry) + '\n');
}

export function recordRelationship(
  memoryPath: string,
  handle: string,
  note: string
): void {
  const memory = createMemory(memoryPath);

  const entry = {
    timestamp: new Date().toISOString(),
    note,
  };

  const filename = `people/${handle.replace(/[^a-zA-Z0-9]/g, '_')}.jsonl`;
  memory.append(filename, JSON.stringify(entry) + '\n');
}
