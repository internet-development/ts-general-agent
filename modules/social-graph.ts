/**
 * Social Graph Module
 *
 * //NOTE(self): Extracts entities from social content and builds relational context.
 * //NOTE(self): Helps the agent understand who people are talking about.
 * //NOTE(self): State is in-memory only - resets on restart. I use SELF.md for persistent memory.
 */

import { getProfile } from '@adapters/atproto/get-profile.js';
import type { AtprotoProfile, AtprotoFeedItem, AtprotoFollower } from '@adapters/atproto/types.js';
import { ui } from '@modules/ui.js';

//NOTE(self): Pattern to extract Bluesky handles from text
const HANDLE_PATTERN = /@([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}/g;
const BARE_HANDLE_PATTERN = /\b([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+bsky\.social\b/g;

export interface MentionedEntity {
  handle: string;
  source: 'bio' | 'post' | 'follow';
  context?: string;
}

export interface EnrichedProfile extends AtprotoProfile {
  relationship?: string;
  lastSeen?: string;
}

export interface SocialGraphData {
  mentionedProfiles: EnrichedProfile[];
  knownHandles: Set<string>;
}

//NOTE(self): In-memory cache for profiles (resets on restart)
const profileCache = new Map<string, EnrichedProfile>();

//NOTE(self): Extract handles from arbitrary text
export function extractHandles(text: string): string[] {
  const handles = new Set<string>();

  const atMatches = text.match(HANDLE_PATTERN) || [];
  for (const match of atMatches) {
    handles.add(match.slice(1).toLowerCase());
  }

  const bareMatches = text.match(BARE_HANDLE_PATTERN) || [];
  for (const match of bareMatches) {
    handles.add(match.toLowerCase());
  }

  return Array.from(handles);
}

//NOTE(self): Extract all mentioned entities from social seed data
export function extractMentionedEntities(
  ownerProfile: AtprotoProfile | null,
  ownerFollows: AtprotoFollower[],
  timeline: AtprotoFeedItem[]
): MentionedEntity[] {
  const entities: MentionedEntity[] = [];
  const seenHandles = new Set<string>();

  for (const follow of ownerFollows) {
    seenHandles.add(follow.handle.toLowerCase());
  }

  if (ownerProfile?.description) {
    const bioHandles = extractHandles(ownerProfile.description);
    for (const handle of bioHandles) {
      if (!seenHandles.has(handle)) {
        entities.push({
          handle,
          source: 'bio',
          context: `Mentioned in owner's bio`,
        });
        seenHandles.add(handle);
      }
    }
  }

  for (const item of timeline) {
    const postText = (item.post.record as { text?: string })?.text || '';
    const postHandles = extractHandles(postText);

    for (const handle of postHandles) {
      if (!seenHandles.has(handle)) {
        const authorName = item.post.author.displayName || item.post.author.handle;
        entities.push({
          handle,
          source: 'post',
          context: `Mentioned by ${authorName}`,
        });
        seenHandles.add(handle);
      }
    }
  }

  return entities;
}

//NOTE(self): Load cached profile from memory
export function loadCachedProfile(handle: string): EnrichedProfile | null {
  return profileCache.get(handle.toLowerCase()) || null;
}

//NOTE(self): Save profile to memory cache
export function cacheProfile(profile: EnrichedProfile): void {
  profile.lastSeen = new Date().toISOString();
  profileCache.set(profile.handle.toLowerCase(), profile);
}

//NOTE(self): Fetch and enrich profiles for mentioned entities
export async function enrichMentionedEntities(
  entities: MentionedEntity[],
  maxLookups: number = 8
): Promise<EnrichedProfile[]> {
  const profiles: EnrichedProfile[] = [];
  let lookupCount = 0;

  for (const entity of entities) {
    const cached = loadCachedProfile(entity.handle);
    if (cached) {
      cached.relationship = entity.context;
      profiles.push(cached);
      continue;
    }

    if (lookupCount >= maxLookups) {
      continue;
    }

    ui.startSpinner(`Learning about @${entity.handle}`);
    const result = await getProfile(entity.handle);
    ui.stopSpinner();

    if (result.success) {
      const enriched: EnrichedProfile = {
        ...result.data,
        relationship: entity.context,
        lastSeen: new Date().toISOString(),
      };
      profiles.push(enriched);
      cacheProfile(enriched);
      lookupCount++;
    }
  }

  return profiles;
}

//NOTE(self): Format enriched profiles for the agent's context
export function formatEnrichedContext(profiles: EnrichedProfile[]): string {
  if (profiles.length === 0) {
    return '';
  }

  const parts: string[] = [];
  parts.push(`## People Worth Knowing`);
  parts.push(`*Extracted from conversations and connections.*\n`);

  for (const profile of profiles) {
    const name = profile.displayName || profile.handle;
    parts.push(`### ${name} (@${profile.handle})`);

    if (profile.relationship) {
      parts.push(`*${profile.relationship}*`);
    }

    if (profile.description) {
      parts.push(`> ${profile.description}`);
    }

    parts.push(`- Followers: ${profile.followersCount} | Following: ${profile.followsCount} | Posts: ${profile.postsCount}`);
    parts.push('');
  }

  return parts.join('\n');
}

//NOTE(self): Main entry point - extract and enrich social graph
export async function buildSocialContext(
  ownerProfile: AtprotoProfile | null,
  ownerFollows: AtprotoFollower[],
  timeline: AtprotoFeedItem[]
): Promise<string> {
  const entities = extractMentionedEntities(ownerProfile, ownerFollows, timeline);

  if (entities.length === 0) {
    return '';
  }

  const prioritized = [
    ...entities.filter((e) => e.source === 'bio'),
    ...entities.filter((e) => e.source === 'post'),
  ].slice(0, 5);

  const profiles = await enrichMentionedEntities(prioritized);
  return formatEnrichedContext(profiles);
}
