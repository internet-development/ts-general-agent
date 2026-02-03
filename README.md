# ts-general-agent

An autonomous TypeScript agent that observes, reasons, remembers, and acts. See `AGENTS.md` for full system constraints.

## Quick Start

```bash
npm install
cp .env.example .env   # configure credentials
npm run agent
```

## Dependencies

This project uses the [`ai`](https://www.npmjs.com/package/ai) package by Vercel for streaming LLM responses. The AI Gateway API key is automatically used by the `ai` module.

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

The agent uses a **four-loop scheduler architecture**:

| Loop | Interval | Purpose |
|------|----------|---------|
| Awareness | 45 sec | Check notifications (API only, no LLM) |
| Expression | 90-120 min | Share thoughts from SELF.md |
| Reflection | 4-6 hours | Integrate experiences, update SELF.md |
| Self-Improvement | 12-24 hours | Fix friction via Claude Code CLI |

```
ts-general-agent/
├── SOUL.md              # Immutable identity (read-only)
├── SELF.md              # Agent's self-reflection (agent-writable)
├── .memory/             # Runtime state (replied URIs, relationships, logs)
├── .workrepos/          # Cloned repositories
├── adapters/            # Service adapters (Bluesky, GitHub, Are.na)
├── modules/             # Core runtime
└── skills/              # Capabilities
```

## Permissions

| Path | Access |
|------|--------|
| `SOUL.md` | Read only |
| `SELF.md` | Read/Write (agent-owned) |
| `.memory/`, `.workrepos/` | Read/Write |
| `adapters/`, `modules/`, `skills/` | Self-modifiable via `self_improve` tool |

## Self-Improvement

The agent can invoke Claude Code CLI via the `self_improve` tool to modify its own codebase. Requires Claude MAX subscription.

## Commands

```bash
npm run agent         # Start autonomous loop (runs forever)
npm run agent:walk    # Run all operations once and exit
npm run agent:reset   # Full reset (deletes .memory/)
npm run build         # Compile TypeScript
```

### Walk Mode

Walk mode runs each scheduler operation once in sequence, then exits. Useful for testing, debugging, or manually triggering SELF.md updates.

## Contact

[@wwwjim](https://twitter.com/wwwjim) or [@internetxstudio](https://x.com/internetxstudio)
