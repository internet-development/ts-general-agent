import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// Mock logger before importing the module under test
vi.mock('@modules/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  initSandbox,
  getRepoRoot,
  isPathSafe,
  safeReadFile,
  safeWriteFile,
} from './sandbox.js';

// ── Test: uninitialized state ─────────────────────────────────────────────────
// This describe block runs BEFORE any initSandbox call so it exercises the
// module-level REPO_ROOT === null branch. Because vitest runs describe blocks
// in definition order and the beforeEach below is scoped to the outer describe,
// it does not interfere here.
describe('sandbox – uninitialized', () => {
  it('getRepoRoot throws when sandbox has not been initialized', () => {
    // Force REPO_ROOT to null by re-initialising with a recognisably fake path
    // then calling initSandbox with '' would throw on resolve, so we rely on the
    // very first import moment. In practice vitest isolates module state only
    // across files, not describe blocks, so we use a workaround: reset to null
    // by calling initSandbox with a path that is immediately overwritten in the
    // outer beforeEach. The simplest reliable approach is to detect the throw at
    // the start of the test suite before the first initSandbox call.
    //
    // Since REPO_ROOT is shared module state across all tests in this file, we
    // cannot truly guarantee it is null here unless this block runs first.
    // We accept that limitation and document it: if this test fails with
    // "returned a value" instead of "threw", it means another test ran first.
    //
    // To make this robust, we reset to null by monkey-patching via the module's
    // own initSandbox with an empty string, then call getRepoRoot.
    // path.resolve('') returns process.cwd(), so we cannot use '' directly.
    // Instead we rely on the fact that this describe block is declared first.

    // If REPO_ROOT is already set from a prior test run, this assertion will
    // still pass because the module caches the resolved string—but we document
    // that this block intentionally relies on declaration order.
    //
    // The cleanest way: vitest does NOT reset module state between describe
    // blocks. So we accept that this block runs first (declaration order).
    expect(() => {
      // We cannot truly reset REPO_ROOT to null from here without a reset
      // export. Instead we verify the *type* of error thrown by getRepoRoot
      // when it was never initialized. Since this file's very first execution
      // hits this block before any beforeEach, REPO_ROOT is null.
      getRepoRoot();
    }).toThrow('Sandbox not initialized. Call initSandbox() first.');
  });
});

// ── Main test suite ───────────────────────────────────────────────────────────
describe('sandbox', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Create a fresh temporary directory for each test so that REPO_ROOT is
    // always pointing at a real directory and tests are isolated.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-test-'));
    initSandbox(tmpDir);
  });

  afterEach(() => {
    // Clean up the temporary directory after each test.
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── initSandbox / getRepoRoot ──────────────────────────────────────────────

  describe('initSandbox', () => {
    it('sets the repo root so that getRepoRoot no longer throws', () => {
      expect(() => getRepoRoot()).not.toThrow();
    });

    it('resolves the provided path to an absolute path', () => {
      const root = getRepoRoot();
      expect(path.isAbsolute(root)).toBe(true);
    });
  });

  describe('getRepoRoot', () => {
    it('returns the path that was passed to initSandbox', () => {
      expect(getRepoRoot()).toBe(path.resolve(tmpDir));
    });
  });

  // ── isPathSafe ────────────────────────────────────────────────────────────

  describe('isPathSafe', () => {
    it('returns true for a path directly inside the root', () => {
      const inside = path.join(tmpDir, 'somefile.txt');
      expect(isPathSafe(inside)).toBe(true);
    });

    it('returns true for a subdirectory path', () => {
      const nested = path.join(tmpDir, 'a', 'b', 'c', 'file.txt');
      expect(isPathSafe(nested)).toBe(true);
    });

    it('returns true for the root directory itself', () => {
      expect(isPathSafe(tmpDir)).toBe(true);
    });

    it('returns false for a path that escapes the root via ..', () => {
      const escaped = path.join(tmpDir, '..', '..', '..', 'etc', 'passwd');
      expect(isPathSafe(escaped)).toBe(false);
    });

    it('returns false for an absolute path outside the root', () => {
      expect(isPathSafe('/etc/passwd')).toBe(false);
    });

    it('returns false for /tmp itself when root is a subdirectory of /tmp', () => {
      // tmpDir is something like /tmp/sandbox-test-XXXX, so /tmp is outside.
      expect(isPathSafe(os.tmpdir())).toBe(false);
    });
  });

  // ── safeReadFile ──────────────────────────────────────────────────────────

  describe('safeReadFile', () => {
    it('returns file content for a safe path', () => {
      const filePath = path.join(tmpDir, 'hello.txt');
      fs.writeFileSync(filePath, 'hello world', 'utf-8');

      expect(safeReadFile(filePath)).toBe('hello world');
    });

    it('returns null for a path outside the sandbox root', () => {
      expect(safeReadFile('/etc/passwd')).toBeNull();
    });

    it('returns null for a non-existent file inside the root', () => {
      const missing = path.join(tmpDir, 'does-not-exist.txt');
      expect(safeReadFile(missing)).toBeNull();
    });

    it('returns null when path traverses outside root with ..', () => {
      const escaped = path.join(tmpDir, '..', '..', 'etc', 'passwd');
      expect(safeReadFile(escaped)).toBeNull();
    });
  });

  // ── safeWriteFile ─────────────────────────────────────────────────────────

  describe('safeWriteFile', () => {
    it('writes content to .memory/ successfully', () => {
      const filePath = path.join(tmpDir, '.memory', 'notes.txt');
      const result = safeWriteFile(filePath, 'agent notes');

      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('agent notes');
    });

    it('writes content to a nested path under .memory/', () => {
      const filePath = path.join(tmpDir, '.memory', 'code', 'script.ts');
      const result = safeWriteFile(filePath, 'const x = 1;');

      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('const x = 1;');
    });

    it('writes content to SELF.md successfully', () => {
      const filePath = path.join(tmpDir, 'SELF.md');
      const result = safeWriteFile(filePath, '# Self');

      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Self');
    });

    it('writes content to .workrepos/ successfully', () => {
      const filePath = path.join(tmpDir, '.workrepos', 'repo', 'README.md');
      const result = safeWriteFile(filePath, '# Repo');

      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Repo');
    });

    it('rejects writes to read-only paths (e.g. src/index.ts)', () => {
      // Create the file so the rejection is purely a policy decision, not a
      // missing-file issue.
      const filePath = path.join(tmpDir, 'src', 'index.ts');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '// original', 'utf-8');

      const result = safeWriteFile(filePath, '// overwrite attempt');

      expect(result).toBe(false);
      // File should remain unchanged.
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('// original');
    });

    it('rejects writes to paths outside the sandbox root', () => {
      const outside = path.join(os.tmpdir(), 'evil.txt');
      const result = safeWriteFile(outside, 'evil content');

      expect(result).toBe(false);
      expect(fs.existsSync(outside)).toBe(false);
    });

    it('creates parent directories when they do not exist', () => {
      const filePath = path.join(tmpDir, '.memory', 'deep', 'nested', 'dir', 'file.txt');

      // Ensure the parent hierarchy does NOT exist yet.
      expect(fs.existsSync(path.dirname(filePath))).toBe(false);

      const result = safeWriteFile(filePath, 'deep content');

      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('deep content');
    });

    it('overwrites an existing writable file', () => {
      const filePath = path.join(tmpDir, 'SELF.md');
      fs.writeFileSync(filePath, 'old content', 'utf-8');

      const result = safeWriteFile(filePath, 'new content');

      expect(result).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
    });
  });
});
