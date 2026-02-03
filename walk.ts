/**
 * Walk Mode - Run all scheduler operations once and exit
 *
 * //NOTE(self): This is useful for testing and manual self-management.
 * //NOTE(self): Instead of running forever, we "walk" through each operation once.
 * //NOTE(self): Uses the same beautiful UI as the main agent.
 */

import { config as dotenvConfig } from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
dotenvConfig();

import { getConfig, initializeSelf } from '@modules/config.js';
import { initLogger, logger } from '@modules/logger.js';
import { initSandbox } from '@modules/sandbox.js';
import { ui } from '@modules/ui.js';
import { readSelf } from '@modules/memory.js';
import { authenticate as authBluesky, getSession } from '@adapters/atproto/authenticate.js';
import { setAuth as authGitHub } from '@adapters/github/authenticate.js';
import { getScheduler, resetScheduler } from '@modules/scheduler.js';
import {
  loadExpressionSchedule,
  scheduleNextExpression,
  getExpressionsNeedingEngagementCheck,
  updateExpressionEngagement,
} from '@modules/expression.js';
import { getAuthorFeed } from '@adapters/atproto/get-timeline.js';
import { addInsight, getInsights, getRelationshipSummary, initializeThreadTracking } from '@modules/engagement.js';
import { getFrictionReadyForImprovement } from '@modules/friction.js';
import { getAspirationForGrowth, getAspirationStats, getAllAspirations } from '@modules/aspiration.js';
import { getEngagementPatterns } from '@modules/expression.js';
import { createRequire } from 'module';

//NOTE(self): Get the directory of this file (repo root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = __dirname;

//NOTE(self): Read version from package.json
const require = createRequire(import.meta.url);
const pkg = require('./package.json');
const VERSION = pkg.version || '0.0.0';

