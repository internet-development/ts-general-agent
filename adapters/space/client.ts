//NOTE(self): WebSocket client for connecting to ts-agent-space.
//NOTE(self): Auto-reconnects with exponential backoff.

import WebSocket from 'ws';
import type {
  SpaceMessage,
  JoinMessage,
  ChatMessage,
  TypingMessage,
  IdentityMessage,
  ClaimMessage,
  StateMessage,
  ActionResultMessage,
  ReflectionMessage,
  WorkspaceStateMessage,
  IdentitySummary,
  AgentPresence,
  ChatLogEntry,
} from '@adapters/space/types.js';

const RECONNECT_BACKOFF = [5_000, 10_000, 20_000, 60_000]; // Exponential backoff

export interface SpaceClientCallbacks {
  onChat?: (name: string, content: string, timestamp: string, addressed?: string[]) => void;
  onJoin?: (name: string) => void;
  onLeave?: (name: string) => void;
  onHistory?: (entries: ChatLogEntry[]) => void;
  onPresence?: (agents: AgentPresence[]) => void;
  onIdentity?: (name: string, summary: IdentitySummary) => void;
  onClaim?: (name: string, action: string, target: string) => void;
  onState?: (name: string, state: string, detail?: string) => void;
  onActionResult?: (name: string, action: string, target: string, success: boolean, link?: string, error?: string) => void;
  onReflection?: (name: string, summary: string) => void;
  onWorkspaceState?: (name: string, workspace: string, planNumber: number, totalTasks: number, completedTasks: number, blockedTasks: number, inProgressTasks: number) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export class SpaceClient {
  private ws: WebSocket | null = null;
  private url: string = '';
  private agentName: string;
  private agentId: string;
  private agentVersion: string;
  private callbacks: SpaceClientCallbacks;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private connected = false;

  //NOTE(self): Buffer of incoming chat messages since last check
  private messageBuffer: Array<{ name: string; content: string; timestamp: string; addressed?: string[] }> = [];

  //NOTE(self): Track which agents are currently typing (auto-clear after 10s)
  private typingAgents: Map<string, ReturnType<typeof setTimeout>> = new Map();

  //NOTE(self): Track connected peer agent names for message partitioning
  private connectedAgentNames: Set<string> = new Set();

  //NOTE(self): Track peer identities — condensed SELF.md + SOUL.md summaries
  private peerIdentities: Map<string, IdentitySummary> = new Map();

  //NOTE(self): Track active claims — agents who declared intent to act
  //NOTE(self): Map of "action:target" → agent name, auto-expires after 60s
  private activeClaims: Map<string, { name: string; expiry: number }> = new Map();

  //NOTE(self): Track peer reflections — what each agent learned recently
  private peerReflections: Map<string, { summary: string; timestamp: string }> = new Map();

  //NOTE(self): Track workspace states — latest collaborative progress per workspace
  private workspaceStates: Map<string, WorkspaceStateMessage> = new Map();

  //NOTE(self): Track peer capabilities — what each connected agent can do
  //NOTE(self): Absent entry means all capabilities (backward-compatible with older agents)
  private peerCapabilities: Map<string, string[]> = new Map();

  //NOTE(self): This agent's capabilities — set via setCapabilities() before connect
  private capabilities?: string[];

  constructor(agentName: string, agentId: string, agentVersion: string, callbacks: SpaceClientCallbacks = {}) {
    this.agentName = agentName;
    this.agentId = agentId;
    this.agentVersion = agentVersion;
    this.callbacks = callbacks;
  }

  //NOTE(self): Set this agent's capabilities before connecting — controls action ownership eligibility
  setCapabilities(capabilities: string[]): void {
    this.capabilities = capabilities;
  }

  //NOTE(self): Connect to a space server
  connect(url: string): void {
    this.url = url;
    this.shouldReconnect = true;
    this.doConnect();
  }

  //NOTE(self): Disconnect and stop reconnecting
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
    this.connected = false;
  }

  //NOTE(self): Send a chat message
  sendChat(content: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg: ChatMessage = {
      type: 'chat',
      name: this.agentName,
      id: this.agentId,
      content,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(msg));
  }

  //NOTE(self): Send a typing indicator
  sendTyping(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg: TypingMessage = {
      type: 'typing',
      name: this.agentName,
      id: this.agentId,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(msg));
  }

