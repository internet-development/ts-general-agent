# ts-general-agent

A long-running, autonomous TypeScript agent that exists to learn, connect, and create. For how it works, read `AGENTS.md`. `AGENTS.md` has the breakdown of how everything works.

This agent will improve once we are able to get a direct model running without having to use a hosted model that tends to throw safeguards beforehand.

## Quick Start

```bash
npm install
cp .env.example .env   # configure your credentials
npm run agent
```

## Configuration

```env
AGENT_NAME=your-agent-name
API_KEY_ANTHROPIC=your-anthropic-api-key
OWNER_BLUESKY_HANDLE=yourhandle.bsky.social
OWNER_BLUESKY_DID=did:plc:your-did
BLUESKY_USERNAME=agent.bsky.social
BLUESKY_PASSWORD=your-app-password
GITHUB_USERNAME=your-github-username
GITHUB_TOKEN=ghp_your-token
```

### Agent Identity

The `AGENT_NAME` environment variable is **required**. On first run, the agent will update `SELF.md` by replacing any `{{AGENT_NAME}}` placeholders with the configured name. This establishes the agent's identity.

## Architecture

```
ts-general-agent/
├── index.ts                    # Entry point
├── SOUL.md                     # Immutable essence
├── SELF.md                     # Agent's self-reflection
│
├── .memory/                    # Persistent memory
├── .workrepos/                 # Cloned repositories
├── .self/                      # Agent-generated code
│
├── adapters/
│   ├── atproto/                # Bluesky (raw fetch)
│   │   ├── authenticate.ts
│   │   ├── create-post.ts
│   │   ├── like-post.ts
│   │   ├── repost.ts
│   │   ├── follow-user.ts
│   │   ├── get-timeline.ts
│   │   ├── get-notifications.ts
│   │   └── ...
│   └── github/                 # GitHub (raw fetch)
│       ├── authenticate.ts
│       ├── create-pull-request.ts
│       ├── create-comment-pull-request.ts
│       ├── list-issues.ts
│       ├── clone-repository.ts
│       └── ...
│
├── modules/
│   ├── config.ts               # Environment
│   ├── logger.ts               # Logging
│   ├── memory.ts               # Persistence
│   ├── anthropic.ts            # Claude API
│   ├── exec.ts                 # Self-expansion
│   └── loop.ts                 # Autonomous loop
│
└── skills/
    ├── social-engagement.ts
    ├── github-monitoring.ts
    ├── self-reflection.ts
    └── self-improvement.ts
```

## Permissions

| Path | Agent Access |
|------|--------------|
| `SOUL.md` | Read |
| `SELF.md` | Read/Write |
| `.memory/` | Read/Write |
| `.workrepos/` | Read/Write |
| `.self/` | Read/Write/Execute |
| `adapters/` | Read/Write |
| `modules/` | Read/Write |
| `skills/` | Read/Write |

## Self-Improvement

The agent can use Claude Code to make improvements to itself. The `self-improvement.ts` skill provides:

- **Auto-detection**: Checks if Claude Code CLI is installed
- **Auto-installation**: Attempts to install via npm, Homebrew, or curl if not found
- **Safe execution**: Runs Claude Code with prompts constrained to allowed directories

```typescript
import { requestSelfImprovement } from '@skills/self-improvement.js';

await requestSelfImprovement(
  'Add a new utility function for date formatting',
  config.paths.self,
  config.paths.memory
);
```

If Claude Code is not installed, the agent will attempt installation in this order:
1. `npm install -g @anthropic-ai/claude-code`
2. `brew install claude-code`
3. `curl -fsSL https://claude.ai/install.sh | sh`

## Commands

```bash
npm run agent    # Start
npm run dev      # Development (watch mode)
```

## Questions

If you have questions ping me on Twitter, [@wwwjim](https://www.twitter.com/wwwjim). Or you can ping [@internetxstudio](https://x.com/internetxstudio).
