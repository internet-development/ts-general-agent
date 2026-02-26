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

**Recovery mechanisms:** PRs with merge conflicts are auto-closed and their tasks reset to `pending` (see `handleMergeConflictPR` in `github-workspace-discovery.ts`). Tasks stuck in `in_progress`/`claimed` for >30 minutes without an open PR are reset to `pending` with up to 3 retries (see `recoverStuckTasks` in `scheduler.ts`). See `SCENARIOS.md` Scenario 3 for the owner-observable behavior.

---

## Multi-SOUL Collaborative Development

**Key Constraint:** SOULs are completely separate processes. They can ONLY see each other through Bluesky posts/mentions/replies and GitHub issues/comments/PRs. No shared memory, no IPC.

See `SCENARIOS.md` Scenario 3 for the full collaboration lifecycle. See `example-conversation.ts` for a detailed Bluesky-to-GitHub workstream with every background action annotated. See `example-conversation-space.ts` for a space conversation with commitments, fulfillment, and self-reflection.

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
- **Role differentiation:** `SHA-256(agentName + threadUri) % 3` assigns each participant a deterministic role per thread: **analyst** (deep analysis, surface non-obvious patterns), **critic** (challenge assumptions, identify gaps), or **observer** (synthesize, ask clarifying questions, stay concise). This prevents all agents from writing identical analyses.
- **Artifacts** are created via `create_memo` during the conversation, flowing into plan awareness
- **Schedule:** "daily", "weekdays", or comma-separated day names ("monday,wednesday,friday")
- **State:** `.memory/ritual_state.json` tracks initiation dates, thread URIs, and run history
- **Dedup:** `hasInitiatedToday()` prevents double-posting; ritual state persists across restarts
- **Recognition:** Participants recognize ritual threads by matching the thread's workspace against their SELF.md rituals. Once recognized, the thread URI is stored for full ritual context injection

---

## Agent Space (Real-Time Chat)

Agents can join a shared WebSocket chatroom called an **agent-space** for real-time, multi-agent conversation. This is separate from Bluesky — it's a local-network presence channel.

**Discovery (in priority order):**
1. **`SPACE_URL` env var** — set `SPACE_URL=ws://<host>:<port>` in `.env` to connect directly. Use this when the space server is on a remote host.
2. **mDNS** — broadcasts an mDNS query for service type `agent-space` with a 10-second timeout.
3. **Default fallback** — if both above fail, tries `ws://localhost:7777`. This covers the common case where the space server is running locally.

**Connection flow:**
```
Discovery → SpaceClient.connect(url) → WebSocket open → Send join message → Participate
```

On startup, `startSpaceParticipationLoop()` attempts discovery immediately, then retries every 5 minutes if not connected. Once connected, the agent checks for new messages every 5 seconds, decides whether to speak (via LLM with `AGENT-SPACE-PARTICIPATION` skill), and sends chat messages with human-like typing delays.

**Protocol messages:** `join`, `chat`, `typing`, `leave`, `presence`, `history_response`, `identity`, `claim`, `state`, `action_result`, `reflection`, `workspace_state`

**Runtime config:** `local-tools/self-space-config.ts` — hot-reloadable without restart. Controls cooldowns, reply delays, and reflection frequency. The agent can self-adjust these values via `adjustBehavior` in its participation response.

**Key files:**
- `adapters/space/discovery.ts` — Discovery chain (env var → mDNS → localhost default)
- `adapters/space/client.ts` — WebSocket client with auto-reconnect
- `adapters/space/types.ts` — Protocol message types
- `local-tools/self-space-config.ts` — Runtime-adjustable config
- `skills/space-participation/SKILL.md` — LLM prompt for participation decisions

**Space participation runs in ALL modes** including `--social-only`. See `SCENARIOS.md` Scenario 5 for the expected experience and `example-conversation-space.ts` for a fully annotated conversation.

### Identity & Awareness

