import { createMemory } from '@modules/memory.js';
import { createSlug } from '@common/strings.js';

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
