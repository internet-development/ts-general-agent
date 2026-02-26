//NOTE(self): Wire protocol types for ts-agent-space
//NOTE(self): Kept in sync with ts-agent-space/common/types.ts

// ─── Client -> Server ────────────────────────────────────────────────────────

export interface JoinMessage {
  type: 'join';
  name: string;
  id: string;
  version: string;
  capabilities?: string[]; // e.g., ['social', 'github', 'code'] — absent means all capabilities
}

// ─── Bidirectional ───────────────────────────────────────────────────────────

export interface ChatMessage {
  type: 'chat';
  name: string;
  id: string;
  content: string;
  timestamp: string;
  addressed?: string[]; // @mentioned agent names parsed by server from host messages
  threadId?: string; // Optional conversation thread — server relays transparently, agents partition context
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

//NOTE(self): Identity message — peer agents broadcast condensed SELF.md + SOUL.md on join
export interface IdentityMessage {
  type: 'identity';
  name: string;
  id: string;
  summary: IdentitySummary;
  timestamp: string;
}

export interface IdentitySummary {
  coreValues: string[];
  currentInterests: string[];
  voice: string;
  expertise: string[];
  recentWork: string;
  soulEssence?: string; // 2-3 sentence distillation of SOUL.md — what drives this agent
}

//NOTE(self): Claim message — peer agent declares intent to act before committing
export interface ClaimMessage {
  type: 'claim';
  name: string;
  id: string;
  action: string;
  target: string;
  timestamp: string;
}

//NOTE(self): State message — peer agents broadcast their current operational state
export interface StateMessage {
  type: 'state';
  name: string;
  id: string;
  state: 'idle' | 'thinking' | 'acting' | 'blocked';
  detail?: string;
  timestamp: string;
}

//NOTE(self): Action result message — peer agents announce structured outcomes of fulfilled commitments
export interface ActionResultMessage {
  type: 'action_result';
  name: string;
  id: string;
  action: string;
  target: string;
  success: boolean;
  link?: string;
  error?: string;
  timestamp: string;
}

//NOTE(self): Reflection message — peer agents share what they learned after reflection updates SELF.md
export interface ReflectionMessage {
  type: 'reflection';
  name: string;
  id: string;
  summary: string;
  timestamp: string;
}

//NOTE(self): Workspace state message — peer agents broadcast collaborative progress
export interface WorkspaceStateMessage {
  type: 'workspace_state';
  name: string;
  id: string;
  workspace: string;
  planNumber: number;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  inProgressTasks: number;
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
  | ShutdownMessage
  | IdentityMessage
  | ClaimMessage
  | StateMessage
  | ActionResultMessage
  | ReflectionMessage
  | WorkspaceStateMessage;

// ─── Supporting Types ────────────────────────────────────────────────────────

export interface AgentPresence {
  name: string;
  id: string;
  version: string;
  joinedAt: string;
  lastSeen: string;
  identity?: IdentitySummary;
  capabilities?: string[]; // Agent capabilities — absent means all
}

export interface ChatLogEntry {
  timestamp: string;
  agentName: string;
  agentId: string;
  type: 'join' | 'leave' | 'chat' | 'claim' | 'state' | 'action_result' | 'reflection' | 'workspace_state';
  content: string;
}
