//NOTE(self): Find the claude binary, checking common paths
import { execCommand } from '@common/exec.js';

export async function findClaudeBinary(): Promise<string | null> {
  //NOTE(self): First try 'which' to find in PATH
  const whichResult = await execCommand('which claude');
  if (whichResult.success && whichResult.stdout?.trim()) {
    return whichResult.stdout.trim();
  }

  //NOTE(self): Try common installation paths
  const paths = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.claude/bin/claude`,
    `${process.env.HOME}/.npm-global/bin/claude`,
  ];

  for (const claudePath of paths) {
    try {
      const check = await execCommand(`test -x "${claudePath}" && echo "found"`);
      if (check.success && check.stdout?.includes('found')) {
        return claudePath;
      }
    } catch {
      //NOTE(self): Continue to next path
    }
  }

  return null;
}
