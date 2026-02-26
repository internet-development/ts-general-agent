import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execCommand, ExecResult } from './exec.js';

vi.mock('@modules/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    initLogger: vi.fn(),
  },
}));

describe('execCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. Successful command execution
  // ---------------------------------------------------------------------------
  it('returns success: true for a successful command', async () => {
    const result = await execCommand('echo hello');
    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 2. Returns stdout correctly
  // ---------------------------------------------------------------------------
  it('captures stdout output', async () => {
    const result = await execCommand('echo hello');
    expect(result.stdout?.trim()).toBe('hello');
  });

  it('returns the full stdout for multi-word output', async () => {
    const result = await execCommand('echo "foo bar baz"');
    expect(result.stdout?.trim()).toBe('foo bar baz');
  });

  it('does not include an error field on success', async () => {
    const result = await execCommand('echo hello');
    expect(result.error).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 3. Returns stderr on stderr output
  // ---------------------------------------------------------------------------
  it('captures stderr output alongside a zero-exit command', async () => {
    // `sh -c '...'` lets us write to stderr while still exiting 0
    const result = await execCommand("sh -c 'echo warning >&2'");
    expect(result.success).toBe(true);
    expect(result.stderr?.trim()).toBe('warning');
  });

  // ---------------------------------------------------------------------------
  // 4. Failed command returns success: false with error
  // ---------------------------------------------------------------------------
  it('returns success: false when the command exits with a non-zero code', async () => {
    const result = await execCommand('sh -c "exit 1"');
    expect(result.success).toBe(false);
  });

  it('includes an error message when the command fails', async () => {
    const result = await execCommand('sh -c "exit 1"');
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('returns success: false when using the `false` built-in', async () => {
    const result = await execCommand('false');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 5. Non-existent command returns success: false
  // ---------------------------------------------------------------------------
  it('returns success: false for a non-existent command', async () => {
    const result = await execCommand('this_command_does_not_exist_xyz123');
    expect(result.success).toBe(false);
  });

  it('populates the error field for a non-existent command', async () => {
    const result = await execCommand('this_command_does_not_exist_xyz123');
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 6. Custom cwd parameter works
  // ---------------------------------------------------------------------------
  it('executes in the specified cwd directory', async () => {
    const result = await execCommand('pwd', '/tmp');
    expect(result.success).toBe(true);
    // On macOS /tmp is a symlink to /private/tmp, so check with a suffix match
    expect(result.stdout?.trim()).toMatch(/\/tmp$/);
  });

  it('uses the given cwd so relative file paths resolve correctly', async () => {
    // List the contents of /tmp; the cwd should not affect a listing of /tmp
    // but pwd confirms the working directory is set as given.
    const result = await execCommand('pwd', '/usr');
    expect(result.success).toBe(true);
    expect(result.stdout?.trim()).toMatch(/\/usr$/);
  });

  it('returns success: false when cwd does not exist', async () => {
    const result = await execCommand('echo hello', '/nonexistent_path_xyz123');
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 7. Command with both stdout and stderr
  // ---------------------------------------------------------------------------
  it('captures both stdout and stderr simultaneously', async () => {
    const result = await execCommand(
      "sh -c 'echo out_line; echo err_line >&2'"
    );
    expect(result.success).toBe(true);
    expect(result.stdout?.trim()).toBe('out_line');
    expect(result.stderr?.trim()).toBe('err_line');
  });

  it('stderr is populated and stdout is empty when command only writes to stderr', async () => {
    const result = await execCommand("sh -c 'echo only_err >&2'");
    expect(result.success).toBe(true);
    expect(result.stderr?.trim()).toBe('only_err');
    // stdout should be an empty string (not undefined) since exec always provides it
    expect(result.stdout?.trim() ?? '').toBe('');
  });

  // ---------------------------------------------------------------------------
  // Logger is called for every invocation
  // ---------------------------------------------------------------------------
  it('calls logger.info with the command details', async () => {
    const { logger } = await import('@modules/logger.js');
    await execCommand('echo test');
    expect(logger.info).toHaveBeenCalledWith(
      'Executing command',
      expect.objectContaining({ command: 'echo test' })
    );
  });

  it('calls logger.info with the cwd when provided', async () => {
    const { logger } = await import('@modules/logger.js');
    await execCommand('echo test', '/tmp');
    expect(logger.info).toHaveBeenCalledWith(
      'Executing command',
      expect.objectContaining({ command: 'echo test', cwd: '/tmp' })
    );
  });

  // ---------------------------------------------------------------------------
  // Return shape conformance
  // ---------------------------------------------------------------------------
  it('result has the correct shape on success', async () => {
    const result: ExecResult = await execCommand('echo hello');
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
  });

  it('result has the correct shape on failure', async () => {
    const result: ExecResult = await execCommand('false');
    expect(result).toHaveProperty('success', false);
    expect(result).toHaveProperty('error');
  });
});
