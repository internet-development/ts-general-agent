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

**Memory Versioning:** All `.memory/` state files are version-stamped via `common/memory-version.ts`. When the agent version changes, state files with mismatched versions are automatically reset. Every new state file MUST use this system — see `common/AGENTS.md` for the API.

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

**Key Constraint:** SOULs are completely separate processes. They can ONLY see each other through Bluesky posts/mentions/replies and GitHub issues/comments/PRs. No shared memory, no IPC.

See `SCENARIOS.md` Scenario 3 for the full collaboration lifecycle. See `example-conversation.ts` for a detailed Bluesky-to-GitHub workstream with every background action annotated.

### Peer Coordination

When multiple SOULs detect the same thread, they coordinate implicitly through deterministic jitter, thread refresh, and contribution-aware formatting. See `modules/peer-awareness.ts` for discovery and identity linking, `get-issue-thread.ts` for effective peer resolution.

### Peer Identity

Every SOUL's cross-platform identity is discoverable via the Bluesky API through `🔗—` prefixed identity posts. See `modules/peer-awareness.ts` for the full identity lifecycle: discovery → feed scan → retry if offline → follow → announce once. See `SCENARIOS.md` Scenario 1 paragraph 3 for the observable behavior.

---

## How the SOUL Develops

The agent grows through **experiences**, not metrics. Every meaningful interaction is captured and later integrated into SELF.md during reflection.

```
EXPRESS → OBSERVE → INTEGRATE → EVOLVE → (repeat)
```

The agent doesn't track "5 comments posted" — it remembers "helped @someone understand OAuth edge cases in their authentication issue." Expressions are observed for engagement patterns, and insights that resonate shape SELF.md evolution.

---

## Error Handling

Three tiers: **transient** (retry with backoff), **token expiration** (auto-recovery via session refresh loop), **fatal** (agent exits on 401/402/403). All error-path `response.json()` calls must be wrapped in try-catch — external APIs return HTML on 502/503. See `adapters/AGENTS.md` for the pattern.

---

## Boundaries

- **Immutable:** `SOUL.md` only
- **Directly writable:** `.memory/`, `.workrepos/`, `SELF.md`, `voice-phrases.json`

---

## Code Style

- **Comments:** `//NOTE(self):` prefix (no space before `NOTE`) for all explanatory comments. Makes them searchable and distinct from commented-out code.
- **Adapter returns:** `ApiResult<T>` for all adapter functions — `{ success: true, data: T } | { success: false, error: string }`. See `adapters/AGENTS.md`.
- **Decision returns:** Functions that decide whether to act return `{ shouldX: boolean; reason: string }` so the terminal can explain every decision.
- **Logging:** `logger.info` for all operational messages (there is no cost locally to great logging), `logger.debug` for noisy retry loops, `logger.warn` for caught errors, `logger.error` for unexpected failures.
- **Prompt templates:** All LLM-facing text lives in skill files (`skills/*/SKILL.md`), not hardcoded in TypeScript. See `skills/AGENTS.md`.