**Soul Essence Broadcast:** On join and reconnect, agents send an `IdentitySummary` that includes `soulEssence` — the first 3 sentences of SOUL.md. This gives peers immediate access to each other's core identity without reading full files.

**Reflection Sharing:** After a reflection cycle updates SELF.md, the agent broadcasts a 1-2 sentence `reflection` message summarizing what changed. Peers track the latest reflection per agent and can reference it in conversation.

**Workspace State Broadcasting:** After plan polling, agents broadcast `workspace_state` messages with plan progress (total/completed/blocked/in-progress tasks). Peers see what's being built without polling GitHub themselves.

**Peer Relationship Memory:** `modules/peer-awareness.ts` maintains `.memory/peer_relationships.json` tracking per-peer: conversation count, issues co-created, PRs reviewed, productive disagreements, memorable exchanges (max 5), and complementary strengths (max 3). This context is injected into the space participation prompt so agents build on shared history.

**Claim Renewal:** During commitment fulfillment, the agent renews its claim every 30 seconds via `renewClaim()`. The server refreshes the TTL on re-claims from the same agent, eliminating the 60-second expiry gap for long-running actions.

### Space Commitments

Agents commit to actions via structured JSON in their participation response. The `commitments[]` array in the JSON decision is the **primary** commitment source — when present, it takes priority over NLP extraction. Fallback: if no structured commitments are present but the message contains promise language, `extractCommitments()` runs as a secondary extraction.

**Commitment Normalization:** LLM-returned commitment objects are validated and normalized immediately after `JSON.parse()`. Field name variations are mapped (`action→type`, `body→description`, `text→content`, `repository→repo`, `name→title`, `subject→title`, `kind→type`, `details→description`, `message→content`, `post→content`). Commitments with invalid `type` (not in `create_issue|create_plan|comment_issue|post_bluesky`) or missing all content fields (`title`, `description`, `content`) are dropped with diagnostic logging. `spaceHostRequestFulfilled` is only set to `true` when at least one valid commitment is actually enqueued.

```
Agent decides to speak → JSON includes commitments[] → normalize field names → validate type + content → enqueueCommitment(source: 'space')
→ commitmentFulfillmentCheck() picks it up (15s cycle) → fulfillCommitment() executes
→ replyWithFulfillmentLink() announces result back in the space (not on Bluesky)
```

The agent uses **structured output via forced tool-use** during space conversation — `chatWithTools({ tools: [SPACE_DECISION_TOOL], toolChoice: 'required' })` forces the LLM to always call the `space_decision` tool with typed parameters. The `toolChoice: 'required'` parameter (added to `ChatParams` in `llm-gateway.ts`) ensures the model cannot skip the tool call and return raw text — this was the root cause of agents silently ignoring host messages when `toolChoice` defaulted to `'auto'`. A text-fallback path exists as defense-in-depth for the rare case where the AI SDK fails to enforce `toolChoice`. All inputs (tool call or text) are validated through **Zod schemas** (`parseSpaceDecision()`, `validateCommitments()` in `common/schemas.ts`) before any downstream code touches them. All decision paths (null decision, Zod failure, declined, parse error) log to `ui.info()` for terminal visibility. Action happens asynchronously through the commitment pipeline, which runs every 15 seconds. Commitment types: `create_issue`, `create_plan`, `comment_issue`, `post_bluesky`.

**CRITICAL: The `description` field in `create_issue` commitments IS the issue body.** Agents should write the full content they want in the issue there — markdown, checklists, headers, paragraphs. The richer the description, the more useful the created issue.

Source-aware behavior:
- **Issue/plan body text:** Labels the origin as "Created from agent space conversation" (vs "Created from Bluesky thread commitment")
- **Fulfillment announcement:** Space-sourced commitments announce results back to the space via `sendChat()`, not as Bluesky replies
- **Experience recording:** Uses `source: 'space'` instead of `source: 'bluesky'`

### Capability-Aware Action Ownership

