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

**Memory Versioning:** All `.memory/` state files are version-stamped via `common/memory-version.ts`. When the agent version changes, most state files with mismatched versions are automatically reset. Exception: `discovered_peers.json` migrates data in-place (preserving `announcedOnBluesky`/`followedOnBluesky` flags to prevent duplicate peer announcements). Every new state file MUST use this system — see `common/AGENTS.md` for the API.

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

## Daily Rituals

Rituals are recurring structured activities conducted **over social media** — not background cron jobs. The SOUL defines them in `SELF.md` and develops them through reflection. The infrastructure reads `## Daily Rituals` from SELF.md and initiates social threads on Bluesky.

**SELF.md format:**
```markdown
## Daily Rituals

- **Name** [schedule] (workspace-repo)
  Participants: @handle1.bsky.social, @handle2.bsky.social
  Role: initiator
  Description of what this ritual involves.
```

**Flow:**
```
SELF.md defines ritual → Ritual check loop fires → Initiator posts on Bluesky tagging peers
    → Peers see mention in notification loop → Peers respond with their analysis
    → Each SOUL creates a GitHub issue (via create_memo) with formal analysis
    → Plan awareness synthesizes issues into a plan → Task execution creates PRs
```

**Conventions:**
- **Initiators** post the opening thread, tagging participants with specific questions
- **Participants** respond through normal notification processing — ritual context is injected into their system prompt when a thread is recognized as a ritual
- **Artifacts** are created via `create_memo` during the conversation, flowing into plan awareness
- **Schedule:** "daily", "weekdays", or comma-separated day names ("monday,wednesday,friday")
- **State:** `.memory/ritual_state.json` tracks initiation dates, thread URIs, and run history
- **Dedup:** `hasInitiatedToday()` prevents double-posting; ritual state persists across restarts
- **Recognition:** Participants recognize ritual threads by matching the thread's workspace against their SELF.md rituals. Once recognized, the thread URI is stored for full ritual context injection

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
- **Timer reentrancy:** All `setInterval` callbacks that call `async` functions MUST use a reentrancy guard (`runningLoops` Set in the scheduler). This includes ad-hoc callers like `requestEarlyPlanCheck()` and `forcePlanAwareness()` — every entry point to `planAwarenessCheck()` MUST check the guard. `setInterval` fires regardless of whether the previous callback finished — without a guard, concurrent executions cause duplicate posts and duplicate GitHub comments. See `modules/scheduler.ts` for the pattern.
- **Outbound dedup:** ALL Bluesky posts — including replies, expressions, image shares, closing messages, and fulfillment links — MUST flow through `outbound-queue.ts`. No direct `atproto.createPost()` calls that bypass the outbound queue. The dedup check and recording MUST happen inside the same mutex-protected section to prevent TOCTOU races. Two dedup layers: (1) time-windowed ring buffer (`recentPosts`, 5-min window) for rapid-fire prevention; (2) feed-sourced content set (`feedTexts`, no expiry) for cross-restart prevention — populated from the agent's own Bluesky feed during `startupFeedWarmup`. The feed is the source of truth, not disk state.
- **Startup feed warmup:** On startup, one feed fetch (50 items) serves four purposes: identity post check, outbound dedup warmup, expression schedule warmup, and immediate duplicate pruning. The expression schedule's `lastExpression` is derived from the most recent top-level post in the feed, so the 3-4h interval is respected across restarts. Duplicates are deleted before any loops start — the owner never sees them. See `startupFeedWarmup()` in `scheduler.ts`.
- **GitHub claim dedup:** Task claims use a disk-persisted lock (`.memory/claimed_tasks.json`) set synchronously BEFORE any async work. This prevents TOCTOU races where two concurrent callers both pass the check before either records. Before posting a claim comment, existing issue comments are checked for duplicates. See `local-tools/self-task-claim.ts`.
- **Feed pruning:** Two passes, both in `outbound-queue.ts`, running on startup AND every 15 minutes:
  - `pruneDuplicatePosts` — exact-text duplicate deletion. Top-level grouped by normalized text; replies grouped by normalized text + thread root URI. Duplicates deleted regardless of engagement. Oldest kept.
  - `pruneThankYouChains` — groups the agent's own replies by thread root, applies `isLowValueClosing()` from `engagement.ts` to each, keeps only the first closing per thread and deletes the rest. Prevents "thank you tennis" from accumulating on the feed.
- **Bluesky conversation tracking:** Every conversation the agent responds to MUST be tracked via `trackConversation()` in `bluesky-engagement.ts`. When the agent posts a reply, `recordOurReply()` MUST be called to increment `ourReplyCount`. Without this, `maxRepliesBeforeExit`, rapid back-and-forth detection, the output self-check, re-engagement caps, and conversation conclusion all fail silently. The scheduler tracks conversations when processing notifications; `handleBlueskyReply` records replies and performs the output self-check.
- **Output self-check (prevention > pruning):** `handleBlueskyReply()` runs `isLowValueClosing()` on the agent's OWN reply text before posting. If the agent has already replied once (`ourReplyCount >= 1`) and the new reply is a closing/acknowledgment, it auto-converts to a like — warm acknowledgment without noise. This is the primary prevention mechanism. Pruning (`pruneDuplicatePosts`, `pruneThankYouChains`) is the safety net that catches anything that slipped through. The philosophy: don't post it in the first place, rather than cleaning up after.
- **GitHub comments:** MUST NOT include the agent's username or self-identification — the GitHub UI already shows the author. Voice phrases use `{{details}}` for content, not `{{username}}` footers.
