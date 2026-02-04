import { readSelf } from '@skills/self-read.js';
import { writeSelf } from '@skills/self-write.js';

export function appendToSelf(selfPath: string, addition: string): void {
  const current = readSelf(selfPath);
  const updated = current.trim() + '\n\n' + addition;
  writeSelf(selfPath, updated);
}
