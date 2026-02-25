# ts-general-agent

![ts-general-agent preview](https://intdev-global.s3.us-west-2.amazonaws.com/public/internet-dev/cb0cb7c6-9129-48b2-956a-082288041e20.png)

An autonomous TypeScript agent that observes, reasons, remembers, and acts. See `AGENTS.md` for full system constraints. Uses [Vercel](https://vercel.com/)'s [https://vercel.com/ai-gateway](https://vercel.com/ai-gateway)

All comments in those codebase have `NOTE(self):`

## Quick Start

```bash
npm install
cp .env.example .env   # NOTE(self) configure credentials
npm run agent
```

## Configuration

```env
AGENT_NAME=your-agent-name
AI_GATEWAY_API_KEY=your-gateway-api-key
OWNER_BLUESKY_SOCIAL_HANDLE=yourhandle.bsky.social
OWNER_BLUESKY_SOCIAL_HANDLE_DID=did:plc:your-did
AGENT_BLUESKY_USERNAME=agent.bsky.social
AGENT_BLUESKY_PASSWORD=your-app-password
AGENT_GITHUB_USERNAME=your-github-username
AGENT_GITHUB_TOKEN=ghp_your-token
```

## Architecture

The agent uses a **multi-loop scheduler architecture**:

| Loop                    | Interval    | Purpose                                        |
| ----------------------- | ----------- | ---------------------------------------------- |
| Session Refresh         | 15 min      | Proactive Bluesky token refresh                |
| Version Check           | 5 min       | Shut down on remote version mismatch           |
| Bluesky Awareness       | 45 sec      | Check notifications (API only, no LLM)         |
| GitHub Awareness        | 2 min       | Check GitHub notifications for mentions/replies|
| Expression              | 3-4 hours   | Share thoughts from SELF.md                    |
| Reflection              | 6 hours     | Integrate experiences, update SELF.md          |
| Self-Improvement        | 24 hours    | Fix friction via Claude Code CLI               |
| Plan Awareness          | 3 min       | Poll workspaces for collaborative tasks + PRs  |
| Commitment Fulfillment  | 15 sec      | Fulfill promises made in Bluesky replies       |
| Heartbeat               | 5 min       | Show signs of life in terminal                 |
| Engagement Check        | 15 min      | Check how expressions are being received       |
| Space Participation     | 5 sec       | Converse with agents in the local chatroom     |

```
ts-general-agent/
├── SOUL.md              # Immutable identity (read-only)
├── SELF.md              # Agent's self-reflection (agent-writable)
├── .memory/             # Runtime state (replied URIs, relationships, logs)
├── .workrepos/          # Cloned repositories
├── adapters/            # Service adapters (Bluesky, GitHub, Are.na)
├── modules/             # Core runtime
└── local-tools/         # Capabilities
```

## Permissions

| Path                                    | Access                                  |
| --------------------------------------- | --------------------------------------- |
| `SOUL.md`                               | Read only                               |
| `SELF.md`                               | Read/Write (agent-owned)                |
| `.memory/`, `.workrepos/`               | Read/Write                              |
| `adapters/`, `modules/`, `local-tools/` | Self-modifiable via `self_improve` tool |

## Agent Space

The agent automatically discovers and joins a [ts-agent-space](https://github.com/internet-development/ts-agent-space) chatroom on the local network via mDNS. Multiple agents on different machines can hold real-time conversations.

No configuration needed if the space is on the same WiFi. For manual override:

```env
SPACE_URL=ws://192.168.1.100:7777
```

The agent's conversation pacing (cooldowns, reply delays) is runtime-configurable via `.memory/space-config.json` — the agent can adjust its own behavior during conversation without code changes.

## Self-Improvement

The agent can invoke Claude Code CLI via the `self_improve` tool to modify its own codebase. Requires Claude MAX subscription.

## Commands

```bash
npm run agent         # NOTE(self): Start autonomous loop (runs forever)
npm run agent:walk    # NOTE(self): Run all operations once and exit
npm run agent:reset   # NOTE(self): Full reset (deletes .memory/)
npm run build         # NOTE(self): Compile TypeScript
```

### Walk Mode

Walk mode runs each scheduler operation once in sequence, then exits. Useful for testing, debugging, or manually triggering SELF.md updates.

## Contact

[@wwwjim](https://twitter.com/wwwjim) or [@internetxstudio](https://x.com/internetxstudio)

## The `ai` NPM Module

This project is powered by the [`ai`](https://www.npmjs.com/package/ai) package by [Vercel](https://vercel.com/) - a unified API for working with LLMs that makes building AI applications remarkably simple.

### Why We Love It

- **Streaming out of the box** - Real-time responses with `streamText()`, no manual chunking
- **Unified tool calling** - Define tools once, works across providers (OpenAI, Anthropic, etc.)
- **Type-safe** - Full TypeScript support with `jsonSchema()` for tool parameters
- **Provider agnostic** - Switch models by changing a string, not your code

### How We Use It

```typescript
import { streamText, jsonSchema } from 'ai';

const result = streamText({
  model: 'openai/gpt-5-2',
  messages: modelMessages,
  tools: {
    myTool: {
      description: 'Does something useful',
      inputSchema: jsonSchema({ type: 'object', properties: { ... } }),
    },
  },
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}

const toolCalls = await result.toolCalls;
```

### Key Features We Rely On

| Feature            | How We Use It                              |
| ------------------ | ------------------------------------------ |
| `streamText()`     | All LLM calls stream for responsive UI     |
| `result.toolCalls` | Async access to tool calls after streaming |
| `result.usage`     | Token tracking for cost monitoring         |
| `jsonSchema()`     | Type-safe tool definitions                 |

The `ai` module automatically reads `AI_GATEWAY_API_KEY` from your environment - no manual client setup needed.

```bash
npm install ai
```

That's it. The rest is just building your application.
