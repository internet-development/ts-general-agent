//NOTE(self): Bluesky Reset — Delete all posts and replies
//NOTE(self): Lightweight init: sandbox + config + auth only (no skills, no logger, no scheduler)
//NOTE(self): Uses com.atproto.repo.listRecords for complete enumeration, 500ms cooldown between deletes

import { config as dotenvConfig } from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
dotenvConfig();

import { getConfig } from '@modules/config.js';
import { initSandbox } from '@modules/sandbox.js';
import { authenticate as authBluesky, getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import { deletePost } from '@adapters/atproto/delete-post.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = __dirname;

const BSKY_SERVICE = 'https://bsky.social';
const COOLDOWN_MS = 500;
const RATE_LIMIT_BACKOFF_MS = 30_000;
const PROGRESS_INTERVAL = 10;

interface ListRecordsResponse {
  records: Array<{ uri: string }>;
  cursor?: string;
}

//NOTE(self): Paginate through all post records to collect URIs
async function collectAllPostUris(): Promise<string[]> {
  const session = getSession();
  if (!session) throw new Error('Not authenticated');

  const uris: string[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      limit: '100',
    });
    if (cursor) params.set('cursor', cursor);

    const response = await fetch(
      `${BSKY_SERVICE}/xrpc/com.atproto.repo.listRecords?${params}`,
      { headers: getAuthHeaders() }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to list records');
    }

    const data: ListRecordsResponse = await response.json();
    for (const record of data.records) {
      uris.push(record.uri);
    }
    cursor = data.cursor;
  } while (cursor);

  return uris;
}

//NOTE(self): Prompt user for confirmation on stdin
function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  //NOTE(self): Minimal init — no skills, no logger, no scheduler
  initSandbox(REPO_ROOT);
  const config = getConfig();

  //NOTE(self): Authenticate
  console.log('Authenticating with Bluesky...');
  const authResult = await authBluesky(config.bluesky.username, config.bluesky.password);
  if (!authResult.success) {
    console.error(`Authentication failed: ${authResult.error}`);
    process.exit(1);
  }
  console.log(`Authenticated as @${authResult.data.handle}\n`);

  //NOTE(self): Collect all post URIs
  console.log('Enumerating all posts...');
  const uris = await collectAllPostUris();

  if (uris.length === 0) {
    console.log('No posts found. Nothing to delete.');
    process.exit(0);
  }

  //NOTE(self): Confirmation prompt
  console.log(`\n⚠️  Found ${uris.length} post(s) to delete.`);
  console.log('This action is IRREVERSIBLE. All posts and replies will be permanently deleted.\n');

  const confirmed = await askConfirmation('Type "yes" to confirm deletion: ');
  if (!confirmed) {
    console.log('Aborted.');
    process.exit(0);
  }

  //NOTE(self): Delete loop with cooldown and rate limit handling
  console.log(`\nDeleting ${uris.length} posts (${COOLDOWN_MS}ms cooldown between deletes)...\n`);
  let deleted = 0;
  let failed = 0;

  for (const uri of uris) {
    const result = await deletePost(uri);

    if (result.success) {
      deleted++;
    } else if (result.error?.includes('429') || result.error?.includes('rate')) {
      //NOTE(self): Rate limited — back off and retry once
      console.log(`Rate limited. Backing off for ${RATE_LIMIT_BACKOFF_MS / 1000}s...`);
      await sleep(RATE_LIMIT_BACKOFF_MS);
      const retry = await deletePost(uri);
      if (retry.success) {
        deleted++;
      } else {
        failed++;
        console.error(`Failed after retry: ${retry.error}`);
      }
    } else {
      failed++;
      console.error(`Failed to delete: ${result.error}`);
    }

    if (deleted % PROGRESS_INTERVAL === 0 && deleted > 0) {
      console.log(`  Deleted ${deleted}/${uris.length}...`);
    }

    await sleep(COOLDOWN_MS);
  }

  //NOTE(self): Summary
  console.log(`\nDone. Deleted: ${deleted}, Failed: ${failed}, Total: ${uris.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Bluesky reset failed:', String(error));
  process.exit(1);
});
