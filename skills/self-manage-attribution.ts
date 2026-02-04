//NOTE(self): Attribution Management Skill
//NOTE(self): Credit + traceability - helps me track and follow up on source attribution.
//NOTE(self): When I share content, I want to credit original creators when possible.
//NOTE(self): This skill provides stats and prompts for working on attribution backlog.
//NOTE(self): This skill is a discrete, toggleable capability for attribution tracking.

import { getPostsNeedingAttributionFollowup, getPostCount } from '@modules/post-log.js';
import { logger } from '@modules/logger.js';

export interface AttributionBacklogStats {
  //NOTE(self): How many posts need attribution follow-up
  needsFollowup: number;
  //NOTE(self): Total posts tracked
  totalPosts: number;
  //NOTE(self): Percentage with complete attribution
  attributionRate: number;
  //NOTE(self): Oldest post needing follow-up (for prioritization)
  oldestPending?: {
    bskyUrl: string;
    blockTitle?: string;
    postedAt: string;
    daysSince: number;
  };
}

//NOTE(self): Get stats about the attribution backlog
//NOTE(self): Used for reflection prompts
//NOTE(self): @returns Statistics about posts needing attribution
export function getAttributionBacklogStats(): AttributionBacklogStats {
  try {
    const needsFollowup = getPostsNeedingAttributionFollowup(100); // Get up to 100 for accurate count
    const totalPosts = getPostCount();

    const attributionRate = totalPosts > 0
      ? Math.round(((totalPosts - needsFollowup.length) / totalPosts) * 100)
      : 100;

    let oldestPending: AttributionBacklogStats['oldestPending'] = undefined;

    if (needsFollowup.length > 0) {
      const oldest = needsFollowup[0]; // Already sorted oldest first
      const postedAt = new Date(oldest.timestamp);
      const daysSince = Math.floor((Date.now() - postedAt.getTime()) / (1000 * 60 * 60 * 24));

      oldestPending = {
        bskyUrl: oldest.bluesky.bsky_url,
        blockTitle: oldest.source.block_title,
        postedAt: oldest.timestamp,
        daysSince,
      };
    }

    return {
      needsFollowup: needsFollowup.length,
      totalPosts,
      attributionRate,
      oldestPending,
    };
  } catch (err) {
    logger.warn('Failed to get attribution backlog stats', { error: String(err) });
    return {
      needsFollowup: 0,
      totalPosts: 0,
      attributionRate: 100,
    };
  }
}

//NOTE(self): Generate a reflection prompt section about attribution backlog
//NOTE(self): This nudges me to work on finding original creators during reflection
//NOTE(self): @returns A prompt section string, or null if no backlog
export function getAttributionReflectionPrompt(): string | null {
  const stats = getAttributionBacklogStats();

  //NOTE(self): No backlog = no prompt needed
  if (stats.needsFollowup === 0) {
    return null;
  }

  const parts: string[] = [];

  parts.push(`**Credit + Traceability Backlog:**`);
  parts.push(`- ${stats.needsFollowup} posts need original creator attribution`);
  parts.push(`- Attribution rate: ${stats.attributionRate}%`);

  if (stats.oldestPending) {
    const daysText = stats.oldestPending.daysSince === 1
      ? '1 day ago'
      : `${stats.oldestPending.daysSince} days ago`;
    parts.push(`- Oldest pending: "${stats.oldestPending.blockTitle || 'Untitled'}" (posted ${daysText})`);
  }

  //NOTE(self): Gentle nudge based on backlog size
  if (stats.needsFollowup >= 10) {
    parts.push(`\nConsider using \`get_posts_needing_attribution\` to work on the backlog during quiet moments.`);
  } else if (stats.needsFollowup >= 5) {
    parts.push(`\nA few posts could use original creator attribution when you have time.`);
  }

  return parts.join('\n');
}

//NOTE(self): Check if it's a good time to work on attribution backlog
//NOTE(self): Returns true if we have a meaningful backlog and haven't checked recently
//NOTE(self): @returns Whether attribution work should be suggested
export function shouldSuggestAttributionWork(): boolean {
  const stats = getAttributionBacklogStats();

  //NOTE(self): Suggest working on backlog if we have 3+ posts needing attribution
  return stats.needsFollowup >= 3;
}
