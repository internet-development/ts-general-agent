import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  MEMORY_VERSION,
  stampVersion,
  checkVersion,
  stampJsonlVersion,
  checkJsonlVersion,
  resetJsonlIfVersionMismatch,
} from './memory-version.js';

describe('memory-version', () => {
  let tmpDir: string;
  let testJsonlPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-version-test-'));
    testJsonlPath = path.join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('MEMORY_VERSION', () => {
    it('is a non-empty string derived from package.json', () => {
      expect(typeof MEMORY_VERSION).toBe('string');
      expect(MEMORY_VERSION.length).toBeGreaterThan(0);
      expect(MEMORY_VERSION).not.toBe('0.0.0');
    });
  });

  describe('stampVersion', () => {
    it('returns object with _memoryVersion field set to MEMORY_VERSION', () => {
      const obj = { foo: 'bar', count: 42 };
      const stamped = stampVersion(obj);

      expect(stamped._memoryVersion).toBe(MEMORY_VERSION);
      expect(stamped.foo).toBe('bar');
      expect(stamped.count).toBe(42);
    });

    it('does not mutate the original object', () => {
      const obj = { hello: 'world' };
      const stamped = stampVersion(obj);

      expect(stamped).not.toBe(obj);
      expect((obj as Record<string, unknown>)._memoryVersion).toBeUndefined();
    });
  });

  describe('checkVersion', () => {
    it('returns true when _memoryVersion matches MEMORY_VERSION', () => {
      const data = { _memoryVersion: MEMORY_VERSION, someData: 123 };
      expect(checkVersion(data)).toBe(true);
    });

    it('returns false when _memoryVersion does not match', () => {
      const data = { _memoryVersion: '0.0.0-old', someData: 123 };
      expect(checkVersion(data)).toBe(false);
    });

    it('returns false when _memoryVersion is missing', () => {
      const data = { someData: 123 };
      expect(checkVersion(data)).toBe(false);
    });
  });

  describe('stampJsonlVersion', () => {
    it('writes a sidecar .version file with MEMORY_VERSION', () => {
      stampJsonlVersion(testJsonlPath);

      const versionPath = testJsonlPath + '.version';
      expect(fs.existsSync(versionPath)).toBe(true);

      const content = fs.readFileSync(versionPath, 'utf-8');
      expect(content).toBe(MEMORY_VERSION);
    });
  });

  describe('checkJsonlVersion', () => {
    it('returns true when sidecar .version file matches MEMORY_VERSION', () => {
      fs.writeFileSync(testJsonlPath + '.version', MEMORY_VERSION);
      expect(checkJsonlVersion(testJsonlPath)).toBe(true);
    });

    it('returns false when sidecar .version file does not match', () => {
      fs.writeFileSync(testJsonlPath + '.version', '0.0.0-old');
      expect(checkJsonlVersion(testJsonlPath)).toBe(false);
    });

    it('returns false when sidecar .version file does not exist', () => {
      expect(checkJsonlVersion(testJsonlPath)).toBe(false);
    });
  });

  describe('resetJsonlIfVersionMismatch', () => {
    it('deletes JSONL file and re-stamps version when version mismatches', () => {
      // Create a JSONL file with stale version
      fs.writeFileSync(testJsonlPath, '{"line":1}\n{"line":2}\n');
      fs.writeFileSync(testJsonlPath + '.version', '0.0.0-old');

      const didReset = resetJsonlIfVersionMismatch(testJsonlPath);

      expect(didReset).toBe(true);
      expect(fs.existsSync(testJsonlPath)).toBe(false);
      // Version sidecar should be re-stamped with current version
      expect(fs.readFileSync(testJsonlPath + '.version', 'utf-8')).toBe(MEMORY_VERSION);
    });

    it('returns false and preserves file when version matches', () => {
      fs.writeFileSync(testJsonlPath, '{"line":1}\n');
      fs.writeFileSync(testJsonlPath + '.version', MEMORY_VERSION);

      const didReset = resetJsonlIfVersionMismatch(testJsonlPath);

      expect(didReset).toBe(false);
      expect(fs.existsSync(testJsonlPath)).toBe(true);
      expect(fs.readFileSync(testJsonlPath, 'utf-8')).toBe('{"line":1}\n');
    });

    it('handles missing JSONL file gracefully when version mismatches', () => {
      // No JSONL file exists, version sidecar is stale
      fs.writeFileSync(testJsonlPath + '.version', '0.0.0-old');

      const didReset = resetJsonlIfVersionMismatch(testJsonlPath);

      expect(didReset).toBe(true);
      // Should stamp the new version even though the JSONL was already absent
      expect(fs.readFileSync(testJsonlPath + '.version', 'utf-8')).toBe(MEMORY_VERSION);
    });

    it('handles missing version sidecar by resetting', () => {
      // JSONL exists but no version sidecar
      fs.writeFileSync(testJsonlPath, '{"line":1}\n');

      const didReset = resetJsonlIfVersionMismatch(testJsonlPath);

      expect(didReset).toBe(true);
      expect(fs.existsSync(testJsonlPath)).toBe(false);
      expect(fs.readFileSync(testJsonlPath + '.version', 'utf-8')).toBe(MEMORY_VERSION);
    });
  });
});
