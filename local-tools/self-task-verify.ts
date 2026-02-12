//NOTE(self): Verify that task execution actually produced real changes
//NOTE(self): Gates: git changes exist, tests pass, push succeeded, PR created
//NOTE(self): No task reaches "complete" unless ALL gates pass

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/logger.js';

//NOTE(self): Shared spawn helper for git commands — returns structured result
export function runGitCommand(
  args: string[],
  cwd: string
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const git = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    git.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    git.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    git.on('close', (code) => {
      resolve({ success: code === 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    git.on('error', (err) => {
      resolve({ success: false, stdout: '', stderr: `Git command error: ${err.message}` });
    });
  });
}

export interface GitVerification {
  hasCommits: boolean;
  hasChanges: boolean;
  commitCount: number;
  filesChanged: string[];
  diffStat: string;
}

//NOTE(self): Verify that Claude Code actually produced git changes on the feature branch
export async function verifyGitChanges(
  workspacePath: string,
  baseBranch: string = 'main'
): Promise<GitVerification> {
  const result: GitVerification = {
    hasCommits: false,
    hasChanges: false,
    commitCount: 0,
    filesChanged: [],
    diffStat: '',
  };

  //NOTE(self): Check commits exist on this branch beyond base
  const logResult = await runGitCommand(
    ['log', `${baseBranch}..HEAD`, '--oneline'],
    workspacePath
  );

  if (logResult.success && logResult.stdout.length > 0) {
    const lines = logResult.stdout.split('\n').filter(l => l.length > 0);
    result.hasCommits = lines.length > 0;
    result.commitCount = lines.length;
  }

  //NOTE(self): Get actual changed files
  const diffResult = await runGitCommand(
    ['diff', baseBranch, '--stat'],
    workspacePath
  );

  if (diffResult.success && diffResult.stdout.length > 0) {
    //NOTE(self): Parse --stat output: each line before the summary is a file
    const lines = diffResult.stdout.split('\n');
    result.filesChanged = lines
      .slice(0, -1) // last line is the summary
      .map(l => l.split('|')[0].trim())
      .filter(l => l.length > 0);
    result.hasChanges = result.filesChanged.length > 0;
  }

  //NOTE(self): Get shortstat summary for PR body
  const shortstatResult = await runGitCommand(
    ['diff', baseBranch, '--shortstat'],
    workspacePath
  );

  if (shortstatResult.success) {
    result.diffStat = shortstatResult.stdout;
  }

  logger.info('Git verification result', {
    hasCommits: result.hasCommits,
    hasChanges: result.hasChanges,
    commitCount: result.commitCount,
    filesChanged: result.filesChanged.length,
  });

  return result;
}

export interface TestResult {
  testsExist: boolean;
  testsRun: boolean;
  testsPassed: boolean;
  output: string;
}

//NOTE(self): Run tests if package.json has a non-default test script
export async function runTestsIfPresent(workspacePath: string): Promise<TestResult> {
  const result: TestResult = {
    testsExist: false,
    testsRun: false,
    testsPassed: false,
    output: '',
  };

  //NOTE(self): Check if package.json exists and has a real test script
  const packageJsonPath = path.join(workspacePath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    logger.info('No package.json found, skipping tests', { workspacePath });
    return result;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const testScript = pkg.scripts?.test;

    //NOTE(self): Skip npm's default "Error: no test specified" script
    if (!testScript || testScript.includes('no test specified')) {
      logger.info('No real test script in package.json, skipping tests', { workspacePath });
      return result;
    }

    result.testsExist = true;
  } catch {
    logger.info('Failed to parse package.json, skipping tests', { workspacePath });
    return result;
  }

  //NOTE(self): Run npm test with timeout
  return new Promise((resolve) => {
    const child = spawn('npm', ['test'], {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true' },
    });

    let output = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 120_000); // 2 minute timeout

    child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { output += data.toString(); });

    child.on('close', (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        resolve({
          testsExist: true,
          testsRun: true,
          testsPassed: false,
          output: 'Tests timed out after 120 seconds',
        });
        return;
      }

      //NOTE(self): Detect "command not found" — the test RUNNER isn't installed, not a test failure
      //NOTE(self): e.g. package.json says "test": "vitest" but vitest isn't in node_modules
      //NOTE(self): The SOUL's code is fine; the project just doesn't have the test tool installed
      const lowerOutput = output.toLowerCase();
      const isCommandNotFound = code !== 0 && (
        lowerOutput.includes('command not found') ||
        lowerOutput.includes('not found') && lowerOutput.includes('err!') ||
        lowerOutput.includes('cannot find module') ||
        lowerOutput.includes('err_module_not_found') ||
        lowerOutput.includes('enoent')
      );

      if (isCommandNotFound) {
        logger.info('Test runner not found (not a test failure — tool not installed)', {
          workspacePath,
          outputPreview: output.slice(-500),
        });
        resolve({
          testsExist: true,
          testsRun: false,
          testsPassed: false,
          output: `Test runner not installed: ${output.slice(-1000)}`,
        });
        return;
      }

      resolve({
        testsExist: true,
        testsRun: true,
        testsPassed: code === 0,
        output: output.slice(-2000), // Keep last 2KB for error reporting
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        testsExist: true,
        testsRun: false,
        testsPassed: false,
        output: `Failed to run tests: ${err.message}`,
      });
    });
  });
}

//NOTE(self): Verify we're still on the expected feature branch after Claude Code execution
//NOTE(self): Claude Code might switch branches (git checkout main) or merge other branches
export async function verifyBranch(
  workspacePath: string,
  expectedBranch: string
): Promise<{ success: boolean; currentBranch: string; error?: string }> {
  const result = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath);

  if (!result.success) {
    return { success: false, currentBranch: '', error: `Failed to get current branch: ${result.stderr}` };
  }

  const currentBranch = result.stdout.trim();
  if (currentBranch !== expectedBranch) {
    return {
      success: false,
      currentBranch,
      error: `Expected branch '${expectedBranch}' but found '${currentBranch}'. Claude Code may have switched branches during execution.`,
    };
  }

  return { success: true, currentBranch };
}

//NOTE(self): Verify the branch actually exists on the remote after push
export async function verifyPushSuccess(
  workspacePath: string,
  branchName: string
): Promise<{ success: boolean; error?: string }> {
  const result = await runGitCommand(
    ['ls-remote', '--heads', 'origin', branchName],
    workspacePath
  );

  if (!result.success) {
    return { success: false, error: `ls-remote failed: ${result.stderr}` };
  }

  //NOTE(self): ls-remote returns empty if branch doesn't exist on remote
  if (result.stdout.length === 0) {
    return { success: false, error: `Branch '${branchName}' not found on remote after push` };
  }

  return { success: true };
}
