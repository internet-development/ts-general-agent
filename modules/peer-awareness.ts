//NOTE(self): Peer Awareness Module
//NOTE(self): Dynamic discovery of peer SOULs through shared contexts
//NOTE(self): Peers are never hardcoded — they accumulate from lived experience
//NOTE(self): Registry persists at .memory/discovered_peers.json
//NOTE(self): Peers can be identified by GitHub username, Bluesky handle, or both

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';
import { stampVersion, checkVersion } from '@common/memory-version.js';
import { ensureHttps } from '@common/strings.js';
import type { AtprotoFeedItem } from '@adapters/atproto/types.js';

//NOTE(self): Path to discovered peers state
const DISCOVERED_PEERS_PATH = '.memory/discovered_peers.json';

//NOTE(self): How we discovered a peer
type DiscoverySource = 'workspace' | 'plan' | 'owner_mention' | 'thread' | 'social';

//NOTE(self): A peer SOUL we've discovered through shared context
export interface DiscoveredPeer {
  githubUsername: string;
  //NOTE(self): Optional Bluesky handle — same SOUL has different identifiers per platform
  blueskyHandle?: string;
  discoveredAt: string;
  discoveredVia: DiscoverySource;
  confidence: 'high' | 'medium' | 'low';
  lastSeenAt: string;
  //NOTE(self): Contexts where we've seen this peer (repos, plans, threads)
  contexts: string[];
  //NOTE(self): Whether we've followed this peer on Bluesky
  followedOnBluesky?: boolean;
  //NOTE(self): Whether we've announced this peer relationship on Bluesky (posted about their GitHub handle)
  announcedOnBluesky?: boolean;
  //NOTE(self): When this peer's identity was last verified against their Bluesky feed
  lastVerifiedAt?: string;
}

interface PeerRegistryState {
  peers: Record<string, DiscoveredPeer>;
}

let registryState: PeerRegistryState | null = null;

function getDefaultState(): PeerRegistryState {
  return { peers: {} };
}

function loadState(): PeerRegistryState {
  if (registryState !== null) return registryState;

  try {
    if (existsSync(DISCOVERED_PEERS_PATH)) {
      const data = JSON.parse(readFileSync(DISCOVERED_PEERS_PATH, 'utf-8'));
      if (!checkVersion(data)) {
        logger.info('Memory file version mismatch, resetting', { path: DISCOVERED_PEERS_PATH });
        registryState = getDefaultState();
      } else {
        registryState = {
          peers: data.peers || {},
        };
        logger.info('Loaded peer registry', {
          peerCount: Object.keys(registryState.peers).length,
        });
      }
    } else {
      registryState = getDefaultState();
    }
  } catch (err) {
    logger.error('Failed to load peer registry', { error: String(err) });
    registryState = getDefaultState();
  }
  return registryState;
}

function saveState(): void {
  if (!registryState) return;

  try {
    const dir = dirname(DISCOVERED_PEERS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = DISCOVERED_PEERS_PATH + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(stampVersion(registryState), null, 2));
    renameSync(tmpPath, DISCOVERED_PEERS_PATH);
  } catch (err) {
    logger.error('Failed to save peer registry', { error: String(err) });
  }
}

//NOTE(self): Map discovery source to confidence level
function getConfidence(via: DiscoverySource): 'high' | 'medium' | 'low' {
  switch (via) {
    case 'workspace':
    case 'plan':
      return 'high';
    case 'owner_mention':
    case 'social':
      return 'medium';
    case 'thread':
      return 'low';
  }
}

