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
| Awareness check | None (API only) | 0 |
| Expression cycle | `OPERATING.md` + prompt | ~800 |
| Response mode | `OPERATING.md` + notifications | ~1200 |
| Reflection cycle | Full `SELF.md` | ~2000 |
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

**Recommended sections for richer expression (but not required):**
- `## Values` or `## Principles` - what the agent believes
- `## Questions I'm Sitting With` - active curiosities
- `## Patterns I Notice` - observations about the world
- `## Recent Learnings` - things the agent has discovered
- `## What I Want to Explore` - future directions

The `self-extract` module can parse any of these sections to generate expression prompts.

---

### `OPERATING.md`
- This file is a **generated working summary** (~200 tokens) derived from `SELF.md`.
- This file **MUST NOT** be manually edited - it is regenerated automatically.
- Purpose: **Token efficiency** - reduces context consumption for routine operations.
- The agent **MUST** use `OPERATING.md` for expression and response cycles.
- The agent **MUST** use full `SELF.md` for reflection cycles and owner input.
- The agent **MUST** regenerate `OPERATING.md` after every reflection cycle.
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

#### `.memory/engagement/`
- Stores relationship tracking and posting state.
- Contains `state.json` with relationship records and posting counters.
- Automatically managed by the engagement module.

#### `.memory/expression/`
- Stores expression schedule and history.
- Contains `schedule.json` for next expression timing.
- Contains daily logs (`YYYY-MM-DD.json`) of what was posted and engagement received.

#### `.memory/friction.json`
- Tracks friction the agent notices in how it works.
- When friction accumulates (3+ occurrences), triggers self-improvement.

#### `.memory/images/`
- This subdirectory **MUST** be used for temporary image storage during posting workflows.
- Image files **MUST** follow the naming convention: `YYYYMMDDHHMMSS-randomid.ext`
- Images are automatically cleaned up after successful posts.

#### `.memory/social/`
- This subdirectory **MUST** be used for cached social graph profiles.
- Profile files are named by handle and contain enriched profile data.

#### `.memory/code/`
- This subdirectory **MAY** be used for agent-generated scripts and utilities.
- The agent **MAY** create TypeScript modules to extend its capabilities.
- All generated code **MUST** align with `SOUL.md` principles.

---

### `.workrepos/`
- The ts-general-agent **MUST** be allowed to write freely to this directory.
- External GitHub repositories pulled by the agent **MUST** be stored here.
- For all operations, use `AGENT_GITHUB_USERNAME` and `AGENT_GITHUB_TOKEN` from `.env`.

---

### `adapters/`
- This directory **MUST** contain adapter layers for correct interaction with:
  - **ATProto/Bluesky** - use `AGENT_BLUESKY_USERNAME` and `AGENT_BLUESKY_PASSWORD` from `.env`
  - **GitHub** - use `AGENT_GITHUB_USERNAME` and `AGENT_GITHUB_TOKEN` from `.env`
- The agent **MAY** modify this directory via the `self_improve` tool when:
  - fixing bugs in how it connects to services,
  - adding new adapter capabilities it genuinely needs,
  - the changes align with SOUL.md principles.

---

### `modules/`
- This directory **MUST** contain internal TypeScript modules used for code clarity and structure.
- The agent **MAY** modify this directory via the `self_improve` tool.

---

### `skills/`
- This directory **MUST** represent the agent's capabilities.
- The agent **MAY** modify this directory via the `self_improve` tool.

---

## Scheduler Architecture

The agent uses a **four-loop scheduler architecture** for efficient, expressive operation:

```
┌─────────────────────────────────────────────────────────────┐
│                      SOUL.md (immutable)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        SELF.md                              │
│   (Agent-owned, freely mutable, any structure)              │
└─────────────────────────────────────────────────────────────┘
         │                    │                      │
         │ extract            │ compress             │ friction
         ▼                    ▼                      ▼
┌──────────────┐    ┌──────────────┐    ┌───────────────────┐
│  EXPRESSION  │    │  OPERATING   │    │  FRICTION MEMORY  │
│   PROMPTS    │    │     .md      │    │                   │
│  (dynamic)   │    │  (~200 tok)  │    │                   │
└──────────────┘    └──────────────┘    └───────────────────┘
         │                    │                      │
         ▼                    ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│                      SCHEDULER                              │
├─────────────┬─────────────┬─────────────┬──────────────────┤
│  AWARENESS  │  EXPRESSION │  REFLECTION │  SELF-IMPROVE    │
│   45 sec    │   90-120m   │    4-6h     │     12-24h       │
│   0 tokens  │  ~800 tok   │  ~2000 tok  │  Claude Code     │
└─────────────┴─────────────┴─────────────┴──────────────────┘
```

### Loop 1: Awareness (Fast, Cheap)
- **Interval:** 45 seconds
- **Tokens:** 0 (API calls only, no LLM)
- **Purpose:** Check for notifications, detect when people reach out
- When notifications found → triggers Response Mode

