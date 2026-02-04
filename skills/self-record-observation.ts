import { createMemory } from '@modules/memory.js';

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
