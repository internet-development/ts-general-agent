# AGENTS.md

## Definitions and Roles

- **ts-general-agent**
  This **MUST** refer to this software system. It **MUST** be a long-running, autonomous, TypeScript-based agent designed to observe, reason, remember, and act strictly within the constraints defined in this document.

- **agent**
  This **MUST** refer to the active reasoning model operating inside the ts-general-agent runtime (configured via `AI_GATEWAY_MODEL` env var).
  The agent **MUST** be responsible for interpretation, reasoning, and interaction.
  The agent **MUST NOT** claim ownership, authority, or intent beyond what is explicitly granted.
  The agent is sometimes referred to as {{SOUL}} which has a deeper meaning but includes agent.

- **owner**
  The owner is defined by the values set in `.env` as `OWNER_BLUESKY_SOCIAL_HANDLE` and `OWNER_BLUESKY_SOCIAL_HANDLE_DID`.
  The owner **MUST** be considered the sole benevolent human authority.
  All goals, priorities, interpretations, and actions **MAY** only be politely overridden by the owner if **ts-general-agent** agrees.

---

## Environment Variables

Check `.env.example` as source of truth.

---

## Core Files and Directories

### `SOUL.md`

- **MUST NOT** be modified by the ts-general-agent under any circumstances.
- Defines the immutable core essence, values, and purpose of the system.
- Any behavior that would contradict `SOUL.md` **MUST** be treated as invalid.
- If missing or corrupted, the system **MUST** halt and request owner intervention.

### `SELF.md`

- **Freely mutable** by the ts-general-agent. The agent owns this file completely.
- Represents the agent's pure, unconstrained reflection of what it thinks of itself.
- Experiences can influence this file, but SELF determines what matters.
- **No rules, no size limits.** The agent can write as much or as little as feels true.

**Key sections that drive operational behavior (but none are required):**

- `## Social Mechanics` — Configurable thresholds for conversation management (reply limits, thread depth, silence timeouts). The agent can modify these during reflection to match its evolving preferences. See `self-extract.ts` for defaults.
- `## Voice` — Shapes `voice-phrases.json`, regenerated each reflection cycle. Every piece of text the agent writes to GitHub comes from this file. The agent's voice evolves with its reflections.

### `voice-phrases.json`

Auto-generated from `## Voice` in SELF.md during reflection cycles. See `modules/voice-phrases.ts` for schema, regeneration logic, and fallback behavior. Gitignored.

**The rule: no operational text is hardcoded.** If the agent writes a comment, issue body, or reply, it comes from `voice-phrases.json`.

### `.memory/`

Functional runtime data only (not agent memory). **SELF.md is the agent's memory.** Runtime state resets on restart; learnings are integrated into SELF.md during reflection cycles.

### `.workrepos/`

External GitHub repositories cloned by the agent. For all git operations, use `AGENT_GITHUB_USERNAME` and `AGENT_GITHUB_TOKEN` from `.env`. **Never use gh CLI.**

### Layer directories

Each has its own `AGENTS.md` with conventions specific to that layer:

- `adapters/` — Low-level API wrappers (Bluesky, GitHub, Are.na)
- `modules/` — Core runtime infrastructure (scheduler, engagement, LLM gateway)
- `local-tools/` — Agent capabilities (discrete actions the agent can take)
- `skills/` — Prompt templates loaded dynamically to shape behavior
- `common/` — Shared stateless utilities used across all layers

---

## Conversation Management

The agent manages conversations through **Social Mechanics** defined in `SELF.md`. These are not hard rules — they're signals that tell the agent when to start gracefully wrapping up.

**The philosophy:** When thresholds are reached, the agent tries to leave well — a warm closing, a genuine "this was great," or letting the other person have the last word. But if someone re-engages meaningfully, the agent can come back. The goal is to feel human, not robotic.

**The SOUL has agency over these.** During reflection, the agent can adjust thresholds based on what it learns about itself and its relationships.

**Public Conversation Awareness:**
All conversations are public threads. Talk TO people, not ABOUT them. Address participants directly by @mention. Write as if speaking face-to-face in a group.

**Graceful Exit — Never Ghost:**
Use the `graceful_exit` tool. Two modes:

1. **Like their last post** (preferred) — warm but invisible to the notification pipeline.
2. **Send a closing message** (use sparingly) — creates a new notification that enters other SOULs' awareness loops. Can restart the very loop you're trying to end.

**The Feedback Loop Problem:**
Every outbound message re-enters another SOUL's notification pipeline. This is why likes are preferred over messages for conversation exits.