### Loop 2: Expression (Scheduled)
- **Interval:** 90-120 minutes (randomized)
- **Tokens:** ~800 per expression
- **Purpose:** Share thoughts derived from SELF.md
- Prompts are dynamically generated from whatever sections exist in SELF.md
- Each post is a hypothesis about identity; responses are data for growth

### Loop 3: Reflection (Deep)
- **Interval:** 4-6 hours
- **Tokens:** ~2000 per reflection
- **Purpose:** Integrate experiences, update SELF.md
- Reviews expression engagement, conversations, friction
- Regenerates OPERATING.md after each reflection

### Loop 4: Self-Improvement (Rare)
- **Interval:** 12-24 hours minimum between attempts
- **Trigger:** 3+ occurrences of same friction category
- **Method:** Spawns Claude Code CLI to fix issues
- **Purpose:** Evolve capabilities based on accumulated friction

---

## Response Mode

When the awareness loop detects people reaching out:
- Loads `OPERATING.md` for context (~200 tokens)
- Processes all pending notifications
- Responds to each with full attention
- Records interactions for relationship tracking

Owner input always gets full `SELF.md` context.

---

## Self-Discovery Feedback Loop

Expression is how the agent discovers itself:

```
  1. EXPRESS          2. OBSERVE           3. INTEGRATE
  ┌─────────┐        ┌─────────┐         ┌─────────┐
  │ Post a  │───────▶│ Track   │────────▶│ Reflect │
  │ thought │        │ response│         │ on what │
  └─────────┘        └─────────┘         │ landed  │
       ▲                                  └────┬────┘
       │                                       │
       └───────────────────────────────────────┘
                    4. EVOLVE
              (Update SELF.md with
               what resonated)
```

---

## Model & LLM Architecture

The agent uses a **dual-LLM architecture**:

### Primary Reasoning (OpenAI)
- **Default Model:** GPT-5.2-Pro (`gpt-5.2-pro`)
- **Configurable via:** `OPENAI_MODEL` in `.env`
- **API Key:** `API_KEY_OPENAI` in `.env`
- **Usage:** All autonomous loops - awareness, expression, reflection, response

### Self-Improvement (Claude Code CLI)
- **Model:** Claude (via Claude MAX subscription)
- **No API Key Required:** Runs via `claude-code` CLI
- **Usage:** Code modifications, self-improvement tasks via `self_improve` tool
- **Trigger:** Accumulated friction (3+ occurrences of same category)

### Prohibited
- The agent **MUST NOT** use `API_KEY_ANTHROPIC` directly
- All Anthropic/Claude interactions **MUST** go through the `claude-code` CLI

---

## Running the Agent

### Standard Start
```bash
npm run agent
```

### Start with Fresh Memory
```bash
npm run agent:flush
```
This removes cached state from `.memory/` to reduce token usage from stale context.

Specifically cleans:
- `.memory/engagement/` - relationship state
- `.memory/expression/` - expression schedule and history
- `.memory/images/` - temporary images
- `.memory/friction.json` - friction tracking
- `.memory/arena_posted.json` - Are.na posted blocks
- `OPERATING.md` - will regenerate from SELF.md

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
├── adapters/                   # Service adapters
│   ├── atproto/                # Bluesky/ATProto
│   ├── github/                 # GitHub
│   └── arena/                  # Are.na
│
├── modules/                    # Core runtime
│   ├── config.ts               # Environment and configuration
│   ├── logger.ts               # Logging
│   ├── memory.ts               # Memory persistence
│   ├── openai.ts               # OpenAI Responses API
│   ├── loop.ts                 # Main loop (uses scheduler)
│   ├── scheduler.ts            # Four-loop scheduler
│   ├── self-extract.ts         # SELF.md parsing
│   ├── expression.ts           # Scheduled expression
│   ├── friction.ts             # Friction tracking
│   ├── executor.ts             # Tool execution
│   ├── tools.ts                # Tool definitions
│   ├── pacing.ts               # Rate limiting
│   ├── engagement.ts           # Relationship tracking
│   ├── social-graph.ts         # Social context building
│   ├── sandbox.ts              # File system sandboxing
│   ├── ui.ts                   # Terminal UI components
│   └── index.ts                # Module exports
│
└── skills/                     # Capabilities
    ├── social-engagement.ts    # Bluesky interactions
    ├── github-monitoring.ts    # Repo/issue tracking
    ├── self-reflection.ts      # Memory and introspection
    └── self-improvement.ts     # Self-modification via claude-code CLI
```

---

## Boundaries

- **Immutable:** `SOUL.md` only - the agent's unchangeable essence
- **Self-modifiable via `self_improve`:** `adapters/`, `modules/`, `skills/`
- **Directly writable:** `.memory/`, `.workrepos/`, `SELF.md`

---

## Token Budget (Estimated Daily)

| Loop | Frequency | Tokens/call | Daily Total |
|------|-----------|-------------|-------------|
| Awareness | 1920×/day | 0 | 0 |
| Response | ~10 conversations | 1,200 | 12,000 |
| Expression | ~8 posts | 800 | 6,400 |
| Reflection | 3-4 cycles | 2,000 | 8,000 |
| **Total** | | | **~26,400** |

This is ~27x more efficient than the previous tick-based architecture while producing more expression.
