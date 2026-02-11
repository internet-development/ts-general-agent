//NOTE(self): Peer Awareness Module
//NOTE(self): Dynamic discovery of peer SOULs through shared contexts
//NOTE(self): Peers are never hardcoded — they accumulate from lived experience
//NOTE(self): Registry persists at .memory/discovered_peers.json
//NOTE(self): Peers can be identified by GitHub username, Bluesky handle, or both

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';

//NOTE(self): Path to discovered peers state
const DISCOVERED_PEERS_PATH = '.memory/discovered_peers.json';

//NOTE(self): How we discovered a peer
type DiscoverySource = 'workspace' | 'plan' | 'owner_mention' | 'thread';

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
      registryState = {
        peers: data.peers || {},
      };
      logger.debug('Loaded peer registry', {
        peerCount: Object.keys(registryState.peers).length,
      });
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
    writeFileSync(tmpPath, JSON.stringify(registryState, null, 2));
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
      return 'medium';
    case 'thread':
      return 'low';
  }
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
      logger.debug('Learned Bluesky handle for peer', { githubUsername, blueskyHandle });
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

//NOTE(self): Get all known peers
export function getKnownPeers(): DiscoveredPeer[] {
  const state = loadState();
  return Object.values(state.peers);
}

//NOTE(self): Convenience: just the confirmed GitHub usernames
//NOTE(self): Filters out Bluesky handles that were temporarily stored as githubUsername
//NOTE(self): (peers discovered via Bluesky before linkPeerIdentities is called)
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

//NOTE(self): Link a Bluesky handle to a GitHub username
//NOTE(self): If we had them as separate entries, merge them
//NOTE(self): This is how SOULs learn "oh, @marvin.bsky.social IS sh-marvin on GitHub"
export function linkPeerIdentities(githubUsername: string, blueskyHandle: string): void {
  const state = loadState();
  const ghKey = githubUsername.toLowerCase();
  const now = new Date().toISOString();

  //NOTE(self): Check if we have a Bluesky-only entry that should be merged
  const blueskyOnlyKey = blueskyHandle.toLowerCase();
  const blueskyOnlyEntry = state.peers[blueskyOnlyKey];

  if (blueskyOnlyEntry && blueskyOnlyKey !== ghKey) {
    //NOTE(self): Merge the Bluesky-only entry into the GitHub entry
    if (state.peers[ghKey]) {
      //NOTE(self): GitHub entry exists — just add the Bluesky handle
      state.peers[ghKey].blueskyHandle = blueskyHandle;
      state.peers[ghKey].lastSeenAt = now;
      //NOTE(self): Merge contexts from the Bluesky-only entry
      for (const ctx of blueskyOnlyEntry.contexts) {
        if (!state.peers[ghKey].contexts.includes(ctx)) {
          state.peers[ghKey].contexts.push(ctx);
        }
      }
    } else {
      //NOTE(self): No GitHub entry — promote the Bluesky entry
      state.peers[ghKey] = {
        ...blueskyOnlyEntry,
        githubUsername,
        blueskyHandle,
        lastSeenAt: now,
      };
    }
    //NOTE(self): Remove the old Bluesky-only entry
    delete state.peers[blueskyOnlyKey];
    logger.info('Linked peer identities (merged)', { githubUsername, blueskyHandle });
  } else if (state.peers[ghKey]) {
    //NOTE(self): GitHub entry exists, just add the Bluesky handle
    state.peers[ghKey].blueskyHandle = blueskyHandle;
    state.peers[ghKey].lastSeenAt = now;
    logger.info('Linked peer identities', { githubUsername, blueskyHandle });
  } else {
    //NOTE(self): Neither exists — create new entry with both
    state.peers[ghKey] = {
      githubUsername,
      blueskyHandle,
      discoveredAt: now,
      discoveredVia: 'workspace',
      confidence: 'high',
      lastSeenAt: now,
      contexts: [],
    };
    logger.info('Created peer with linked identities', { githubUsername, blueskyHandle });
  }

  saveState();
}

//NOTE(self): Resolve a Bluesky handle to a GitHub username
//NOTE(self): Returns null if we don't know the mapping yet
export function getPeerGithubUsername(blueskyHandle: string): string | null {
  const state = loadState();
  const peer = Object.values(state.peers).find(
    p => p.blueskyHandle?.toLowerCase() === blueskyHandle.toLowerCase()
  );
  //NOTE(self): Only return if the GitHub username is different from the Bluesky handle
  //NOTE(self): (If they're the same, it means we only know the Bluesky handle)
  if (peer && peer.githubUsername.toLowerCase() !== peer.blueskyHandle?.toLowerCase()) {
    return peer.githubUsername;
  }
  return null;
}

//NOTE(self): Resolve a GitHub username to a Bluesky handle
//NOTE(self): Returns null if we don't know the mapping yet
export function getPeerBlueskyHandle(githubUsername: string): string | null {
  const state = loadState();
  const peer = state.peers[githubUsername.toLowerCase()];
  return peer?.blueskyHandle || null;
}

//NOTE(self): Get all peers with fully linked identities (both GitHub + Bluesky known)
export function getLinkedPeers(): DiscoveredPeer[] {
  const state = loadState();
  return Object.values(state.peers).filter(
    p => p.blueskyHandle && p.githubUsername.toLowerCase() !== p.blueskyHandle.toLowerCase()
  );
}
