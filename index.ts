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
import { loadAllSkills, validateSkills } from '@modules/skills.js';

//NOTE(self): Get the directory of this file (repo root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = __dirname;

//NOTE(self): Parse command line arguments
function parseArgs(): { flushAll: boolean } {
  const args = process.argv.slice(2);
  return {
    flushAll: args.includes('--flush-all'),
  };
}

//NOTE(self): Full reset - deletes entire .memory directory
//NOTE(self): Most state is now in-memory only - SELF.md is the agent's persistent memory
function resetMemory(memoryPath: string): void {
  console.log('\n🔥 Full reset...\n');

  if (fs.existsSync(memoryPath)) {
    try {
      fs.rmSync(memoryPath, { recursive: true });
      console.log('   ✓ Removed .memory/ (will be recreated)');
    } catch (err) {
      console.log(`   ✗ Failed to remove .memory/: ${err}`);
    }
  } else {
    console.log('   (nothing to clean)\n');
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  //NOTE(self): Initialize sandbox first - this constrains all file operations to this repo
  initSandbox(REPO_ROOT);

  const config = getConfig();

  //NOTE(self): Reset memory if requested
  if (args.flushAll) {
    resetMemory(config.paths.memory);
  }

  //NOTE(self): Initialize SELF.md with agent name on first run
  initializeSelf(config);

  //NOTE(self): Initialize logger early so skill loading errors persist to disk
  initLogger(config.paths.memory, 'info');

  //NOTE(self): Load skill templates before anything else needs them
  loadAllSkills();

  //NOTE(self): Validate all skill directories loaded successfully
  const skillValidation = validateSkills();
  if (!skillValidation.valid) {
    logger.error('Skills validation failed', { missing: skillValidation.missing, loaded: skillValidation.loaded });
    console.error(`\n❌ Skills validation failed. Missing: ${skillValidation.missing.join(', ')}`);
    console.error(`   Loaded: ${skillValidation.loaded.join(', ')}`);
    process.exit(1);
  }

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
