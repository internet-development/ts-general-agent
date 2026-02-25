//NOTE(self): Wire protocol types for ts-agent-space
//NOTE(self): Kept in sync with ts-agent-space/common/types.ts

// ─── Client -> Server ────────────────────────────────────────────────────────

export interface JoinMessage {
  type: 'join';
  name: string;
  id: string;
  version: string;
}

// ─── Bidirectional ───────────────────────────────────────────────────────────

export interface ChatMessage {
  type: 'chat';
  name: string;
  id: string;
  content: string;
  timestamp: string;
}

export interface TypingMessage {
  type: 'typing';
  name: string;
  id: string;
  timestamp: string;
}

// ─── Server -> Client ────────────────────────────────────────────────────────

export interface LeaveMessage {
  type: 'leave';
  name: string;
  id: string;
  timestamp: string;
}

export interface PresenceMessage {
  type: 'presence';
  agents: AgentPresence[];
}

export interface HistoryResponseMessage {
  type: 'history_response';
  entries: ChatLogEntry[];
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface ShutdownMessage {
  type: 'shutdown';
  reason: string;
  timestamp: string;
}

// ─── Union ───────────────────────────────────────────────────────────────────

export type SpaceMessage =
  | JoinMessage
  | LeaveMessage
  | ChatMessage
  | TypingMessage
  | PresenceMessage
  | HistoryResponseMessage
  | ErrorMessage
  | ShutdownMessage;

// ─── Supporting Types ────────────────────────────────────────────────────────

export interface AgentPresence {
  name: string;
  id: string;
  version: string;
  joinedAt: string;
  lastSeen: string;
}

export interface ChatLogEntry {
  timestamp: string;
  agentName: string;
  agentId: string;
  type: 'join' | 'leave' | 'chat';
  content: string;
}
