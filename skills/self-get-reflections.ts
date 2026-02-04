import { createMemory } from '@modules/memory.js';
import type { Reflection } from '@skills/self-record-reflection.js';

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
