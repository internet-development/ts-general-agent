//NOTE(self): Barrel export for space adapter

export { discoverSpace } from './discovery.js';
export { SpaceClient } from './client.js';
export type { SpaceClientCallbacks } from './client.js';
export type {
  SpaceMessage,
  JoinMessage,
  ChatMessage,
  TypingMessage,
  LeaveMessage,
  PresenceMessage,
  HistoryResponseMessage,
  ErrorMessage,
  IdentityMessage,
  ClaimMessage,
  IdentitySummary,
  AgentPresence,
  ChatLogEntry,
} from './types.js';
