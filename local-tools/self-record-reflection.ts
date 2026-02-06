import { createMemory } from '@modules/memory.js';

export interface Reflection {
  timestamp: string;
  thought: string;
  category?: string;
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
