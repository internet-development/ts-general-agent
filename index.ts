import { config as dotenvConfig } from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
dotenvConfig();

import { getConfig, initializeSelf } from '@modules/config.js';
import { initLogger, logger } from '@modules/logger.js';
import { initSandbox } from '@modules/sandbox.js';
import { runLoop } from '@modules/loop.js';
import { authenticate as authBluesky } from '@adapters/atproto/authenticate.js';
import { setAuth as authGitHub } from '@adapters/github/authenticate.js';

// Get the directory of this file (repo root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = __dirname;

async function main(): Promise<void> {
  // Initialize sandbox first - this constrains all file operations to this repo
  initSandbox(REPO_ROOT);

  const config = getConfig();

  // NOTE(SELF): Initialize SELF.md with agent name on first run
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

  await runLoop();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
