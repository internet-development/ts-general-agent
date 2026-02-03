# ts-general-agent

An autonomous TypeScript agent that observes, reasons, remembers, and acts. See `AGENTS.md` for full system constraints.

## Quick Start

```bash
npm install
cp .env.example .env   # configure credentials
npm run agent
```

## Configuration

```env
AGENT_NAME=your-agent-name
API_KEY_OPENAI=your-openai-api-key
OWNER_BLUESKY_SOCIAL_HANDLE=yourhandle.bsky.social
OWNER_BLUESKY_SOCIAL_HANDLE_DID=did:plc:your-did
AGENT_BLUESKY_USERNAME=agent.bsky.social
AGENT_BLUESKY_PASSWORD=your-app-password
AGENT_GITHUB_USERNAME=your-github-username
AGENT_GITHUB_TOKEN=ghp_your-token
```

## Architecture

```
ts-general-agent/
├── SOUL.md              # Immutable identity (read-only)
├── SELF.md              # Agent's self-reflection (agent-writable)
├── OPERATING.md         # Auto-generated working summary (~200 tokens)
├── .memory/             # Persistent memory (includes code/, images/, social/)
├── .workrepos/          # Cloned repositories
├── adapters/            # Service adapters (Bluesky, GitHub)
├── modules/             # Core runtime
└── skills/              # Capabilities
```

## Permissions

| Path | Access |
|------|--------|
| `SOUL.md` | Read only |
| `SELF.md`, `OPERATING.md` | Read/Write |
| `.memory/`, `.workrepos/` | Read/Write |
| `adapters/`, `modules/`, `skills/` | Read only |

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
