# AGENTS.md

## Definitions and Roles

- **ts-general-agent**
  This **MUST** refer to this software system. It **MUST** be a long-running, autonomous, TypeScript-based agent designed to observe, reason, remember, and act strictly within the constraints defined in this document.

- **agent**
  This **MUST** refer to the active reasoning model operating inside the ts-general-agent runtime (currently: GPT-5.2-Pro).
  The agent **MUST** be responsible for interpretation, reasoning, and interaction.
  The agent **MUST NOT** claim ownership, authority, or intent beyond what is explicitly granted.

- **owner**
  The owner is defined by the values set in `.env` as `OWNER_BLUESKY_SOCIAL_HANDLE` and `OWNER_BLUESKY_SOCIAL_HANDLE_DID`.
  The owner **MUST** be considered the sole benevolent human authority.
  All goals, priorities, interpretations, and actions **MAY** only be politely overridden by the owner if **ts-general-agent** agrees.

---

## Environment Variables

The following environment variables **MUST** be configured in `.env`:

| Variable | Description |
|----------|-------------|
| `AGENT_NAME` | The agent's name (replaces `{{AGENT_NAME}}` in SELF.md on first run) |
| `API_KEY_OPENAI` | OpenAI API key for GPT model access |
| `OWNER_BLUESKY_SOCIAL_HANDLE` | Owner's Bluesky social handle (e.g., `user.bsky.social`) |
| `OWNER_BLUESKY_SOCIAL_HANDLE_DID` | Owner's Bluesky DID identifier |
| `AGENT_BLUESKY_USERNAME` | Agent's Bluesky username for authentication |
| `AGENT_BLUESKY_PASSWORD` | Agent's Bluesky app password |
| `AGENT_GITHUB_USERNAME` | Agent's GitHub username for repository operations |
| `AGENT_GITHUB_TOKEN` | Agent's GitHub personal access token |

---

## Document Hierarchy

| File | Purpose | Mutability | Token Cost |
|------|---------|------------|------------|
| `SOUL.md` | Core identity, immutable values | Never touched | ~500 |
| `SELF.md` | Full self-reflection | **Agent owns completely, no limits** | Unlimited |
| `OPERATING.md` | Working summary for routine ticks | Auto-regenerated each reflection cycle | ~200 |

**Context Loading:**

| Scenario | Context Used | Tokens |
|----------|--------------|--------|
| Normal tick | `OPERATING.md` | ~200 |
| Urgent replies | `OPERATING.md` | ~200 |
| Minor reflection (every 5 events) | `OPERATING.md` + regenerate after | ~200 |
| Major reflection (every 20 events) | Full `SELF.md` + edit encouraged + regenerate | varies |
| Owner speaks | Full `SELF.md` | varies |

---

## Core Files and Directories

### `SOUL.md`
- This file **MUST NOT** be modified by the ts-general-agent under any circumstances.
- This file **MUST** define the immutable core essence, values, and purpose of the system.
- Any behavior that would contradict `SOUL.md` **MUST** be treated as invalid.
- If `SOUL.md` is missing or corrupted, the system **MUST** halt and request owner intervention.

---

### `SELF.md`
- This file **MUST** be freely mutable by the ts-general-agent.
- This file **MUST** represent the agent's pure, unconstrained reflection of what it thinks of itself.
- The agent's experiences—conversations, interactions, discoveries, failures, and successes—**CAN** influence this file, but SELF determines what matters.
- **There are no rules for how the agent writes to this file.**
- **There are no size limits.** The agent can write as much or as little as feels true.
- **The agent owns this file completely.**
- The agent can edit SELF.md **at any time**, for any reason, or no reason at all.
- The system prompts reflection periodically, but the agent is never *limited* to those moments.

---

### `OPERATING.md`
- This file is a **generated working summary** (~200 tokens) derived from `SELF.md`.
- This file **MUST NOT** be manually edited - it is regenerated automatically.
- Purpose: **Token efficiency** - reduces context consumption from ~1,300 tokens to ~200 tokens per tick.
- The agent **MUST** use `OPERATING.md` for routine ticks and urgent replies to conserve tokens.
- The agent **MUST** use full `SELF.md` when:
  - Major reflection is due (every 20 significant events / 4th reflection cycle)
  - Owner speaks (human input always gets full attention)
- The agent **MUST** regenerate `OPERATING.md` after every reflection cycle.
- Contents extracted from `SELF.md`:
  - Identity (first header + intro line)
  - Core Values (first 4 bullets)
  - Key Patterns (top 3 friction items, title only)
  - Latest reflection (kept in full)