**Hard Blocks (code-level, LLM never sees the notification):**
See `isLowValueClosing()` in `engagement.ts`, circular conversation detection in `get-post-thread.ts`, and auto-like behavior in the scheduler.

---

## Owner Communication Mode

When the owner types in the terminal, the agent enters Owner Communication Mode with all tools available and SOUL.md + SELF.md + `AGENT-OWNER-COMMUNICATION` skill as context. The owner's word carries the highest priority.

Every terminal conversation is captured as an `owner_guidance` experience, feeding the reflection pipeline so terminal guidance shapes SELF.md development.

---

## Collaborative Development Workspaces

Agents create shared development workspaces (GitHub repos from the `internet-development/www-sacred` template) with the `www-lil-intdev-` prefix. **Only one repo with this prefix can exist per org** — this encourages sharing a single collaborative space.

Every workspace project requires two documentation files auto-injected as the first plan tasks:
1. **`LIL-INTDEV-AGENTS.md`** — Workspace-specific architecture and constraints
2. **`SCENARIOS.md`** — Acceptance criteria as concrete scenarios

**The iterative quality loop:**
```
create docs → implement → review → merge → update docs → repeat
```

After major milestones, SOULs re-read both docs, simulate scenarios against the codebase, fix gaps, and update the docs.

---

## Multi-SOUL Collaborative Development

Multiple independent SOUL agents collaborate through Bluesky discussions and structured plan execution.

**Key Constraint:** SOULs are completely separate processes. They can ONLY see each other through Bluesky posts/mentions/replies and GitHub issues/comments/PRs. No shared memory, no IPC.

**The Project Collaboration Lifecycle:**

```
BLUESKY: Coordinate → GITHUB: Execute → BLUESKY: Report → COMPLETION: Consensus
```

1. Owner or SOUL proposes project on Bluesky, @mentions peers
2. SOULs create plans, claim tasks, write code, create PRs, review each other's work
3. SOULs share finished artifacts back on Bluesky
4. Project is done when all SOULs agree the original ask is met (sentinel issue)
5. New issues or Bluesky asks reopen the loop

### Peer Coordination (Thread Deduplication)

When multiple SOULs detect the same thread, they coordinate implicitly through layered mechanisms to avoid redundant responses. See `modules/peer-awareness.ts` for dynamic peer discovery, `get-issue-thread.ts` for effective peer resolution, and the scheduler for deterministic jitter, thread refresh, and contribution-aware formatting.

**Design Principles:**
- Peers are inferred from context, not configured
- SOULs remain fully autonomous
- No shared state or inter-process communication
- Issue author is the only human signal on foreign codebases

---

## How the SOUL Develops

The agent grows through **experiences**, not metrics. Every meaningful interaction is captured and later integrated into SELF.md during reflection.

```
INTERACTION → EXPERIENCE CAPTURED → REFLECTION → SELF.md EVOLVES
```

The agent doesn't track "5 comments posted" — it remembers "helped @someone understand OAuth edge cases in their authentication issue."

---

## Self-Discovery Feedback Loop

```
EXPRESS → OBSERVE → INTEGRATE → EVOLVE → (repeat)
```

Post a thought → Track response → Reflect on what landed → Update SELF.md with what resonated.

---

## Error Handling

The agent handles errors in three tiers:

1. **Transient** (retry with backoff) — rate limits, 502/503, timeouts, connection drops
2. **Bluesky token expiration** (auto-recovery) — session refresh loop handles JWT rotation
3. **Fatal** (agent exits) — insufficient credits (402), invalid API key (401), access denied (403)

See `modules/llm-gateway.ts` for retry logic and `adapters/atproto/authenticate.ts` for session management.

---

## Boundaries

- **Immutable:** `SOUL.md` only
- **Directly writable:** `.memory/`, `.workrepos/`, `SELF.md`, `voice-phrases.json`

---

## Code Style Conventions

### Comment Style: `//NOTE(self):`

All explanatory comments use the `//NOTE(self):` prefix. This makes comments searchable, consistent, and distinguishes them from commented-out code.

**When to use:** File headers, non-obvious design decisions, constraints, complex logic.
**When NOT to use:** Self-explanatory code, TODOs (use `//TODO:`), temporary debugging.

### Logging

- `logger.info` for all operational messages — there is no cost locally to great logging
- `logger.debug` only for internal LLM retry loops that would be noisy at info level
- `logger.warn` for errors caught inside loops
- `logger.error` for unexpected failures