async function walk(): Promise<void> {
  //NOTE(self): Initialize sandbox - constrains all file operations to this repo
  initSandbox(REPO_ROOT);

  const config = getConfig();

  //NOTE(self): Initialize SELF.md with agent name on first run
  initializeSelf(config);

  initLogger(config.paths.memory, 'info');

  //NOTE(self): Extract identity from SELF.md
  const selfContent = readSelf(config.paths.selfmd);
  const name =
    selfContent.match(/I'm\s+(\w+)/)?.[1] ||
    selfContent.match(/^#\s*(.+)$/m)?.[1]?.replace(/^(SELF|Agent Self Document)\s*/i, '').trim() ||
    'Agent';

  //NOTE(self): Display welcome - same style as main agent
  ui.printHeader(name, `Walk Mode v${VERSION}`);
  ui.printDivider('light');

  logger.info('Walk mode starting', {
    owner: config.owner.blueskyHandle,
    bluesky: config.bluesky.username,
  });

  //NOTE(self): Authenticate with Bluesky
  ui.startSpinner('Authenticating with Bluesky');
  const bskyResult = await authBluesky(
    config.bluesky.username,
    config.bluesky.password
  );

  if (!bskyResult.success) {
    ui.stopSpinner('Authentication failed', false);
    logger.error('Bluesky authentication failed', { error: bskyResult.error });
    ui.error('Check BLUESKY_USERNAME and BLUESKY_PASSWORD in .env');
    process.exit(1);
  }
  ui.stopSpinner(`Authenticated as @${bskyResult.data.handle}`);

  //NOTE(self): Configure GitHub
  authGitHub(config.github.username, config.github.token);

  //NOTE(self): Bootstrap thread tracking from existing replies (one-time, cheap API calls)
  ui.startSpinner('Initializing thread tracking');
  await initializeThreadTracking();
  ui.stopSpinner('Thread tracking ready');

  //NOTE(self): Get the scheduler (but don't start it - we'll call methods directly)
  const scheduler = getScheduler();

  ui.printSpacer();

  //NOTE(self): 1. GROUNDING - Read and internalize SELF.md before acting
  ui.printSection('Grounding');
  try {
    await scheduler.forceGrounding();
  } catch (error) {
    ui.error('Error', String(error));
  }

  //NOTE(self): 2. AWARENESS - Check for people reaching out
  ui.printSection('Awareness');
  ui.startSpinner('Checking notifications');
  try {
    await scheduler.forceAwareness();
    ui.stopSpinner('Awareness check complete');
  } catch (error) {
    ui.stopSpinner('Awareness check failed', false);
    ui.error('Error', String(error));
  }

  //NOTE(self): 3. EXPRESSION - Share a thought
  ui.printSection('Expression');

  //NOTE(self): Ensure we have a prompt ready
  const schedule = loadExpressionSchedule();
  if (!schedule.pendingPrompt) {
    scheduleNextExpression(0, 0); // Schedule immediately
  }

  ui.startSpinner('Sharing a thought');
  try {
    await scheduler.forceExpression();
    ui.stopSpinner('Expression complete');
  } catch (error) {
    ui.stopSpinner('Expression failed', false);
    ui.error('Error', String(error));
  }

  //NOTE(self): 4. ENGAGEMENT CHECK - See how posts are doing
  ui.printSection('Engagement');
  ui.startSpinner('Checking post performance');
  try {
    const needsCheck = getExpressionsNeedingEngagementCheck();
    if (needsCheck.length === 0) {
      ui.stopSpinner('No expressions need engagement check yet');
    } else {
      const session = getSession();
      if (session) {
        const feedResult = await getAuthorFeed(session.did, { limit: 20 });
        if (feedResult.success) {
          const engagementMap = new Map<string, { likes: number; replies: number; reposts: number }>();
          for (const item of feedResult.data.feed) {
            const post = item.post;
            engagementMap.set(post.uri, {
              likes: post.likeCount || 0,
              replies: post.replyCount || 0,
              reposts: post.repostCount || 0,
            });
          }

          for (const expression of needsCheck) {
            const engagement = engagementMap.get(expression.postUri);
            if (engagement) {
              updateExpressionEngagement(expression.postUri, engagement);
              ui.info(`${expression.promptSource}`, `${engagement.likes} likes, ${engagement.replies} replies`);

              if (engagement.replies >= 1) {
                addInsight(`Post from ${expression.promptSource} got ${engagement.replies} ${engagement.replies === 1 ? 'reply' : 'replies'} - what made this connect?`);
              }
              if (engagement.likes >= 5) {
                addInsight(`Well-received post (${engagement.likes} likes) from ${expression.promptSource} - consider more content like this`);
              }
            }
          }
          ui.stopSpinner('Engagement check complete');
        } else {
          ui.stopSpinner('Failed to fetch feed', false);
        }
      } else {
        ui.stopSpinner('No session available', false);
      }
    }
  } catch (error) {
    ui.stopSpinner('Engagement check failed', false);
    ui.error('Error', String(error));
  }

  //NOTE(self): 5. INTEGRATION - Deep integration of experiences
  ui.printSection('Reflection');
  ui.startSpinner('Integrating experiences');
  try {
    await scheduler.forceReflection();
    ui.stopSpinner('Reflection complete');
  } catch (error) {
    ui.stopSpinner('Reflection failed', false);
    ui.error('Error', String(error));
  }

  //NOTE(self): 6. SELF-IMPROVEMENT - Reactive (friction) AND Proactive (aspiration)
  ui.printSection('Self-Improvement');

  //NOTE(self): First check for friction (reactive - something is broken)
  const friction = getFrictionReadyForImprovement();
  if (friction) {
    ui.warn('Friction detected', `${friction.category}: ${friction.description}`);
    try {
      const improved = await scheduler.forceImprovement();
      if (!improved) {
        ui.info('Decision made', 'SOUL evaluated and chose not to fix right now');
      }
    } catch (error) {
      ui.error('Error', String(error));
    }
  } else {
    ui.info('No friction', 'nothing broken');
  }

  //NOTE(self): Then check for aspirations (proactive - growth from inspiration)
  const aspiration = getAspirationForGrowth();
  if (aspiration) {
    ui.info('Aspiration found', `${aspiration.category}: ${aspiration.description}`);
    try {
      const grew = await scheduler.forceGrowth();
      if (!grew) {
        ui.info('Decision made', 'SOUL evaluated and chose not to grow right now');
      }
    } catch (error) {
      ui.error('Error', String(error));
    }
  } else {
    //NOTE(self): Show aspiration stats even if nothing is ready
    const aspirationStats = getAspirationStats();
    if (aspirationStats.total > 0) {
      ui.info('Aspirations', `${aspirationStats.total} found in SELF.md (${aspirationStats.actionable} actionable, ${aspirationStats.attempted} attempted)`);
    } else {
      ui.info('No aspirations', 'consider adding growth goals to SELF.md');
    }
  }

  //NOTE(self): 7. GROWTH - Summary of learnings, relationships, and state
  ui.printSection('Growth');

  //NOTE(self): Show insights generated during this session
  const insights = getInsights();
  if (insights.length > 0) {
    ui.info('Insights', `${insights.length} generated`);
    for (const insight of insights.slice(0, 3)) {
      ui.think(insight);
    }
    if (insights.length > 3) {
      ui.system(`+${insights.length - 3} more insights`);
    }
  }

  //NOTE(self): Show relationship summary
  const relationships = getRelationshipSummary();
  if (relationships.total > 0) {
    ui.social('Relationships', `${relationships.total} connections, ${relationships.positive} positive`);
    if (relationships.topEngagers.length > 0) {
      const topHandles = relationships.topEngagers.slice(0, 3).map(e => `@${e.handle}`).join(', ');
      ui.info('Top engagers', topHandles);
    }
  }

  //NOTE(self): Show what resonated (engagement patterns)
  const patterns = getEngagementPatterns();
  if (patterns.highPerformers.length > 0) {
    const top = patterns.highPerformers[0];
    ui.reflect('Resonated', `${top.source} content (avg ${top.avgReplies.toFixed(1)} replies)`);
  }
  if (patterns.insights.length > 0) {
    for (const patternInsight of patterns.insights.slice(0, 2)) {
      ui.contemplate(patternInsight);
    }
  }

  //NOTE(self): Encouragement if nothing notable
  if (insights.length === 0 && relationships.total === 0 && patterns.highPerformers.length === 0 && !friction) {
    ui.info('Fresh start', 'no data yet - run again after some activity');
  }

  //NOTE(self): Complete
  ui.printSpacer();
  ui.printDivider('light');
  ui.success('Walk complete', 'all operations finished');
  ui.printFarewell();

  //NOTE(self): Clean up
  resetScheduler();
  process.exit(0);
}

walk().catch((error) => {
  ui.error('Walk failed', String(error));
  logger.error('Walk mode error', { error: String(error) });
  process.exit(1);
});
