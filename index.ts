import { config as dotenvConfig } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
dotenvConfig();

import { getConfig, initializeSelf } from '@modules/config.js';
import { initLogger, logger } from '@modules/logger.js';
import { initSandbox } from '@modules/sandbox.js';
import { runSchedulerLoop } from '@modules/loop.js';
import { authenticate as authBluesky } from '@adapters/atproto/authenticate.js';
import { setAuth as authGitHub } from '@adapters/github/authenticate.js';

//NOTE(self): Get the directory of this file (repo root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = __dirname;

//NOTE(self): Parse command line arguments
function parseArgs(): { flushMemory: boolean } {
  const args = process.argv.slice(2);
  return {
    flushMemory: args.includes('--flush-memory') || args.includes('--flush'),
  };
}

//NOTE(self): Flush memory directory - removes cached state to start fresh
function flushMemory(memoryPath: string): void {
  console.log('\n🧹 Flushing memory...\n');

  const dirsToClean = [
    'engagement',
    'expression',
    'images',
  ];

  const filesToClean = [
    'friction.json',
    'arena_posted.json',
  ];

  let cleaned = 0;

  //NOTE(self): Clean specific directories
  for (const dir of dirsToClean) {
    const dirPath = path.join(memoryPath, dir);
    if (fs.existsSync(dirPath)) {
      try {
        fs.rmSync(dirPath, { recursive: true });
        console.log(`   ✓ Removed ${dir}/`);
        cleaned++;
      } catch (err) {
        console.log(`   ✗ Failed to remove ${dir}/: ${err}`);
      }
    }
  }

  //NOTE(self): Clean specific files
  for (const file of filesToClean) {
    const filePath = path.join(memoryPath, file);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`   ✓ Removed ${file}`);
        cleaned++;
      } catch (err) {
        console.log(`   ✗ Failed to remove ${file}: ${err}`);
      }
    }
  }

  //NOTE(self): Also remove OPERATING.md (will regenerate)
  const operatingPath = path.join(REPO_ROOT, 'OPERATING.md');
  if (fs.existsSync(operatingPath)) {
    try {
      fs.unlinkSync(operatingPath);
      console.log(`   ✓ Removed OPERATING.md (will regenerate)`);
      cleaned++;
    } catch (err) {
      console.log(`   ✗ Failed to remove OPERATING.md: ${err}`);
    }
  }

  if (cleaned === 0) {
    console.log('   (nothing to clean)\n');
  } else {
    console.log(`\n   Cleaned ${cleaned} item(s). Starting fresh.\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  //NOTE(self): Initialize sandbox first - this constrains all file operations to this repo
  initSandbox(REPO_ROOT);

  const config = getConfig();

  //NOTE(self): Flush memory if requested
  if (args.flushMemory) {
    flushMemory(config.paths.memory);
  }

  //NOTE(self): Initialize SELF.md with agent name on first run
  initializeSelf(config);

  initLogger(config.paths.memory, 'info');

  logger.info('Initializing', {
    owner: config.owner.blueskyHandle,
    bluesky: config.bluesky.username,
    github: config.github.username,
  });

  const bskyResult = await authBluesky(
    config.bluesky.username,
    config.bluesky.password
  );

  if (!bskyResult.success) {
    logger.error('Bluesky authentication failed', { error: bskyResult.error });
    console.error(`\n❌ Bluesky auth failed: ${bskyResult.error}`);
    console.error(`   Check BLUESKY_USERNAME and BLUESKY_PASSWORD in .env\n`);
    process.exit(1);
  } else {
    logger.info('Bluesky authenticated', { handle: bskyResult.data.handle });
  }

  authGitHub(config.github.username, config.github.token);
  logger.info('GitHub configured');

  //NOTE(self): Run the scheduler-based loop
  await runSchedulerLoop();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