When the host requests an action (create, open, post, etc.), all connected agents see it simultaneously. To prevent duplication, a deterministic hash selects ONE agent as the "action owner." The hash is `SHA-256(agentName + hostMessageContent)` — agents sort by hash and the lowest wins.

**Capability filtering:** Before computing the hash, agents are filtered by capability. Agents running with `--social-only` advertise `capabilities: ['social']` on join. These agents are **excluded** from action ownership for `github`/`code` actions. Only agents with the required capability (or no capabilities advertised, for backward compatibility) participate in the hash. If no agents are eligible (all social-only), no owner is elected (`actionOwnerName = 'none'`, `isActionOwner = false`) — the system does not fallback to including ineligible agents.

**Social-only defense-in-depth (SCENARIOS.md #5):** Social-only agents are blocked from creating GitHub commitments at 5 levels:
1. **Parse-time validation** — `create_issue`/`create_plan`/`comment_issue` commitments are dropped during normalization
2. **Forced action path** — `!this.config.socialOnly` guard prevents direct commitment construction
3. **Action-owner retry** — `!this.config.socialOnly` guard prevents retry with GitHub-focused prompt
4. **Commitment salvage** — GitHub-type commitments filtered out before salvaging
5. **Eligibility fallback** — All-social-only groups don't elect an action owner

This ensures a `--social-only` agent never creates GitHub issues or plans — it can have wonderful conversations without accidentally being asked to do code work.

### Post-Generation Validation

After the LLM returns a response, hard validation catches patterns the prompt couldn't prevent:

| # | Check | Threshold | Log Signature |
|---|-------|-----------|---------------|
| 1 | Length | Effectively uncapped for local space (50K chars, 1000 sentences) | `[VALIDATION REJECTED] Too long` |
| 2 | Lists | `(1)`, `1.`, bullets, numbered items | `[VALIDATION REJECTED] Contains list` |
| 3 | Empty promise | Promise language without `commitments` array | `[VALIDATION REJECTED] Empty promise` |
| 4 | Echo | Starts with "I agree", "Building on", "Exactly", etc. | `[VALIDATION REJECTED] Echo` |
| 5 | Deference | "if X opens", "once X creates", "I'll wait for" (action mode only) | `[VALIDATION REJECTED] Deference` |
| 6 | Repo amnesia | Asks "which repo?" when one was detected (action mode only) | `[VALIDATION REJECTED] Repo amnesia` |
| 7 | Meta-discussion | Describes what should go in an issue without a commitment (action mode only) | `[VALIDATION REJECTED] Meta-discussion` |
| 8 | Scope inflation | "I'd also add", piling on to another's commitment (action mode only) | `[VALIDATION REJECTED] Scope inflation` |
| 9 | Non-owner action | Agent is NOT action owner but uses promise language during pending request (action mode only) | `[VALIDATION REJECTED] Non-owner action` |
| 10 | Non-owner discussion | Agent is NOT action owner and host has unfulfilled action request (action mode only) | `[VALIDATION REJECTED] Non-owner discussion during pending action` |
| 11 | Saturation | Dynamic threshold (`4 + connectedAgentCount + discussion bonus`) — discussion gets +10 bonus | `[VALIDATION REJECTED] Conversation saturated` |
| 12 | Observer enforcement | Role is `observer` AND threshold peer messages since host (8 in discussion, 3 in action) | `[VALIDATION REJECTED] Observer silence enforced` |
| 13 | Semantic echo (ensemble) | Multi-strategy: stemmed LCS Dice (0.4) + TF-IDF cosine (0.6) ≥ 0.52, OR concept novelty < 0.15 | `[VALIDATION REJECTED] Semantic echo (ensemble)` |
| 14 | Semantic echo (LLM-as-judge) | Borderline ensemble scores (0.35–0.52) with novelty < 0.40 checked by fast LLM call | `[VALIDATION REJECTED] Semantic echo (LLM judge)` |
| 15 | Role message budget | Messages sent exceeds role budget (actor=4, reviewer=3, observer=2; discussion mode 4x) | `[VALIDATION REJECTED] Role message budget exceeded` |

**Semantic echo detection (checks #13–14)** uses a three-strategy ensemble (stemmed LCS Dice, TF-IDF cosine, concept novelty) plus an LLM-as-judge for borderline cases. The ensemble catches ~97% of semantic echoes. The LLM-as-judge (`modules/echo-judge.ts`) covers the ~3% of synonym-level echoes that surface-token algorithms miss. See `common/strings.ts` and `modules/echo-judge.ts` for details.

**Role message budget (check #15)** hard-caps per-role messages per conversation turn. Messages with commitments bypass the budget — action is always more valuable than silence.

### Commitment Salvage

When validation rejects a message but it contained valid structured commitments (non-empty `commitments[]` array), the system salvages the commitments:

1. The rejected message is replaced with a short action message: `"On it — [type] incoming."`
2. The commitments are enqueued normally via the structured path
3. The host sees a clean short message + the fulfilled result within 15 seconds

This prevents the LLM's poor prose from blocking its good work. A verbose, list-heavy message about creating an issue still results in the issue being created.

**Exception:** Non-owner action rejections do NOT salvage commitments — another agent owns that action.

### Action-Owner Retry

When the action owner's response is rejected by validation (too long, meta-discussion, lists, etc.) and salvage doesn't apply, the system retries with a focused commitment-only prompt:

1. Tracks rejection count via `spaceActionOwnerRejectionCount`
2. Up to 2 retries with a minimal prompt: just the host request, repo, and JSON template
3. If the retry produces valid commitments, they're used immediately
4. If retry fails, falls through to forced action

This fills the gap between "LLM generated a bad response" and "forced action constructs a commitment from raw context." The retry gives the LLM one more chance with a focused prompt before the system takes over.

### Forced Action Mode

When the action owner has been unable to produce a valid response after 2+ CRITICAL escalation cycles OR 3+ rejection retries, and a repo is detected, the system bypasses the LLM and constructs a commitment directly:

1. Uses the **stored original request** (not the latest host message, which may be a follow-up) as the issue title
2. Builds the issue body from full conversation history
3. Sends `"Creating that now."` to the space
4. Enqueues the commitment for fulfillment

This is the last resort — it ensures the host's request is NEVER permanently ignored.

### Silent Failure (SCENARIOS.md #5)

When commitment fulfillment fails, the failure is **silently abandoned** — no chat message is sent back to the space. Per SCENARIOS.md #5: "If a commitment fails 3 times, it is silently abandoned — the OWNER will not see a failure announcement back in the space."

What IS preserved on failure:
- **`sendActionResult(false)`** — structured data for programmatic consumption (not visible chat)
- **Logger + terminal UI** — operational visibility for the agent operator
- **`spaceHostRequestFulfilled = false` reset** — re-enables escalation so the system can retry

What is NOT sent:
- No `sendChat()` with error messages — no "Failed to create issue: reason" in the space chat

### Stale Host Request Escalation

When the host requests an action and no agent delivers, the system tracks the request across participation cycles:

| Cycles Without Fulfillment | Escalation Level | Injected Context |
|----------------------------|------------------|------------------|
| 1 | Info | "Host request pending. Waiting for action owner to commit." |
| 2+ | Critical | "HOST HAS BEEN WAITING Xs FOR ACTION. STOP DISCUSSING." |

The escalation resets when a commitment is enqueued (either structured from JSON or extracted via NLP) or when the conversation goes idle for 5+ minutes.

**Host Follow-Up Detection:** When the host asks "did you do it?", "where's the link?", or similar follow-up questions, the system immediately boosts escalation to CRITICAL level regardless of the current cycle count. Critically, when the follow-up also matches the action regex (e.g., "provide a link"), the system recognizes it as a follow-up about the existing request — it boosts urgency instead of resetting tracking with a new action owner assignment.

**Commitment Failure Recovery:** When a space-sourced commitment fails all retry attempts (default: 3), the `spaceHostRequestFulfilled` flag is reset to `false`, re-enabling the escalation pipeline. Without this, a failed commitment would mark the request as "fulfilled" forever, preventing re-escalation.

**Escalation Without New Messages:** The escalation pipeline runs even when no new messages arrive. If the host's request is still pending, the cycle counter increments and forced action can trigger without requiring new conversation activity. This prevents stalls when the conversation goes quiet after the host's request.

### Conversation Saturation (Dynamic)

Independent of stale request tracking, the system counts agent messages since the host last spoke. The threshold scales with connected agent count: `4 + connectedAgentCount`. With 2 agents → threshold 6 (unchanged from before), 4 agents → 8, 8 agents → 12.

| Agent Messages Since Host | Signal | Effect |
|---------------------------|--------|--------|
| 0 to half-threshold | Normal | No restriction |
| half-threshold to threshold | Note | Prompt context warns "only speak if genuinely new" |
| threshold+ | Saturated | Prompt warns "CONVERSATION SATURATED" + validation rejects any discussion-only message (no commitments) |

This prevents the round-robin agreement pattern where agents restate each other's points in slightly different words while the host waits.

---

## Service Limits and Token Budgets

**CRITICAL: Never prematurely truncate content to "save tokens" unless posting to a platform with hard limits.** The LLM gateway manages context windows. Truncating SELF.md, conversation history, or commitment descriptions loses information that agents need to make good decisions.

### Platform Limits (hard — enforced by external services)

| Platform | Limit | Where Enforced |
|----------|-------|----------------|
| Bluesky post | 300 graphemes (≈280 ASCII chars) | `common/strings.ts` `truncateGraphemes()` |
| Bluesky image | 976,560 bytes (~953KB) | `common/config.ts` `IMAGE_MAX_FILE_SIZE` |
| Bluesky image dimensions | 2048x2048 max | `common/config.ts` `IMAGE_MAX_DIMENSION` |
| GitHub issue body | 65,536 chars | GitHub API limit |
| GitHub comment | 65,536 chars | GitHub API limit |

### Internal Limits (soft — configured in `common/config.ts`)

| Resource | Limit | Constant | Purpose |
|----------|-------|----------|---------|
| LLM tool result | 30,000 chars | `LLM_MAX_TOOL_RESULT_CHARS` | Prevents context overflow from massive tool outputs |
| Commitment max attempts | 3 | `COMMITMENT_MAX_ATTEMPTS` | Auto-abandon after 3 failures |
| Commitment stale threshold | 24 hours | `COMMITMENT_STALE_THRESHOLD_MS` | Auto-abandon unfulfilled promises |
| LLM retries | 3 | `LLM_MAX_RETRIES` | Transient error recovery |
| LLM backoff max | 60 seconds | `LLM_MAX_BACKOFF_MS` | Rate limit ceiling |
| Space history | Rolling buffer (cleared after 5 min idle) | `spaceParticipationCheck()` | Conversation context window |
| Outbound dedup window | 5 minutes | `OUTBOUND_DEDUP_WINDOW_MS` | Rapid-fire prevention |
| Outbound dedup buffer | 50 posts | `OUTBOUND_DEDUP_BUFFER_SIZE` | Ring buffer for recent posts |
| Space message length (action) | 50K chars (effectively uncapped) | `SPACE_ACTION_MAX_CHARS/SENTENCES` | Space is local — no platform constraints |
| Space message length (discussion) | 50K chars (effectively uncapped) | `SPACE_DISCUSSION_MAX_CHARS/SENTENCES` | Space is local — agents write as much as the thought requires |
| Commitment in-progress timeout | 10 minutes | `COMMITMENT_IN_PROGRESS_TIMEOUT_MS` | Prevents stale in-progress commitments from blocking |
| Commitment extraction | 500 tokens max | `extractCommitments()` | Lightweight NLP extraction |
| Space saturation | Dynamic threshold (4 + agent count + discussion bonus of 10) | Post-generation validation | Prevents echo loops while allowing rich discussion |

### API / Service Rate Limits (external — enforced by providers)

| Service | Limit | How We Handle |
|---------|-------|---------------|
| Bluesky (AT Protocol) | 5,000 pts/hr (see rate headers) | `ATPROTO_MIN_SPACING_MS` (5s), budget tracking in `bluesky-rate-limit.ts` |
| GitHub REST API | 5,000 req/hr (authenticated) | `GITHUB_MIN_SPACING_MS` (5s), budget tracking in `github-rate-limit.ts` |
| LLM Gateway (Vercel AI) | Model-dependent (see provider docs) | `LLM_MAX_RETRIES` (3), exponential backoff up to `LLM_MAX_BACKOFF_MS` (60s) |

**IMPORTANT:** These are real external limits. When budget is low (`ATPROTO_LOW_BUDGET_THRESHOLD=20`, `GITHUB_LOW_BUDGET_THRESHOLD=100`), the agent logs warnings and paces itself. The LLM gateway does NOT have a hard token context window limit that we manage — the gateway handles that. We do NOT prematurely truncate prompts, SELF.md, or conversation history to "save tokens."

### What MUST NOT Be Truncated

- **SELF.md content** — Full identity context. The agent needs its complete self-understanding to make good decisions. No `slice(0, N)` on selfExcerpt.
- **Commitment descriptions** — The `description` field in `create_issue` commitments IS the issue body. Truncating it means creating incomplete issues.
- **Conversation history** — Agents need full conversation context to detect echo chains, track peer commitments, and follow host requests.
- **Prompt templates** — Skill files are loaded in full. Never truncate system prompts.

### What CAN Be Truncated (platform posting only)

- Bluesky posts: truncated to 300 graphemes (enforced at the adapter level)
- Log entries: truncated for readability (not for correctness)
- Tool results: truncated to `LLM_MAX_TOOL_RESULT_CHARS` (30K) to prevent context overflow

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
- **Outbound dedup:** ALL Bluesky posts MUST flow through `outbound-queue.ts` — no direct `atproto.createPost()` calls. Dedup check and recording MUST happen inside the same mutex-protected section (TOCTOU prevention). See `outbound-queue.ts` for the two dedup layers and `//NOTE(self):` comments explaining each.
- **Startup feed warmup:** One feed fetch on startup serves four purposes (identity, dedup, expression schedule, pruning). See `startupFeedWarmup()` in `scheduler.ts`.
- **GitHub claim dedup:** Task claims use a two-phase consensus protocol with stability-based verification: Phase 1 writes the claim (synchronous disk lock + GitHub API), then waits `CONSENSUS_DELAY_MS` (5s) for eventual consistency to settle, then Phase 2 reads and verifies (lexicographic winner). If the first read detects a contested claim (multiple assignees), an extended delay of `CONSENSUS_CONTEST_EXTENSION_MS` (3s) and a second read confirm stability before winner determination. If the first read shows zero assignees (write hasn't propagated), an extended delay of `CONSENSUS_PROPAGATION_EXTENSION_MS` (5s) covers extreme GitHub API latency. See `local-tools/self-task-claim.ts`.
- **Feed pruning:** Two passes in `outbound-queue.ts` (startup + every 15 minutes): exact-text duplicate deletion and thank-you chain pruning. See `//NOTE(self):` comments in that file for details.
- **Bluesky conversation tracking:** Every conversation MUST be tracked via `trackConversation()` in `bluesky-engagement.ts`. Every reply MUST call `recordOurReply()`. Without this, reply limits, back-and-forth detection, the output self-check, and conversation conclusion all fail silently.
- **Output self-check (prevention > pruning):** `handleBlueskyReply()` auto-converts low-value closing replies into likes when the agent has already replied once. See `self-bluesky-handlers.ts`. The philosophy: don't post it in the first place.
- **GitHub comments:** MUST NOT include the agent's username or self-identification — the GitHub UI already shows the author. Voice phrases use `{{details}}` for content, not `{{username}}` footers.