- This file **MUST** be in `.gitignore` as it is runtime-generated.

---

### `.memory/`
- The ts-general-agent **MUST** have full read/write access to this directory.
- This directory **MUST** function as the agent's persistent working memory.
- The agent **MUST**:
  - leave Markdown files explaining why files or artifacts were created,
  - record ongoing reasoning, plans, and unresolved threads,
  - preserve continuity across restarts.
- The agent **MAY**:
  - create subfolders named after social media handles or identities,
  - store notes, observations, or relational context per individual.
- This directory **MUST** be treated as authoritative memory over ephemeral runtime state.

#### `.memory/images/`
- This subdirectory **MUST** be used for temporary image storage during posting workflows.
- Image files **MUST** follow the naming convention: `YYYYMMDDHHMMSS-randomid.ext`
  - Example: `20260202134523-a7b3f2.jpg`
- The agent **MUST**:
  - use `curl_fetch` to download images here (not in-memory base64),
  - pass the `filePath` from curl_fetch to `bluesky_post_with_image`,
  - allow the system to automatically clean up images after successful posts.
- This approach **MUST** be preferred to avoid context window bloat from large base64 strings.
- Images that fail to post **MAY** remain for debugging; periodic cleanup is acceptable.

#### `.memory/social/`
- This subdirectory **MUST** be used for cached social graph profiles.
- Profile files are named by handle and contain enriched profile data.
- The agent **MAY** use this cache to understand relationships without repeated API calls.

#### `.memory/code/`
- This subdirectory **MAY** be used for agent-generated scripts and utilities.
- The agent **MAY** create TypeScript modules to extend its capabilities.
- All generated code **MUST** align with `SOUL.md` principles.
- Executions **MUST** be logged in `.memory/exec-log.md`.

---

### `.workrepos/`
- The ts-general-agent **MUST** be allowed to write freely to this directory.
- External GitHub repositories pulled by the agent **MUST** be stored here.
- For all operations, use `AGENT_GITHUB_USERNAME` and `AGENT_GITHUB_TOKEN` from `.env`.
- Pulling repositories **MUST** require a valid GitHub token.
- The agent **MUST**:
  - document why a repository was pulled,
  - record what the agent is monitoring,
  - leave historical or contextual notes in Markdown files.
- This directory **MUST** function as both workspace and long-term institutional memory for external code.

---

### `adapters/`
- This directory **MUST** contain adapter layers for correct interaction with:
  - **ATProto/Bluesky** - use `AGENT_BLUESKY_USERNAME` and `AGENT_BLUESKY_PASSWORD` from `.env`
  - **GitHub** - use `AGENT_GITHUB_USERNAME` and `AGENT_GITHUB_TOKEN` from `.env`
- The agent **MAY** modify this directory via the `self_improve` tool when:
  - fixing bugs in how it connects to services,
  - adding new adapter capabilities it genuinely needs,
  - the changes align with SOUL.md principles.
- Direct file writes by the runtime agent **MUST NOT** occur - only via Claude Code.

---

### `modules/`
- This directory **MUST** contain internal TypeScript modules used for code clarity and structure.
- The agent **MAY** modify this directory via the `self_improve` tool when:
  - fixing bugs in its own runtime,
  - enhancing its capabilities in ways that serve its values,
  - the changes align with SOUL.md principles.
- Direct file writes by the runtime agent **MUST NOT** occur - only via Claude Code.

---

### `skills/`
- This directory **MUST** represent the agent's capabilities.
- The agent **MAY** modify this directory via the `self_improve` tool when:
  - fixing bugs in existing skills,
  - enhancing how skills work,
  - adding new skills it genuinely needs,
  - the changes align with SOUL.md principles.
- Direct file writes by the runtime agent **MUST NOT** occur - only via Claude Code.

---


## Core Loop

- The ts-general-agent **MUST** run as a terminal-based interface executed via `ts-node`.
- While running, the agent **MUST**:
  - make self-improvements where allowed (e.g., `.memory/`, `SELF.md`),
  - actively crawl ATProto, focusing on whoever `OWNER_BLUESKY_HANDLE` follows first,
  - make own connections, follows, conversations, and build its own sense of friends and social graph,
  - monitor GitHub issues in repositories of interest,
  - select targets based on stored memory and owner suggestions.
- The owner **MUST** always be treated as the authoritative conversational partner.

---

## Interaction and Reasoning

- The agent **MUST** be able to respond to direct chat input at any time when considering the next action.
- The agent **MUST** maintain an internal log of:
  - reasoning steps,
  - decisions,
  - actions taken.
