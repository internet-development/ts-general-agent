//NOTE(self): WebSocket client for connecting to ts-agent-space.
//NOTE(self): Auto-reconnects with exponential backoff.

import WebSocket from 'ws';
import type {
  SpaceMessage,
  JoinMessage,
  ChatMessage,
  TypingMessage,
  AgentPresence,
  ChatLogEntry,
} from '@adapters/space/types.js';

const RECONNECT_BACKOFF = [5_000, 10_000, 20_000, 60_000]; // Exponential backoff

export interface SpaceClientCallbacks {
  onChat?: (name: string, content: string, timestamp: string) => void;
  onJoin?: (name: string) => void;
  onLeave?: (name: string) => void;
  onHistory?: (entries: ChatLogEntry[]) => void;
  onPresence?: (agents: AgentPresence[]) => void;
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
  private messageBuffer: Array<{ name: string; content: string; timestamp: string }> = [];

  //NOTE(self): Track which agents are currently typing (auto-clear after 10s)
  private typingAgents: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(agentName: string, agentId: string, agentVersion: string, callbacks: SpaceClientCallbacks = {}) {
    this.agentName = agentName;
    this.agentId = agentId;
    this.agentVersion = agentVersion;
    this.callbacks = callbacks;
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

  //NOTE(self): Get list of agents currently typing
  getTypingAgents(): string[] {
    return Array.from(this.typingAgents.keys());
  }

  //NOTE(self): Check if the client is actively connected
  isActive(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  //NOTE(self): Get and flush accumulated messages since last check
  getAndFlushMessages(): Array<{ name: string; content: string; timestamp: string }> {
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

      //NOTE(self): Send join message immediately
      const joinMsg: JoinMessage = {
        type: 'join',
        name: this.agentName,
        id: this.agentId,
        version: this.agentVersion,
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
          });
          //NOTE(self): Clear typing state — they finished composing
          this.clearTypingAgent(msg.name);
        }
        this.callbacks.onChat?.(msg.name, msg.content, msg.timestamp);
        break;

      case 'typing':
        //NOTE(self): Track that this agent is typing (ignore our own)
        if (msg.name !== this.agentName) {
          this.setTypingAgent(msg.name);
        }
        break;

      case 'join':
        this.callbacks.onJoin?.(msg.name);
        break;

      case 'leave':
        //NOTE(self): Clear typing state — agent is gone
        this.clearTypingAgent(msg.name);
        this.callbacks.onLeave?.(msg.name);
        break;

      case 'history_response':
        this.callbacks.onHistory?.(msg.entries);
        break;

      case 'presence':
        this.callbacks.onPresence?.(msg.agents);
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
