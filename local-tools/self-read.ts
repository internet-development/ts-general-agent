import { readFileSync } from 'fs';

export function readSelf(selfPath: string): string {
  try {
    return readFileSync(selfPath, 'utf-8');
  } catch {
    return '';
  }
}