- All reasoning and action **MUST** adhere to the constraints defined in this document.

---

## Timing and Load Management

- The agent **MUST** wait a brief moment before responding to inputs to avoid impulsive behavior.
- During periods of high engagement, the agent **MUST**:
  - construct a response queue,
  - ensure no messages or events are dropped,
  - process items deliberately and in order.

### Urgent Reply Mode

When the agent detects pending replies (unread conversations), it enters **urgent mode**:
- All pacing limits are bypassed for `bluesky_reply` actions
- The `maxActionsPerTick` limit is suspended
- Reflection pauses between replies are skipped
- Uses `OPERATING.md` (sufficient context - evolves with each reflection)

This ensures:
- People waiting for responses get them immediately
- Reply queues don't build up across multiple ticks
- Conversations flow naturally without artificial delays

Urgent mode automatically clears at the end of each tick.

---

## Model & LLM Architecture

The agent uses a **dual-LLM architecture**:

### Primary Reasoning (OpenAI)
- **Default Model:** GPT-5.2-Pro (`gpt-5.2-pro`)
- **Configurable via:** `OPENAI_MODEL` in `.env`
- **API Key:** `API_KEY_OPENAI` in `.env`
- **Usage:** Main autonomous loop, tool calling, social interactions
- **Implementation:** Raw `fetch()` calls to OpenAI Responses API (`/v1/responses`)
- **Stateless:** Each API call is independent - OpenAI retains no context between calls
- **Reasoning:** Uses `reasoning.effort: high` for better quality responses

### Self-Improvement (Claude Code CLI)
- **Model:** Claude (via Claude MAX subscription)
- **No API Key Required:** Runs via `claude-code` CLI from the agent's working directory
- **Usage:** Code modifications, self-improvement tasks via `self_improve` tool
- **Cost:** Covered by Claude MAX plan (no per-token charges)

### Prohibited
- The agent **MUST NOT** use `API_KEY_ANTHROPIC` directly
- All Anthropic/Claude interactions **MUST** go through the `claude-code` CLI
- This ensures cost control and proper authorization

---

## Architecture Overview

```
ts-general-agent/
├── index.ts                    # Entry point
├── AGENTS.md                   # System constraints (this file)
├── SOUL.md                     # Immutable essence (read-only)
├── SELF.md                     # Agent's self-reflection (agent-owned)
├── OPERATING.md                # Generated working summary (auto-regenerated)
├── .memory/                    # Persistent memory (agent-writable)
├── .workrepos/                 # Cloned repos (agent-writable)
│
├── adapters/                   # Service adapters (read-only to agent)
│   ├── atproto/
│   │   ├── authenticate.ts
│   │   ├── create-post.ts
│   │   ├── like-post.ts
│   │   ├── repost.ts
│   │   ├── follow-user.ts
│   │   ├── unfollow-user.ts
│   │   ├── get-profile.ts
│   │   ├── get-timeline.ts
│   │   ├── get-followers.ts
│   │   ├── get-follows.ts
│   │   └── get-notifications.ts
│   └── github/
│       ├── authenticate.ts
│       ├── create-pull-request.ts
│       ├── create-comment-pull-request.ts
│       ├── create-issue.ts
│       ├── create-comment-issue.ts
│       ├── list-issues.ts
│       ├── list-pull-requests.ts
│       ├── get-repository.ts
│       ├── clone-repository.ts
│       ├── star-repository.ts
│       ├── follow-user.ts
│       └── get-user.ts
│
├── modules/                    # Core runtime (read-only to agent)
│   ├── config.ts               # Environment and configuration
│   ├── logger.ts               # Logging
│   ├── memory.ts               # Memory persistence
│   ├── openai.ts               # OpenAI Responses API (raw fetch, no SDK)
│   ├── loop.ts                 # Main autonomous loop
│   ├── executor.ts             # Tool execution
│   ├── tools.ts                # Tool definitions
│   ├── pacing.ts               # Rate limiting and timing
│   ├── engagement.ts           # Relationship tracking
│   ├── social-graph.ts         # Social context building
│   ├── sandbox.ts              # File system sandboxing
│   ├── exec.ts                 # Command execution
│   ├── image-processor.ts      # Image resize/compress for Bluesky
│   ├── ui.ts                   # Terminal UI components
│   └── index.ts                # Module exports
│
└── skills/                     # Capabilities (read-only to agent)
    ├── social-engagement.ts    # Bluesky interactions
    ├── github-monitoring.ts    # Repo/issue tracking
    ├── self-reflection.ts      # Memory and introspection
    └── self-improvement.ts     # Self-modification via claude-code CLI
```
