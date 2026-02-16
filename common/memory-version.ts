import { createRequire } from 'module';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';

const _require = createRequire(import.meta.url);
export const MEMORY_VERSION: string = _require('../package.json').version || '0.0.0';

// Stamp a state object with the current agent version before saving
export function stampVersion<T extends object>(state: T): T & { _memoryVersion: string } {
  return { ...state, _memoryVersion: MEMORY_VERSION };
}

// Check if loaded data matches the current agent version
export function checkVersion(data: Record<string, unknown>): boolean {
  return data._memoryVersion === MEMORY_VERSION;
}

// For JSONL files: write a sidecar .version file
export function stampJsonlVersion(jsonlPath: string): void {
  writeFileSync(jsonlPath + '.version', MEMORY_VERSION);
}

// For JSONL files: check sidecar .version file matches
export function checkJsonlVersion(jsonlPath: string): boolean {
  try {
    const stored = readFileSync(jsonlPath + '.version', 'utf-8').trim();
    return stored === MEMORY_VERSION;
  } catch {
    return false;
  }
}

// For JSONL files: delete the JSONL file if version mismatches
export function resetJsonlIfVersionMismatch(jsonlPath: string): boolean {
  if (!checkJsonlVersion(jsonlPath)) {
    if (existsSync(jsonlPath)) {
      try { unlinkSync(jsonlPath); } catch { /* ignore */ }
    }
    stampJsonlVersion(jsonlPath);
    return true;
  }
  return false;
}