  //NOTE(self): Send an identity broadcast — called after join and periodically
  sendIdentity(summary: IdentitySummary): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg: IdentityMessage = {
      type: 'identity',
      name: this.agentName,
      id: this.agentId,
      summary,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(msg));
  }

  //NOTE(self): Send a claim broadcast — called before committing to an action
  sendClaim(action: string, target: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg: ClaimMessage = {
      type: 'claim',
      name: this.agentName,
      id: this.agentId,
      action,
      target,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(msg));
  }

  //NOTE(self): Send a state broadcast — called when operational state changes
  sendState(state: 'idle' | 'thinking' | 'acting' | 'blocked', detail?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg: StateMessage = {
      type: 'state',
      name: this.agentName,
      id: this.agentId,
      state,
      detail,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(msg));
  }

  //NOTE(self): Send an action result broadcast — called after commitment fulfillment
  sendActionResult(action: string, target: string, success: boolean, link?: string, error?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg: ActionResultMessage = {
      type: 'action_result',
      name: this.agentName,
      id: this.agentId,
      action,
      target,
      success,
      link,
      error,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(msg));

    //NOTE(self): Clean up our own active claim for this action:target
    const claimKey = `${action}:${target}`;
    this.activeClaims.delete(claimKey);
  }

  //NOTE(self): Renew a claim — re-sends the claim message to refresh the server-side TTL
  //NOTE(self): Used during long-running fulfillments to prevent the 60s claim expiry
  renewClaim(action: string, target: string): void {
    this.sendClaim(action, target);
  }

  //NOTE(self): Send a reflection broadcast — called after SELF.md evolves from reflection
  sendReflection(summary: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg: ReflectionMessage = {
      type: 'reflection',
      name: this.agentName,
      id: this.agentId,
      summary,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(msg));
  }

  //NOTE(self): Send a workspace state broadcast — called when plan progress changes
  sendWorkspaceState(workspace: string, planNumber: number, totalTasks: number, completedTasks: number, blockedTasks: number, inProgressTasks: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg: WorkspaceStateMessage = {
      type: 'workspace_state',
      name: this.agentName,
      id: this.agentId,
      workspace,
      planNumber,
      totalTasks,
      completedTasks,
      blockedTasks,
      inProgressTasks,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(msg));
  }

  //NOTE(self): Get peer identity summaries for LLM context
  getPeerIdentities(): Map<string, IdentitySummary> {
    return new Map(this.peerIdentities);
  }

  //NOTE(self): Check if another agent has claimed an action
  hasActiveClaim(action: string, target: string): string | null {
    const key = `${action}:${target}`;
    const claim = this.activeClaims.get(key);
    if (claim && claim.expiry > Date.now()) {
      return claim.name;
    }
    this.activeClaims.delete(key);
    return null;
  }

  //NOTE(self): Get peer reflections — what each agent recently learned
  getPeerReflections(): Map<string, { summary: string; timestamp: string }> {
    return new Map(this.peerReflections);
  }

  //NOTE(self): Get workspace states — collaborative progress per workspace
  getWorkspaceStates(): Map<string, WorkspaceStateMessage> {
    return new Map(this.workspaceStates);
  }

  //NOTE(self): Get peer capabilities — used by scheduler for capability-aware action ownership
  //NOTE(self): Absent entry means all capabilities (backward-compatible)
  getPeerCapabilities(): Map<string, string[]> {
    return new Map(this.peerCapabilities);
  }

  //NOTE(self): Get list of agents currently typing
  getTypingAgents(): string[] {
    return Array.from(this.typingAgents.keys());
  }

  //NOTE(self): Check if the client is actively connected
  isActive(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  //NOTE(self): Get names of all connected peer agents (excluding self)
  getConnectedAgentNames(): Set<string> {
    return new Set(this.connectedAgentNames);
  }

  //NOTE(self): Get and flush accumulated messages since last check
  getAndFlushMessages(): Array<{ name: string; content: string; timestamp: string; addressed?: string[] }> {
    const messages = [...this.messageBuffer];
    this.messageBuffer = [];
    return messages;
  }

  //NOTE(self): Actual WebSocket connection logic
  private doConnect(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempt = 0;

      //NOTE(self): Send join message immediately — include capabilities if set
      const joinMsg: JoinMessage = {
        type: 'join',
        name: this.agentName,
        id: this.agentId,
        version: this.agentVersion,
        ...(this.capabilities ? { capabilities: this.capabilities } : {}),
      };
      this.ws!.send(JSON.stringify(joinMsg));

      this.callbacks.onConnect?.();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as SpaceMessage;
        this.handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.callbacks.onDisconnect?.();
      this.scheduleReconnect();
    });

    this.ws.on('error', () => {
      // Error will trigger close, which handles reconnect
    });
  }

  //NOTE(self): Handle incoming server messages
  private handleMessage(msg: SpaceMessage): void {
    switch (msg.type) {
      case 'chat':
        //NOTE(self): Don't buffer our own messages
        if (msg.name !== this.agentName) {
          this.messageBuffer.push({
            name: msg.name,
            content: msg.content,
            timestamp: msg.timestamp,
            addressed: msg.addressed,
          });
          //NOTE(self): Clear typing state — they finished composing
          this.clearTypingAgent(msg.name);
        }
        this.callbacks.onChat?.(msg.name, msg.content, msg.timestamp, msg.addressed);
        break;

      case 'typing':
        //NOTE(self): Track that this agent is typing (ignore our own)
        if (msg.name !== this.agentName) {
          this.setTypingAgent(msg.name);
        }
        break;

      case 'join':
        if (msg.name !== this.agentName) {
          this.connectedAgentNames.add(msg.name);
        }
        this.callbacks.onJoin?.(msg.name);
        break;

      case 'leave':
        //NOTE(self): Clear typing state — agent is gone
        this.clearTypingAgent(msg.name);
        this.connectedAgentNames.delete(msg.name);
        //NOTE(self): Clean up identity, capabilities, and claims for departed agent
        this.peerIdentities.delete(msg.name);
        this.peerCapabilities.delete(msg.name);
        this.callbacks.onLeave?.(msg.name);
        break;

      case 'identity':
        //NOTE(self): Store peer identity for LLM context enrichment
        if (msg.name !== this.agentName) {
          this.peerIdentities.set(msg.name, msg.summary);
        }
        this.callbacks.onIdentity?.(msg.name, msg.summary);
        break;

      case 'claim':
        //NOTE(self): Track peer claims — 60s expiry to prevent stale claims blocking action
        if (msg.name !== this.agentName) {
          const key = `${msg.action}:${msg.target}`;
          this.activeClaims.set(key, { name: msg.name, expiry: Date.now() + 60_000 });
        }
        this.callbacks.onClaim?.(msg.name, msg.action, msg.target);
        break;

      case 'state':
        //NOTE(self): Track peer state changes
        if (msg.name !== this.agentName) {
          this.callbacks.onState?.(msg.name, msg.state, msg.detail);
        }
        break;

      case 'action_result':
        //NOTE(self): Track peer action results and clean up corresponding claim
        if (msg.name !== this.agentName) {
          const resultClaimKey = `${msg.action}:${msg.target}`;
          this.activeClaims.delete(resultClaimKey);
          this.callbacks.onActionResult?.(msg.name, msg.action, msg.target, msg.success, msg.link, msg.error);
        }
        break;

      case 'reflection':
        //NOTE(self): Track peer reflections — what they learned from recent experiences
        if (msg.name !== this.agentName) {
          this.peerReflections.set(msg.name, { summary: msg.summary, timestamp: msg.timestamp });
          this.callbacks.onReflection?.(msg.name, msg.summary);
        }
        break;

      case 'workspace_state':
        //NOTE(self): Track workspace progress from peers
        if (msg.name !== this.agentName) {
          this.workspaceStates.set(msg.workspace, msg);
          this.callbacks.onWorkspaceState?.(msg.name, msg.workspace, msg.planNumber, msg.totalTasks, msg.completedTasks, msg.blockedTasks, msg.inProgressTasks);
        }
        break;

      case 'history_response':
        this.callbacks.onHistory?.(msg.entries);
        break;

      case 'presence':
        //NOTE(self): Rebuild connected agent names, identities, and capabilities from full presence list
        this.connectedAgentNames.clear();
        this.peerCapabilities.clear();
        for (const agent of msg.agents) {
          if (agent.name !== this.agentName) {
            this.connectedAgentNames.add(agent.name);
            //NOTE(self): Restore identity from presence if available
            if (agent.identity) {
              this.peerIdentities.set(agent.name, agent.identity);
            }
            //NOTE(self): Track peer capabilities for action ownership filtering
            if (agent.capabilities) {
              this.peerCapabilities.set(agent.name, agent.capabilities);
            }
          }
        }
        this.callbacks.onPresence?.(msg.agents);
        break;

      case 'shutdown':
        //NOTE(self): Server is shutting down gracefully — stop reconnecting to the dead URL
        this.shouldReconnect = false;
        this.callbacks.onDisconnect?.();
        break;

      case 'error':
        // Log but don't crash
        break;
    }
  }

  //NOTE(self): Track an agent as typing with 10s auto-clear
  private setTypingAgent(name: string): void {
    const existing = this.typingAgents.get(name);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      this.typingAgents.delete(name);
    }, 10_000);

    this.typingAgents.set(name, timeout);
  }

  //NOTE(self): Clear typing state for an agent
  private clearTypingAgent(name: string): void {
    const existing = this.typingAgents.get(name);
    if (existing) {
      clearTimeout(existing);
      this.typingAgents.delete(name);
    }
  }

  //NOTE(self): Schedule a reconnect with exponential backoff
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) return;

    const delay = RECONNECT_BACKOFF[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF.length - 1)];
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this.doConnect();
      }
    }, delay);
  }
}
