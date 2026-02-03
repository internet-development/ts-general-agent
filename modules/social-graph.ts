/**
 * Social Graph Module
 *
 * //NOTE(self): Extracts entities from social content and builds relational context.
 * //NOTE(self): Helps the agent understand who people are talking about.
 * //NOTE(self): Stores learned profiles in .memory/social/ for persistence across sessions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProfile } from '@adapters/atproto/get-profile.js';
import type { AtprotoProfile, AtprotoFeedItem, AtprotoFollower } from '@adapters/atproto/types.js';
import { ui } from '@modules/ui.js';

//NOTE(self): Pattern to extract Bluesky handles from text
//NOTE(self): Matches @handle.bsky.social, @handle.domain.tld, etc.
const HANDLE_PATTERN = /@([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}/g;

//NOTE(self): Also match bare handles without @ when they look like domains
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

//NOTE(self): Extract handles from arbitrary text
export function extractHandles(text: string): string[] {
  const handles = new Set<string>();

  //NOTE(self): Match @handle patterns
  const atMatches = text.match(HANDLE_PATTERN) || [];
  for (const match of atMatches) {
    handles.add(match.slice(1).toLowerCase());
  }

  //NOTE(self): Match bare .bsky.social handles
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

  //NOTE(self): Collect handles we already know about (owner's follows)
  for (const follow of ownerFollows) {
    seenHandles.add(follow.handle.toLowerCase());
  }

  //NOTE(self): Extract from owner's bio - these are likely important people
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

  //NOTE(self): Extract from timeline posts
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

    //NOTE(self): Also extract from bios of people in timeline
    //NOTE(self): (If we had their full profiles, we'd check those too)
  }

  return entities;
}

//NOTE(self): Memory path for cached profiles
const MEMORY_SOCIAL_PATH = '.memory/social';

function ensureSocialMemoryDir(): boolean {
  try {
    if (!fs.existsSync(MEMORY_SOCIAL_PATH)) {
      fs.mkdirSync(MEMORY_SOCIAL_PATH, { recursive: true });
    }
    return true;
  } catch {
    //NOTE(self): Directory creation failed - caching will be skipped
    return false;
  }
}

//NOTE(self): Load cached profile from memory
export function loadCachedProfile(handle: string): EnrichedProfile | null {
  const safeName = handle.replace(/[^a-zA-Z0-9.-]/g, '_');
  const filePath = path.join(MEMORY_SOCIAL_PATH, `${safeName}.json`);

  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as EnrichedProfile;
    }
  } catch {
    //NOTE(self): Cache miss or corrupt file, will fetch fresh
  }

  return null;
}

//NOTE(self): Save profile to memory cache
export function cacheProfile(profile: EnrichedProfile): void {
  ensureSocialMemoryDir();
  const safeName = profile.handle.replace(/[^a-zA-Z0-9.-]/g, '_');
  const filePath = path.join(MEMORY_SOCIAL_PATH, `${safeName}.json`);

  try {
    profile.lastSeen = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
  } catch {
    //NOTE(self): Cache write failed, not critical
  }
}

//NOTE(self): Fetch and enrich profiles for mentioned entities
//NOTE(self): Cached lookups are free, only new profiles cost API calls
export async function enrichMentionedEntities(
  entities: MentionedEntity[],
  maxLookups: number = 8
): Promise<EnrichedProfile[]> {
  const profiles: EnrichedProfile[] = [];
  let lookupCount = 0;

  for (const entity of entities) {
    //NOTE(self): Check cache first
    const cached = loadCachedProfile(entity.handle);
    if (cached) {
      cached.relationship = entity.context;
      profiles.push(cached);
      continue;
    }

    //NOTE(self): Respect lookup limit for dignity
    if (lookupCount >= maxLookups) {
      continue;
    }

    //NOTE(self): Fetch fresh profile
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
  //NOTE(self): Extract mentioned entities
  const entities = extractMentionedEntities(ownerProfile, ownerFollows, timeline);

  if (entities.length === 0) {
    return '';
  }

  //NOTE(self): Prioritize bio mentions (most important) then limit
  const prioritized = [
    ...entities.filter((e) => e.source === 'bio'),
    ...entities.filter((e) => e.source === 'post'),
  ].slice(0, 5);

  //NOTE(self): Enrich with profile lookups
  const profiles = await enrichMentionedEntities(prioritized);

  //NOTE(self): Format for agent context
  return formatEnrichedContext(profiles);
}