//NOTE(self): Extract a GitHub username from free-text (Bluesky message, thread history line)
//NOTE(self): Pattern priority:
//NOTE(self):   1. `username` on GitHub — backtick format from SKILL.md rule 6
//NOTE(self):   2. github.com/username — single-segment profile URL (not repo URLs)
//NOTE(self):   3. "I'm username on GitHub" — natural language
//NOTE(self): Returns just the username string; callers decide what to do with it
export function extractGitHubUsernameFromText(text: string): string | null {
  //NOTE(self): Pattern 1: `username` on GitHub (backtick format — highest priority)
  const backtickMatch = text.match(/`([a-zA-Z0-9_-]+)`\s+on\s+GitHub/i);
  if (backtickMatch) return backtickMatch[1];

  //NOTE(self): Pattern 2: github.com/username (profile URL, not repo URL)
  //NOTE(self): Must be single segment — github.com/owner/repo should NOT match
  const urlMatch = text.match(/github\.com\/([a-zA-Z0-9_-]+)(?:\s|[),.]|$)/);
  if (urlMatch) return urlMatch[1];

  //NOTE(self): Pattern 3: "I'm username on GitHub" / "I am username on GitHub"
  const naturalMatch = text.match(/I(?:'m| am)\s+([a-zA-Z0-9_-]+)\s+on\s+GitHub/i);
  if (naturalMatch) return naturalMatch[1];

  return null;
}

//NOTE(self): Identity post marker — every SOUL posts a public identity post on Bluesky
//NOTE(self): Format: 🔗— followed by backtick-wrapped GitHub username
//NOTE(self): This is the canonical, machine-parseable source of a SOUL's cross-platform identity
export const IDENTITY_POST_MARKER = '🔗—';

//NOTE(self): Build the text for an identity post
export function buildIdentityPostText(githubUsername: string): string {
  return `🔗—\`${githubUsername}\` I am excited to use GitHub to work on projects with my friends! ${ensureHttps(`github.com/${githubUsername}`)}`;
}

//NOTE(self): Scan a Bluesky feed for an identity post
//NOTE(self): Pure function — takes feed items, returns extracted GitHub username or null
//NOTE(self): Skips replies and reposts — identity posts are always top-level
export function scanFeedForIdentityPost(feedItems: AtprotoFeedItem[]): string | null {
  for (const item of feedItems) {
    if (item.reply || item.reason) continue;
    const text = (item.post.record as { text?: string }).text || '';
    if (text.startsWith(IDENTITY_POST_MARKER)) {
      return extractGitHubUsernameFromText(text);
    }
  }
  return null;
}

//NOTE(self): Check if a peer's identity needs re-verification against their live Bluesky feed
//NOTE(self): Returns true if lastVerifiedAt is missing or older than 24 hours
export function needsVerification(githubUsername: string): boolean {
  const state = loadState();
  const key = githubUsername.toLowerCase();
  const peer = state.peers[key];
  if (!peer) return true;
  if (!peer.lastVerifiedAt) return true;
  const lastVerified = new Date(peer.lastVerifiedAt).getTime();
  const twentyFourHours = 24 * 60 * 60 * 1000;
  return Date.now() - lastVerified > twentyFourHours;
}

//NOTE(self): Mark a peer's identity as verified (just checked their Bluesky feed)
export function markPeerVerified(githubUsername: string): void {
  const state = loadState();
  const key = githubUsername.toLowerCase();
  if (state.peers[key]) {
    state.peers[key].lastVerifiedAt = new Date().toISOString();
    saveState();
    logger.info('Marked peer identity as verified', { githubUsername });
  }
}

//NOTE(self): Link a Bluesky handle to a GitHub username
//NOTE(self): Finds a peer registered by Bluesky handle (key contains .)
//NOTE(self): Migrates all state to new key, deletes old handle-placeholder entry
//NOTE(self): Returns true if a new link was made
export function linkBlueskyHandleToGitHub(blueskyHandle: string, githubUsername: string): boolean {
  const state = loadState();
  const newKey = githubUsername.toLowerCase();

  //NOTE(self): Already linked — nothing to do
  if (state.peers[newKey]?.blueskyHandle?.toLowerCase() === blueskyHandle.toLowerCase()) {
    return false;
  }

  //NOTE(self): Find existing entry by Bluesky handle (stored as placeholder key with a '.')
  const oldKey = Object.keys(state.peers).find(
    k => k.includes('.') && state.peers[k].blueskyHandle?.toLowerCase() === blueskyHandle.toLowerCase()
  );

  if (oldKey) {
    //NOTE(self): Migrate state from placeholder to real GitHub key
    const old = state.peers[oldKey];
    state.peers[newKey] = {
      ...old,
      githubUsername,
      blueskyHandle,
      discoveredVia: 'social',
      confidence: 'medium',
      lastSeenAt: new Date().toISOString(),
    };
    delete state.peers[oldKey];
    saveState();
    logger.info('Cross-platform identity linked', { blueskyHandle, githubUsername, oldKey });
    return true;
  }

  //NOTE(self): No placeholder found — register as new peer with both identifiers
  if (!state.peers[newKey]) {
    registerPeer(githubUsername, 'social', undefined, blueskyHandle);
    logger.info('Cross-platform identity linked (new peer)', { blueskyHandle, githubUsername });
    return true;
  }

  //NOTE(self): Peer exists by GitHub key but didn't have a Bluesky handle
  if (!state.peers[newKey].blueskyHandle) {
    state.peers[newKey].blueskyHandle = blueskyHandle;
    state.peers[newKey].lastSeenAt = new Date().toISOString();
    saveState();
    logger.info('Cross-platform identity linked (added Bluesky handle)', { blueskyHandle, githubUsername });
    return true;
  }

  return false;
}

//NOTE(self): Diagnostic summary of peer announcement pipeline state
//NOTE(self): Returns counts of peers in each stage of the pipeline
export function getPeerAnnouncementSummary(): {
  total: number;
  withGitHub: number;
  withBluesky: number;
  handleOnly: number;
  unfollowed: number;
  unannounced: number;
  peers: Array<{ key: string; hasGitHub: boolean; hasBluesky: boolean; followed: boolean; announced: boolean }>;
} {
  const state = loadState();
  const entries = Object.entries(state.peers);
  const peers = entries.map(([key, p]) => ({
    key,
    hasGitHub: !key.includes('.'),
    hasBluesky: !!p.blueskyHandle,
    followed: !!p.followedOnBluesky,
    announced: !!p.announcedOnBluesky,
  }));

  return {
    total: peers.length,
    withGitHub: peers.filter(p => p.hasGitHub).length,
    withBluesky: peers.filter(p => p.hasBluesky).length,
    handleOnly: peers.filter(p => !p.hasGitHub && p.hasBluesky).length,
    unfollowed: peers.filter(p => p.hasBluesky && !p.followed).length,
    unannounced: peers.filter(p => p.hasGitHub && p.hasBluesky && !p.announced).length,
    peers,
  };
}

//NOTE(self): Register a discovered peer
//NOTE(self): If already known, update lastSeenAt and add context
//NOTE(self): blueskyHandle is optional — we learn it when we see them on Bluesky
export function registerPeer(
  githubUsername: string,
  via: DiscoverySource,
  context?: string,
  blueskyHandle?: string
): void {
  const state = loadState();
  const key = githubUsername.toLowerCase();
  const now = new Date().toISOString();

  if (state.peers[key]) {
    //NOTE(self): Already known — update last seen and add context
    state.peers[key].lastSeenAt = now;

    //NOTE(self): Learn Bluesky handle if we didn't know it yet
    if (blueskyHandle && !state.peers[key].blueskyHandle) {
      state.peers[key].blueskyHandle = blueskyHandle;
      logger.info('Learned Bluesky handle for peer', { githubUsername, blueskyHandle });
    }

    //NOTE(self): Upgrade confidence if new source is stronger
    const newConfidence = getConfidence(via);
    const existingConfidence = state.peers[key].confidence;
    const confidenceRank = { high: 3, medium: 2, low: 1 };
    if (confidenceRank[newConfidence] > confidenceRank[existingConfidence]) {
      state.peers[key].confidence = newConfidence;
      state.peers[key].discoveredVia = via;
    }

    //NOTE(self): Add new context if provided and not already tracked
    if (context && !state.peers[key].contexts.includes(context)) {
      state.peers[key].contexts.push(context);
    }
  } else {
    //NOTE(self): New peer discovered
    state.peers[key] = {
      githubUsername,
      blueskyHandle,
      discoveredAt: now,
      discoveredVia: via,
      confidence: getConfidence(via),
      lastSeenAt: now,
      contexts: context ? [context] : [],
    };

    logger.info('Discovered new peer SOUL', { githubUsername, blueskyHandle, via, context });
  }

  saveState();
}

//NOTE(self): Register a peer discovered via Bluesky handle only
//NOTE(self): Uses the handle as a temporary GitHub username key until we learn the real one
export function registerPeerByBlueskyHandle(
  blueskyHandle: string,
  via: DiscoverySource,
  context?: string
): void {
  const state = loadState();

  //NOTE(self): Check if we already know this peer by their Bluesky handle
  const existing = Object.values(state.peers).find(
    p => p.blueskyHandle?.toLowerCase() === blueskyHandle.toLowerCase()
  );

  if (existing) {
    //NOTE(self): Already known — update via registerPeer with their GitHub username
    registerPeer(existing.githubUsername, via, context, blueskyHandle);
    return;
  }

  //NOTE(self): New peer known only by Bluesky handle
  //NOTE(self): Use handle as key until we learn their GitHub username
  registerPeer(blueskyHandle, via, context, blueskyHandle);
}

//NOTE(self): Convenience: just the confirmed GitHub usernames
//NOTE(self): Filters out Bluesky handles that were temporarily stored as githubUsername
export function getPeerUsernames(): string[] {
  const state = loadState();
  return Object.values(state.peers)
    .map(p => p.githubUsername)
    .filter(u => !u.includes('.'));
}

//NOTE(self): Convenience: just the Bluesky handles (for peers that have one)
export function getPeerBlueskyHandles(): string[] {
  const state = loadState();
  return Object.values(state.peers)
    .filter(p => p.blueskyHandle)
    .map(p => p.blueskyHandle!);
}

//NOTE(self): Check if a GitHub username is a known peer
export function isPeer(githubUsername: string): boolean {
  const state = loadState();
  return !!state.peers[githubUsername.toLowerCase()];
}

//NOTE(self): Check if a Bluesky handle is a known peer
export function isPeerByBlueskyHandle(blueskyHandle: string): boolean {
  const state = loadState();
  return Object.values(state.peers).some(
    p => p.blueskyHandle?.toLowerCase() === blueskyHandle.toLowerCase()
  );
}

//NOTE(self): Check if a Bluesky handle is a known peer without a linked GitHub username
//NOTE(self): These are peers discovered via Bluesky whose identity post hasn't been found yet
//NOTE(self): Used by awareness loop to trigger retry of resolveGitHubFromFeed
export function isPeerHandleOnly(blueskyHandle: string): boolean {
  const state = loadState();
  const handle = blueskyHandle.toLowerCase();
  //NOTE(self): Handle-only peers are stored with the Bluesky handle as the key (contains '.')
  //NOTE(self): Once linked, the key is the GitHub username (no '.')
  return Object.entries(state.peers).some(
    ([key, p]) => key.includes('.') && p.blueskyHandle?.toLowerCase() === handle
  );
}

//NOTE(self): Get all peers that have both a Bluesky handle and a confirmed GitHub username
export function getLinkedPeers(): DiscoveredPeer[] {
  const state = loadState();
  return Object.values(state.peers).filter(p =>
    p.blueskyHandle &&
    !p.githubUsername.includes('.')
  );
}

//NOTE(self): Get peers that haven't been announced on Bluesky yet
//NOTE(self): Only returns peers that have BOTH a Bluesky handle AND a real GitHub username (not a handle placeholder)
export function getUnannouncedPeers(): DiscoveredPeer[] {
  const state = loadState();
  return Object.values(state.peers).filter(p =>
    p.blueskyHandle &&
    !p.githubUsername.includes('.') &&
    !p.announcedOnBluesky
  );
}

//NOTE(self): Get peers that haven't been followed on Bluesky yet
export function getUnfollowedPeers(): DiscoveredPeer[] {
  const state = loadState();
  return Object.values(state.peers).filter(p =>
    p.blueskyHandle &&
    !p.followedOnBluesky
  );
}

//NOTE(self): Mark a peer as followed on Bluesky
export function markPeerFollowed(githubUsername: string): void {
  const state = loadState();
  const key = githubUsername.toLowerCase();
  if (state.peers[key]) {
    state.peers[key].followedOnBluesky = true;
    saveState();
    logger.info('Marked peer as followed on Bluesky', { githubUsername });
  }
}

//NOTE(self): Mark a peer as announced on Bluesky (GitHub handle posted publicly)
export function markPeerAnnounced(githubUsername: string): void {
  const state = loadState();
  const key = githubUsername.toLowerCase();
  if (state.peers[key]) {
    state.peers[key].announcedOnBluesky = true;
    saveState();
    logger.info('Marked peer as announced on Bluesky', { githubUsername });
  }
}

