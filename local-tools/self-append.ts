import { readSelf } from '@local-tools/self-read.js';
import { writeSelf } from '@local-tools/self-write.js';

export function appendToSelf(selfPath: string, addition: string): void {
  const current = readSelf(selfPath);
  const updated = current.trim() + '\n\n' + addition;
  writeSelf(selfPath, updated);
}
