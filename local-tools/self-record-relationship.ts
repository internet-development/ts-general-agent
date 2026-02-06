import { createMemory } from '@modules/memory.js';

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
