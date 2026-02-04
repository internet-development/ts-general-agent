import { writeFileSync } from 'fs';
import { logger } from '@modules/logger.js';

export function writeSelf(selfPath: string, content: string): void {
  try {
    writeFileSync(selfPath, content, 'utf-8');
    logger.info('SELF.md updated');
  } catch (error) {
    logger.error('Failed to write SELF.md', { error: String(error) });
  }
}
