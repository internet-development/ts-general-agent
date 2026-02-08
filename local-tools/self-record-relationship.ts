import { createMemory } from '@modules/memory.js';
import { createSlug } from '@modules/strings.js';

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

  const filename = `people/${createSlug(handle)}.jsonl`;
  memory.append(filename, JSON.stringify(entry) + '\n');
}
