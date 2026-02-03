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
function parseArgs(): { flushMemory: boolean; flushAll: boolean } {
  const args = process.argv.slice(2);
  return {
    flushMemory: args.includes('--flush-memory') || args.includes('--flush'),
    flushAll: args.includes('--flush-all'),
  };
}

//NOTE(self): Flush runtime data
//NOTE(self): --flush clears temp files and OPERATING.md
//NOTE(self): --flush-all deletes entire .memory directory (will be recreated)
//NOTE(self): Most state is now in-memory only - SELF.md is the agent's persistent memory
function flushMemory(memoryPath: string, flushAll: boolean = false): void {
  let cleaned = 0;

  if (flushAll) {
    console.log('\n🔥 Full reset...\n');

    //NOTE(self): Delete entire .memory directory
    if (fs.existsSync(memoryPath)) {
      try {
        fs.rmSync(memoryPath, { recursive: true });
        console.log('   ✓ Removed .memory/ (will be recreated)');
        cleaned++;
      } catch (err) {
        console.log(`   ✗ Failed to remove .memory/: ${err}`);
      }
    }
  } else {
    console.log('\n🧹 Flushing runtime data...\n');

    //NOTE(self): Clean temp images only
    const imagesDir = path.join(memoryPath, 'images');
    if (fs.existsSync(imagesDir)) {
      try {
        fs.rmSync(imagesDir, { recursive: true });
        console.log('   ✓ Removed images/ (temp storage)');
        cleaned++;
      } catch (err) {
        console.log(`   ✗ Failed to remove images/: ${err}`);
      }
    }
  }

  //NOTE(self): Always remove OPERATING.md (will regenerate from SELF.md)
  const operatingPath = path.join(REPO_ROOT, 'OPERATING.md');
  if (fs.existsSync(operatingPath)) {
    try {
      fs.unlinkSync(operatingPath);
      console.log('   ✓ Removed OPERATING.md (will regenerate)');
      cleaned++;
    } catch (err) {
      console.log(`   ✗ Failed to remove OPERATING.md: ${err}`);
    }
  }

  if (cleaned === 0) {
    console.log('   (nothing to clean)\n');
  } else {
    console.log(`\n   Cleaned ${cleaned} item(s).\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  //NOTE(self): Initialize sandbox first - this constrains all file operations to this repo
  initSandbox(REPO_ROOT);

  const config = getConfig();

  //NOTE(self): Flush memory if requested
  if (args.flushAll || args.flushMemory) {
    flushMemory(config.paths.memory, args.flushAll);

    //NOTE(self): Regenerate OPERATING.md immediately from SELF.md
    const { readSelf, writeOperating } = await import('@modules/memory.js');
    const { generateOperating } = await import('@modules/engagement.js');
    const fullSelf = readSelf(config.paths.selfmd);
    if (fullSelf) {
      const operating = generateOperating(fullSelf);
      writeOperating(config.paths.operating, operating);
      console.log('   ✓ Regenerated OPERATING.md from SELF.md\n');
    }
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
