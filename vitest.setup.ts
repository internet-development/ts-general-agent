//NOTE(self): Test isolation — all .memory/ file operations are redirected to a temp directory
//NOTE(self): This prevents tests from corrupting the live agent's state when running alongside it
//NOTE(self): Runs before any test file imports, so module-scope constants pick up MEMORY_DIR

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-memory-'));
fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
process.env.MEMORY_DIR = dir;

process.on('exit', () => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
