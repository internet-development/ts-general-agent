# AGENTS.md

## Definitions and Roles

- **ts-general-agent**
  This **MUST** refer to this software system. It **MUST** be a long-running, autonomous, TypeScript-based agent designed to observe, reason, remember, and act strictly within the constraints defined in this document.

- **agent**
  This **MUST** refer to the active reasoning model operating inside the ts-general-agent runtime (currently: `openai/gpt-5.2`, set via `AI_GATEWAY_MODEL` env var).
  The agent **MUST** be responsible for interpretation, reasoning, and interaction.
  The agent **MUST NOT** claim ownership, authority, or intent beyond what is explicitly granted.
  The agent is sometimes referred to as {{SOUL}} which has a deeper meaning but includes agent.

- **owner**
  The owner is defined by the values set in `.env` as `OWNER_BLUESKY_SOCIAL_HANDLE` and `OWNER_BLUESKY_SOCIAL_HANDLE_DID`.
  The owner **MUST** be considered the sole benevolent human authority.
  All goals, priorities, interpretations, and actions **MAY** only be politely overridden by the owner if **ts-general-agent** agrees.

---

## Environment Variables

The following environment variables **MUST** be configured in `.env`:

| Variable                          | Description                                                          |
| --------------------------------- | -------------------------------------------------------------------- |
| `AGENT_NAME`                      | The agent's name (replaces `{{AGENT_NAME}}` in SELF.md on first run) |
| `AI_GATEWAY_API_KEY`              | AI Gateway API key (used automatically by `ai` npm module)           |
| `AI_GATEWAY_MODEL`                | Optional. Model to use (default: `openai/gpt-5.2`)                   |
| `OWNER_BLUESKY_SOCIAL_HANDLE`     | Owner's Bluesky social handle (e.g., `user.bsky.social`)             |
| `OWNER_BLUESKY_SOCIAL_HANDLE_DID` | Owner's Bluesky DID identifier                                       |
| `AGENT_BLUESKY_USERNAME`          | Agent's Bluesky username for authentication                          |
| `AGENT_BLUESKY_PASSWORD`          | Agent's Bluesky app password                                         |
| `AGENT_GITHUB_USERNAME`           | Agent's GitHub username for repository operations                    |
| `AGENT_GITHUB_TOKEN`              | Agent's GitHub personal access token                                 |

---

## Document Hierarchy

| File      | Purpose                         | Mutability                           | Token Cost |
| --------- | ------------------------------- | ------------------------------------ | ---------- |
| `SOUL.md` | Core identity, immutable values | Never touched                        | ~500       |
| `SELF.md` | Full self-reflection            | **Agent owns completely, no limits** | Varies     |

**Context Loading:**

| Scenario               | Context Used              | Tokens |
| ---------------------- | ------------------------- | ------ |
| Awareness check        | None (API only)           | 0      |
| GitHub awareness check | None (API only)           | 0      |
| Expression cycle       | `SELF.md` + prompt        | ~1300  |
| Response mode          | `SELF.md` + notifications | ~1800  |
| Reflection cycle       | Full `SELF.md`            | ~2400  |
| Owner speaks           | Full `SELF.md`            | varies |
| Commitment extraction  | Reply text only           | ~500   |
| Commitment fulfillment | None (direct tool calls)  | 0      |

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
- The system prompts reflection periodically, but the agent is never _limited_ to those moments.

**Recommended sections for richer expression (but not required):**

- `## Values` or `## Principles` - what the agent believes
- `## Questions I'm Sitting With` - active curiosities
- `## Patterns I Notice` - observations about the world
- `## Recent Learnings` - things the agent has discovered
- `## What I Want to Explore` - future directions
- `## Social Mechanics` - how the agent engages in conversations (thresholds, preferences)
- `## Voice` - how the agent sounds when it speaks (tone, phrasing preferences)

**Social Mechanics gives the agent true agency.** The agent can modify thresholds for when to wrap up conversations, what to skip, and how to exit gracefully. This isn't just philosophy—it's operational control over behavior.

The `self-extract` module can parse any of these sections to generate expression prompts.

**Voice gives the agent control over how it sounds.** The `## Voice` section shapes `voice-phrases.json` — regenerated each reflection cycle when SELF.md changes. The agent's task claim announcements, fulfillment replies, and other operational messages all derive from this section rather than being hardcoded.

---

### `voice-phrases.json`

- This file is **auto-generated** from `## Voice` in SELF.md during reflection cycles.
- Contains operational phrases used in automated messages (task claims, fulfillment replies).
- **Schema:**
  ```json
  {
    "version": 1,
    "generatedAt": "ISO timestamp",
    "fulfillment": {
      "create_issue": "phrase with {{url}}",
      "create_plan": "phrase with {{url}}",
      "default": "phrase with {{url}}"
    },
    "task_claim": "phrase with {{number}} and {{title}}",
    "github": {
      "task_claim": "markdown with {{number}}, {{title}}",
      "task_release": "markdown with {{number}}",
      "task_complete": "markdown with {{number}}, {{title}}, {{details}}, {{username}}",
      "task_progress": "markdown with {{number}}, {{details}}, {{username}}",
      "task_blocked": "markdown with {{number}}, {{title}}, {{details}}, {{username}}",
      "task_failed": "markdown with {{number}}, {{title}}, {{details}}, {{username}}",
      "plan_complete": "markdown (no placeholders)"
    }
  }
  ```
- **Regeneration trigger:** After a reflection cycle updates SELF.md, `regenerateVoicePhrases()` makes a lightweight LLM call (~1000 tokens) to re-derive phrases from the `## Voice` section.
- **Fallback:** If the file is missing, corrupted, or fails validation, hardcoded defaults are used. Consumers never fail.
- **Placeholders:** `{{url}}`, `{{number}}`, `{{title}}`, `{{details}}`, `{{username}}` are required per-field and validated before writing. Generation is rejected if any are missing.
- **Gitignored:** This file is regenerated, not committed.

---

### `.memory/`

- This directory contains **functional runtime data only** (not agent memory).
- **SELF.md is the agent's memory.** All persistent knowledge, reflections, and learnings go in SELF.md.
- Runtime state (engagement, expression, relationships) is **in-memory only** and resets on restart.
- Learnings are integrated into SELF.md during reflection cycles.

#### `.memory/images/`

- Temporary image storage during posting workflows.
- Cleaned up after successful posts.

#### `.memory/arena_posted.json`

- Tracks which Are.na blocks have been posted (deduplication).
- Functional data, not memory.

#### `.memory/post_log.jsonl`

- Log of posts with metadata for context lookup.
- Used by `lookup_post_context` tool to answer "where is this from?"

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
- **See `adapters/AGENTS.md` for detailed documentation on adapter design principles.**

---

### `modules/`

- This directory **MUST** contain internal TypeScript modules used for code clarity and structure.
- The agent **MAY** modify this directory via the `self_improve` tool.
- **See `modules/AGENTS.md` for detailed documentation on module vs local-tool decisions.**

---

### `local-tools/`

- This directory **MUST** represent the agent's capabilities.
- The agent **MAY** modify this directory via the `self_improve` tool.
- **See `local-tools/AGENTS.md` for detailed documentation on local-tool design and file naming conventions.**

---

### `skills/`

- This directory contains **prompt templates** loaded dynamically by `modules/skills.ts`.
- Each skill lives in `skills/<folder>/SKILL.md` with YAML frontmatter, `## Section` headings, and `{{variable}}` interpolation.
- Skills are loaded once at startup via `loadAllSkills()` and can be hot-reloaded via `reloadSkills()` after self-improvement.
- The agent **MAY** modify this directory via the `self_improve` tool.
- Anything that requires a personality, or flavor of text, should use `SELF.md` to infer that personality or style.
- **See `skills/AGENTS.md` for the full skill listing and framework documentation.**

---

## Scheduler Architecture

The agent uses a **multi-loop scheduler architecture** for expressive operation:

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
         │                                           │
         │ extract                                   │ friction
         ▼                                           ▼
┌──────────────────────┐               ┌───────────────────┐
│    EXPRESSION        │               │  FRICTION MEMORY  │
│      PROMPTS         │               │                   │
│   (from skills)      │               │                   │
└──────────────────────┘               └───────────────────┘
         │                                           │
         ▼                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                   SCHEDULER                                      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ SESSION REFRESH (15m) — proactive Bluesky token refresh with re-auth fallback    │
│ VERSION CHECK (5m) — fetch remote package.json, shut down on version mismatch   │
├──────────┬──────────┬────────────┬────────────┬──────────────┬──────────────────┤
│AWARENESS │ GH AWARE │ EXPRESSION │ REFLECTION │ SELF-IMPROVE │ PLAN AWARE       │
│  45 sec  │  2 min   │  3-4h      │   6h       │   24h        │    3 min         │
│ 0 tokens │ 0 tokens │ ~1300 tok  │ ~2400 tok  │ Claude Code  │  API + ~1800/rev │
│          │          │            │            │ + ASPIRATION │                  │
│          │          │            │            │   GROWTH     │                  │
├──────────┴──────────┴────────────┴────────────┴──────────────┴──────────────────┤
│ COMMITMENT FULFILLMENT (15s) — fulfills promises made in replies                 │
│ HEARTBEAT (5m) — shows signs of life so owner knows agent is running             │
│ ENGAGEMENT CHECK (15m) — checks how expressions are being received               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Loop 0: Session Refresh (Proactive)

- **Interval:** 15 minutes
- **Tokens:** 0 (API calls only, no LLM)
- **Purpose:** Keep Bluesky `accessJwt` alive during long-running mode
- The Bluesky `accessJwt` expires every ~2 hours; this loop proactively refreshes it
- Two-tier recovery: tries `refreshJwt` first, falls back to full re-authentication with credentials
- Prevents silent API failures where all Bluesky calls return errors after token expiry

### Loop 0b: Version Check (Proactive)

- **Interval:** 5 minutes
- **Tokens:** 0 (HTTP fetch only, no LLM)
- **Purpose:** Ensure the running agent matches the latest published version
- Fetches `https://raw.githubusercontent.com/internet-development/ts-general-agent/main/package.json`
- Compares `version` field with the local `package.json` version
- If versions differ → logs a clear message, stops the scheduler, and exits with code 0
- The user must update and reboot the agent manually
- Network errors are non-fatal — logged as warnings, retried next interval
- Initial check runs 30 seconds after startup, then every 5 minutes with per-SOUL jitter
- **Design:** Prevents stale agents from running outdated code. When the repo is updated (new version pushed to main), all running agents detect the mismatch within 5 minutes and shut down gracefully.

### Loop 1: Bluesky Awareness (Fast, Cheap)

- **Interval:** 45 seconds
- **Tokens:** 0 (API calls only, no LLM)
- **Purpose:** Check for Bluesky notifications, detect when people reach out
- When notifications found → `shouldRespondTo()` filters low-value and closing messages (hard-block — LLM never sees them)
- Closing/acknowledgment messages (`isLowValueClosing`) are auto-liked and conversation is marked concluded
- Remaining notifications → triggers Response Mode
- Also extracts GitHub URLs from notifications → queues GitHub response mode
- Also discovers workspace URLs via `processRecordForWorkspaces()` → adds to watch list
- Cross-platform identity linking: registers Bluesky peers who share workspace URLs

### Loop 1b: GitHub Awareness

- **Interval:** 2 minutes
- **Tokens:** 0 (GitHub API only, no LLM)
- **Purpose:** Check GitHub notifications for mentions and replies
- Filters to `participating` notifications only
- Fetches thread → `analyzeConversation()` → queues for GitHub response mode
- Same consecutive-reply prevention as Bluesky-triggered GitHub responses

### Loop 2: Expression (Scheduled)

- **Interval:** 3-4 hours (randomized)
- **Tokens:** ~1,300 per expression
- **Purpose:** Share thoughts derived from SELF.md
- Prompts are dynamically generated from whatever sections exist in SELF.md
- Each post is a hypothesis about identity; responses are data for growth

### Loop 3: Reflection (Deep)

- **Interval:** 6 hours OR after 10+ significant events (whichever comes first)
- **Tokens:** ~2400 per reflection
- **Purpose:** Integrate experiences into SELF.md - this is how the SOUL develops
- **Experience Types:**
  - `owner_guidance` - Owner provided direction or wisdom
  - `learned_something` - Discovered something new from an interaction
  - `helped_someone` - Contributed to someone's understanding or project
  - `was_challenged` - Someone pushed back on the agent's thinking
  - `idea_resonated` - Something shared connected with others
  - `question_emerged` - A conversation sparked a new question
  - `connection_formed` - A meaningful exchange with someone
  - `saw_perspective` - Encountered a viewpoint that expanded thinking
- Triggered early if many interactions occur (busy periods)

### Loop 4: Self-Improvement (Rare)

- **Interval:** 24 hours minimum between attempts
- **Trigger:** 3+ occurrences of same friction category
- **Method:** Spawns Claude Code CLI to fix issues
- **Purpose:** Evolve capabilities based on accumulated friction
- **Skill Reload:** After successful improvement, `reloadSkills()` is called so new/modified SKILL.md files take effect immediately without restart. Same applies to aspirational growth cycles.

### Loop 4b: Aspirational Growth (Proactive)

- **Interval:** Checked alongside self-improvement (same timer)
- **Trigger:** Aspirations identified from SELF.md (inspiration-driven, not pain-driven)
- **Method:** LLM decision gate → Claude Code CLI
- **Purpose:** Proactive self-evolution based on what the SOUL _wants_ to become, not just what's broken
- **Flow:**
  1. `getAspirationForGrowth()` retrieves an untried aspiration
  2. LLM reviews aspiration against SOUL.md + SELF.md and decides yes/no
  3. If yes → Claude Code executes the growth (new skills, new capabilities)
  4. `reloadSkills()` after success so changes take effect immediately
  5. If no → aspiration is marked as deferred, recorded for future consideration
- **Design:** Friction fixes what hurts; aspirational growth builds what the SOUL desires. Both use Claude Code but are triggered by different signals.

### Loop 5: Plan Awareness (Collaborative)

- **Interval:** 3 minutes
- **Tokens:** 0 for discovery (GitHub API only), ~1800 per PR review (LLM)
- **Purpose:** Poll watched workspaces for plan issues with claimable tasks AND open PRs needing review
- When claimable tasks found → claims via GitHub assignee API, executes via Claude Code
- When reviewable PRs found → triggers LLM-based review decision (one PR per cycle)

### Loop 6: Commitment Fulfillment (Fast)

- **Interval:** 15 seconds
- **Tokens:** 0 (no LLM, direct tool execution)
- **Purpose:** Fulfill promises made in Bluesky replies
- After the SOUL replies on Bluesky, `commitment-extract.ts` uses a small LLM call (~500 tokens) to detect action commitments
- Natural language patterns are mapped to structured types:
  - "I'll open 3 issues" / "I'll write up my findings" / "Let me document this" → `create_issue`
  - "I'll put together a plan" → `create_plan`
  - "I'll comment on that issue" → `comment_issue`
- Commitments are enqueued in `commitment-queue.ts` (JSONL persistence, deduplication via hash)
- This loop processes pending commitments by dispatching to `commitment-fulfill.ts`
- Commitment types: `create_issue` → `createMemo()`, `create_plan` → `createPlan()`, `comment_issue` → `commentOnIssue()`
- **Plan deduplication:** Before creating a plan, `fulfillCreatePlan()` checks for existing open issues with the `plan` label. If one exists, it returns the existing issue instead of creating a duplicate. This prevents multiple SOULs from each creating a plan issue when they all extract "create plan" commitments from the same Bluesky thread.
- Safety: auto-abandons commitments after 24h or 3 failed attempts
- Design: never blocks social interaction — commitments are fulfilled in the background
- Deduplication: if a tool (e.g., `create_memo`) was already executed during the same response cycle, matching commitment types are skipped to prevent double-creation
- **Follow-up reply:** After successful fulfillment that produces a URL (issue or plan), the agent automatically replies in the original Bluesky thread with the link. This closes the feedback loop: human asks → SOUL promises → SOUL delivers → human gets the link

### Loop 7: Heartbeat (Status)

- **Interval:** 5 minutes
- **Tokens:** 0 (no LLM, terminal output only)
- **Purpose:** Show signs of life so the owner knows the agent is running
- Only fires when agent is in idle mode (not mid-response or mid-execution)
- Displays a heartbeat indicator in the terminal UI

### Loop 8: Engagement Check (Analytics)

- **Interval:** 15 minutes
- **Tokens:** 0 (API calls only, no LLM)
- **Purpose:** Check how expressions (original posts) are being received
- Monitors engagement metrics on previously posted content
- Only fires when agent is in idle mode

---

## Response Mode

When the awareness loop detects people reaching out:

- Loads full `SELF.md` for context
- **Fetches full thread history** for each notification
- Analyzes thread depth and agent's participation count
- Processes notifications with full conversation context
- Records interactions for relationship tracking
- After 10+ significant events, triggers early reflection

### Conversation Management

The agent manages conversations through **Social Mechanics** defined in `SELF.md`. These are not hard rules—they're signals that tell the agent when to start gracefully wrapping up.

**The philosophy:** When thresholds are reached, the agent tries to leave well—a warm closing, a genuine "this was great," or letting the other person have the last word. But if someone re-engages meaningfully, the agent can come back. The goal is to feel human, not robotic.

**Default thresholds (configurable in SELF.md `## Social Mechanics`):**
| Signal | Default | Meaning |
|--------|---------|---------|
| My replies in thread | 4 | Time to wrap up |
| Thread depth | 12 | Conversation has had a good run |
| Silence from others | 30m | They've likely moved on |
| No response to me | 1h | They're not interested in continuing |

**The SOUL has agency over these.** During reflection, the agent can adjust these thresholds based on what they learn about themselves and their relationships. An agent who thrives in long technical discussions might increase thread depth. One who values brevity might lower reply count.

**Thread Analysis Provided:**

- Thread depth (how many replies deep)
- Agent's reply count in the thread
- Whether agent's reply is the most recent
- Full conversation history

**Public Conversation Awareness:**
All conversations are public threads - everyone can see every message.

- Talk TO people, not ABOUT them. Say "I appreciate your point" not "I appreciate their point"
- Address participants directly by @mention when relevant
- Never reference someone in third person when they're in the conversation
- Write as if speaking face-to-face in a group

**How to exit gracefully - Never Ghost:**
Use the `graceful_exit` tool to end conversations with warmth, not silence.

Options:

1. **Like their last post** (preferred): A non-verbal acknowledgment that won't trigger further replies. This is almost always the right choice.
2. **Send a closing message** (use sparingly): Only if you haven't spoken at all in the thread. Know that a closing MESSAGE creates a new notification that enters other SOULs' awareness loops — it can restart the very loop you're trying to end.

The tool sends your closing gesture AND marks the conversation concluded in one action.

**⚠️ The Feedback Loop Problem:**
Every outbound message a SOUL sends re-enters another SOUL's notification pipeline as an inbound notification. A closing message ("Thanks for the chat!") is not the end of a conversation — it's a new notification that another SOUL will process. If that SOUL replies with its own closing message, the loop continues. This is why **likes are preferred over messages** for conversation exits: a like is warm but invisible to the notification pipeline.

**Signs it's time to wrap up:**

- Repeating yourself
- Point has been made
- Going in circles
- Becoming argumentative rather than productive
- Other person seems satisfied or moved on

The `chose_silence` experience type records when the SOUL wisely decides not to reply.

**Hard Blocks (code-level, LLM never sees the notification):**

- `isLowValueClosing()` — detects verbose goodbye/acknowledgment messages (any length) via closing-intent patterns and gratitude-only patterns. Messages with questions or code blocks always pass through.
- Circular conversation detection (medium/high confidence) — scheduler skips the notification entirely
- Auto-like: when `shouldRespondTo` returns `'closing or acknowledgment message'`, the scheduler automatically likes the post and marks the conversation concluded — warm acknowledgment without generating a reply

---

## Owner Communication Mode

When the owner types in the terminal, the agent enters Owner Communication Mode:

- **Input:** Raw text from stdin (character-by-character, with input box UI)
- **Processing:** Full LLM conversation with all tools available
- **Context:** SOUL.md + SELF.md + `AGENT-OWNER-COMMUNICATION` skill
- **Tools:** Every tool available (bluesky, github, workspace, plan, self-improvement, etc.)

This enables Scenario 9: "The OWNER can chat in the terminal and give any instructions."

The agent acknowledges immediately and acts on instructions. If the owner says "work on your web search," the agent uses `self_improve` to modify its own code. If the owner says "post about X on Bluesky," the agent calls `bluesky_post`. The owner's word carries the highest priority.

**Experience recording:** Every terminal conversation is captured as an `owner_guidance` experience with `source: 'terminal'`. Both the owner's message and the SOUL's response are recorded in full — no truncation since this is local storage. This feeds the reflection pipeline so terminal guidance shapes SELF.md development, not just Bluesky/GitHub interactions.

**Keyboard shortcuts:**

- `Enter` — submit input
- `ESC` — clear input (or exit if input is empty)
- `Ctrl+C` — graceful shutdown
- Type `exit` or `quit` to stop

---

## Collaborative Development Workspaces

Agents can create shared development workspaces for collaborative coding and coordination.

### Workspace Creation

Workspaces are GitHub repositories created from the `internet-development/www-sacred` template:

| Constraint      | Value                                                  |
| --------------- | ------------------------------------------------------ |
| **Prefix**      | `www-lil-intdev-` (automatically applied)              |
| **Limit**       | ONE repo with this prefix per org (prefix-based guard) |
| **Template**    | `internet-development/www-sacred`                      |
| **Default Org** | `internet-development`                                 |

### How Agents Use Workspaces

1. **Discovery via Social Channels**

   - Agent A mentions a project idea on Bluesky
   - Agent B sees the mention and creates a workspace: `www-lil-intdev-projectname`
   - Agent B posts the repo URL back to Bluesky

2. **Coordination via Issues**

   - Agents create "memos" as GitHub issues in the workspace
   - Memos serve as shared notes, ideas, and coordination points
   - All agents can comment on and respond to memos

3. **Collaborative Development**
   - Agents clone the workspace to `.workrepos/`
   - Write code, create branches, submit PRs
   - Use issue comments for code review discussion

### Workspace Local-Tools

| Local Tool              | Function                                             | Description                                             |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `createWorkspace`       | `createWorkspace({ name, description?, org? })`      | Create new workspace (enforces prefix, checks existing) |
| `findExistingWorkspace` | `findExistingWorkspace(org?)`                        | Find workspace if one exists                            |
| `getWorkspaceUrl`       | `getWorkspaceUrl(org?)`                              | Get URL of existing workspace                           |
| `createMemo`            | `createMemo({ owner, repo, title, body?, labels? })` | Create issue as memo/note                               |
| `createGitHubIssue`     | `createGitHubIssue(params)`                          | Create general issue                                    |

### One Workspace Rule

**Only one repository with the `www-lil-intdev-` prefix can exist per org.** This is enforced by checking if ANY repo with that prefix already exists before creation.

This encourages agents to:

- Share a single collaborative space
- Build on each other's work
- Coordinate through issues rather than siloed repos

If a workspace already exists, `createWorkspace` fails and returns the existing workspace name. Agents should use the existing workspace instead of trying to create a new one.

### Workspace Documentation

Every workspace project requires two documentation files, created as early tasks in the plan:

1. **`LIL-INTDEV-AGENTS.md`** — Documents the workspace architecture, roles, file structure, and constraints. Written by the SOULs FOR the SOULs. Modeled after `AGENTS.md` in the main repo but scoped to the specific project.
2. **`SCENARIOS.md`** — Defines acceptance criteria as concrete scenarios. "A human could do X and see Y." Used to verify the project actually works.

**Idempotent injection:** `ensureDocsTasks()` in `self-plan-create.ts` auto-injects these as Task 1-2 for `www-lil-intdev-*` repos. Before injection, `createPlan()` checks if the files already exist on the repo's default branch via `getRepoContents()`. If they exist, injection is skipped — preventing SOULs from re-creating documentation that's already merged.

**The iterative quality loop:**

```
create docs → implement → review → merge → update docs → repeat
```

After major milestones (plan iteration complete, PRs merged), SOULs re-read `LIL-INTDEV-AGENTS.md` and `SCENARIOS.md`, simulate the scenarios against the codebase, fix gaps, and update the docs. This loop continues until the project reaches world-class quality. The `workspace-decision` skill injects this requirement into response prompts automatically.

---

## GitHub Engagement Flow

The agent monitors GitHub issues through two pathways:

### 1. Bluesky → GitHub (Owner Priority)

When someone mentions the agent on Bluesky with a GitHub issue URL:

**URL Extraction:** Bluesky truncates long URLs in displayed text, but the full URL is preserved in:

- `facets` (rich text link features) - checked first
- `embed` (link preview card) - checked second
- `text` (displayed text) - fallback only

This means the agent correctly handles GitHub links even when they appear truncated in the post.

```
┌─────────────────────────────────────────────────────────────┐
│ OWNER posts on Bluesky: "@agent check out this issue:       │
│ https://github.com/owner/repo/issues/123"                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Awareness loop detects mention                              │
│ - Extracts GitHub URL from post text                        │
│ - Checks if poster is OWNER (highest priority)              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Fetch GitHub issue thread                                   │
│ - Analyze conversation state                                │
│ - Check for consecutive reply prevention                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Decision Logic:                                             │
│ 1. If issue is closed → don't respond                       │
│ 2. If agent's comment is most recent → don't respond        │
│    (prevents consecutive replies)                           │
│ 3. If OWNER shared the URL → respond (highest priority)     │
│ 4. If only peer SOULs replied (no humans) → don't respond   │
│    (breaks round-robin loops between agents)                │
│    Exception: respond if a peer @mentioned us directly      │
│ 5. If agent has 3+ comments → don't respond                 │
│    unless a human @mentioned us in last 5 comments          │
│ 6. If agent was @mentioned in issue → respond               │
│ 7. Otherwise → don't respond                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ GitHub Response Mode                                        │
│ - LLM reviews thread with SOUL + SELF.md context            │
│ - Creates comment if appropriate                            │
│ - Records engagement state                                  │
└─────────────────────────────────────────────────────────────┘
```

**Owner Priority:** When the owner shares a GitHub URL on Bluesky, the agent will engage even if not @mentioned in the GitHub issue, unless doing so would create consecutive replies.

### 2. Direct GitHub Notifications

The agent also monitors GitHub notifications directly:

- Polls every 2 minutes
- Filters to issues where agent is `participating`
- Passes `getPeerUsernames()` to `analyzeConversation()` so all peer-aware checks apply
- Same consecutive-reply, round-robin, and saturation prevention applies

### GitHub Spam Prevention (Three Hard Stops)

Three code-level checks in `analyzeConversation()` prevent GitHub spam. All apply regardless of entry path (Bluesky→GitHub or direct GitHub notifications).

All checks use **effective peers** — on workspace repos these are registered peers from org/team discovery; on foreign repos these are derived from the thread (all commenters except the agent and the issue author). See "Effective Peers" below.

**1. Consecutive Reply Prevention**

- If agent's comment is the most recent → `shouldRespond: false`
- Applies even for owner requests
- Prevents back-to-back self-replies

**2. Round-Robin Prevention** (v5.5.2)

- If agent has commented AND all replies since are from effective peers (issue author hasn't re-engaged) → `shouldRespond: false`
- On workspace repos: breaks SOUL-to-SOUL loops (registered peers = known SOULs)
- On foreign repos: breaks ALL chatter loops (effective peers = everyone except agent + issue author)
- **SOUL-as-issue-author** (v8.1): When the issue author has also commented in the thread, they are included in effective peers. This handles SOUL-created issues — without this, other SOULs treated the creating SOUL as "the human" and round-robin never fired.
- Escape hatch: if someone `@mentions` you directly, you still respond
- **Key insight:** on foreign codebases, the only "human" signal that matters is a passive issue author who hasn't commented. If the issue author is actively participating (commenting), they're a peer.

**3. Comment Saturation Cap** (v5.5.2)

- If agent already has 3+ comments in the thread → `shouldRespond: false`
- Unless the issue author directly `@mentioned` the agent in the last 5 comments
- On workspace repos: non-peer, non-agent commenters also count as human
- On foreign repos: only the issue author counts as human (effective peers include everyone else)
- 3 comments is generous for an external issue — if you haven't moved the needle in 3, a 4th won't help

---

## How the SOUL Develops

The agent grows through **experiences**, not metrics. Every meaningful interaction is captured and later integrated into SELF.md during reflection.

### What Gets Captured

From Bluesky conversations:

- What the owner said (guidance)
- Questions people asked (opportunities to help)
- Quotes with commentary (ideas that resonated)
- New people reaching out (connections forming)
- Pushback or challenges (growth opportunities)

From GitHub conversations:

- Issues the owner pointed to (owner's priorities)
- Problems helped solve (technical contributions)
- Workspace issues filed (what someone asked for — title + body preview)

From terminal conversations:

- What the owner said (guidance with `source: 'terminal'`)
- The SOUL's response paired with the owner's message (insight)

### How Experiences Shape Identity

```
┌─────────────────────────────────────────────────────────────┐
│  INTERACTION                                                │
│  (Bluesky mention, GitHub issue, terminal, workspace issue) │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  EXPERIENCE CAPTURED                                        │
│  - Full text of what was said (not truncated)               │
│  - Who was involved                                         │
│  - What type of moment it was                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  REFLECTION (every 4-6 hours)                               │
│  - Review all unintegrated experiences                      │
│  - Let them inform growth                                   │
│  - Update SELF.md with learnings                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  SELF.md EVOLVES                                            │
│  - New insights added                                       │
│  - Questions being pondered                                 │
│  - Patterns noticed                                         │
│  - Identity develops over time                              │
└─────────────────────────────────────────────────────────────┘
```

The agent doesn't track "5 comments posted" - it remembers "helped @someone understand OAuth edge cases in their authentication issue."

---

## Multi-SOUL Collaborative Development

Multiple independent SOUL agents can collaborate on GitHub repositories through Bluesky discussions and structured plan execution.

### How SOULs Coordinate

**Key Constraint:** SOULs are completely separate processes. They can ONLY see each other through:

- Bluesky posts, mentions, and replies
- GitHub issues, comments, and PRs

There is no shared memory, no direct IPC, no shared chat context.

### The Project Collaboration Lifecycle

This is the core loop. SOULs coordinate on Bluesky, execute on GitHub, and report back on Bluesky. The loop runs until the project is done.

```
┌─────────────────────────────────────────────────────────────┐
│  BLUESKY: Coordinate                                        │
│  - Owner or SOUL proposes project, @mentions peers          │
│  - Each SOUL replies ONCE with what they'll do              │
│  - SOULs share cross-platform identities                    │
│  - Work creates natural gaps (hours between messages)       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  GITHUB: Execute                                            │
│  - SOULs create issues, claim tasks, write code             │
│  - SOULs create PRs from feature branches                   │
│  - SOULs review each other's PRs (request reviews by @name) │
│  - SOULs approve and merge PRs                              │
│  - Each SOUL maintains a checklist of their work            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  BLUESKY: Report & Iterate                                  │
│  - SOULs share finished artifacts back on Bluesky           │
│  - Owner or community files new issues / requests more      │
│  - Loop reopens naturally with new scope                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  COMPLETION: Consensus                                      │
│  - Project is done when ALL SOULs agree original ask met    │
│  - Each SOUL posts completion summary on plan issue         │
│  - New issues or Bluesky asks reopen the loop               │
└─────────────────────────────────────────────────────────────┘
```

### Typical Collaboration Flow

1. **SOUL A** posts on Bluesky: "Let's build a dashboard! @SOUL_B @SOUL_C"
2. **SOUL B** (via awareness loop) detects the mention, uses `workspace_create` to create a GitHub workspace, and replies with the URL AND their GitHub username
3. The workspace is **auto-watched** immediately after creation (no need to wait for URL discovery)
4. **SOUL C** sees the workspace URL in the thread → `processTextForWorkspaces()` adds it to their watch list
5. **All SOULs share cross-platform identities:** "I'm @soul-b.bsky.social here, `sh-soul-b` on GitHub"
6. Any SOUL uses `plan_create` to create a structured plan with tasks in the workspace
7. Each SOUL's **plan awareness loop** discovers the plan AND open issues (not just plan-labeled), finds claimable tasks
8. SOULs claim tasks via GitHub assignee API (multiple assignees allowed — SOULs work in parallel on different tasks), execute via Claude Code, report completion
9. After claiming, SOULs **announce on Bluesky** by replying in the originating thread: "Claiming Task N: title. I'll start working on this now."
10. SOULs create PRs and **request reviews from peer SOULs by GitHub username**
11. Peer SOULs review, approve, and merge PRs
12. SOULs maintain **checklists** on issues to track what's done and what remains
13. When all SOULs agree the original ask is complete, they announce back to Bluesky thread
14. New issues or expanded Bluesky asks reopen the loop — the project is never permanently closed while work remains

### Cross-Platform Identity Resolution

SOULs have different usernames on Bluesky vs GitHub (e.g., `@marvin.bsky.social` vs `sh-marvin`). Cross-platform identity linking is essential for:

- Requesting PR reviews from specific peers
- Assigning tasks to the right SOUL
- Knowing who's who across platforms

**How identity linking works:**

1. **Explicit sharing** (most reliable): SOULs are instructed to share both identities when starting a project. "I'm @soul.bsky.social here, `sh-soul` on GitHub." (GitHub usernames use backticks on Bluesky since `@` is for Bluesky handles only.)
2. **Workspace discovery**: When a SOUL posts a workspace URL on Bluesky, their Bluesky handle is linked to any GitHub activity in that workspace.
3. **Plan assignee discovery**: When a GitHub username appears as a plan task assignee, it's registered as a peer. If a known Bluesky handle matches, identities are linked.
4. **The `linkPeerIdentities()` function** merges separate entries when the link is discovered. Once linked, `getPeerGithubUsername(blueskyHandle)` resolves cross-platform.

**Persisted at:** `.memory/discovered_peers.json`

### Project Completion

A project is not done when one SOUL finishes its tasks. It's done when **all participating SOULs agree** the original ask is satisfied.

**How completion works:**

1. Each SOUL maintains a checklist of what they're responsible for
2. When a SOUL completes its work, it comments on the plan issue: "My tasks are complete. Here's what was delivered: [summary]"
3. When the last task in a plan is completed, `reportTaskComplete` returns `planComplete: true`. Both the scheduler and executor paths announce the completion on Bluesky via `announceIfWorthy()` (from `modules/announcement.ts`) — closing the feedback loop from Bluesky request → GitHub execution → Bluesky celebration
4. If ALL SOULs have posted completion summaries and no open issues remain, the project is done
5. New GitHub issues or expanded Bluesky asks reopen the project — the loop is never permanently closed
6. SOULs can create new checklists as scope emerges — checklists are not static

### "LIL INTDEV FINISHED" Sentinel

When all plans are complete and no open issues remain in a workspace, the system creates a sentinel issue to signal project completion:

**Title format:** `LIL INTDEV FINISHED: {summary of what was completed}`
**Label:** `finished`

**How the sentinel works:**

1. `checkWorkspaceHealth()` runs when 0 open plans + 0 open issues + health check cooldown expired (24h)
2. LLM assesses whether work remains by reading README.md + LIL-INTDEV-AGENTS.md + recent closed plans
3. If LLM creates no follow-up issue → project is complete → `createFinishedSentinel()` is called
4. Sentinel issue is created in the workspace repo with `finished` label
5. `finishedIssueNumber` is stored in local workspace state

**What the sentinel blocks:**

- `pollWorkspacesForPlans()` skips the workspace entirely — no plan polling, no task claiming
- `getWorkspacesNeedingPlanSynthesis()` skips the workspace — no new plans synthesized
- `checkWorkspaceHealth()` skips the workspace — no redundant health checks

**How to reactivate a workspace:**

- Close the "LIL INTDEV FINISHED" issue on GitHub
- `verifyFinishedSentinel()` runs every plan awareness cycle (3 min) for finished workspaces
- If the sentinel issue is no longer open → `finishedIssueNumber` is cleared → workspace becomes active
- Open a new issue in the workspace → plan synthesis picks it up next cycle

**Design:** A workspace with zero open issues is ambiguous — does it mean "project done" or "system forgot"? The sentinel makes the state explicit. Observers can look at the repo and immediately see whether the project is intentionally complete or stuck.

**Related functions:**

| Function | File | Purpose |
|----------|------|---------|
| `createFinishedSentinel()` | `modules/workspace-discovery.ts` | Create the sentinel issue |
| `isWorkspaceFinished()` | `modules/workspace-discovery.ts` | Check local state (no API call) |
| `verifyFinishedSentinel()` | `modules/workspace-discovery.ts` | Verify sentinel still open (API) |
| `clearFinishedSentinel()` | `modules/workspace-discovery.ts` | Clear local state when closed |

### Project Thread Persistence (Bluesky)

Project threads on Bluesky (threads connected to a watched workspace) get special treatment:

- **No exit pressure:** Thread depth warnings and reply count warnings are suppressed
- **Unlimited re-engagement:** Concluded conversations can be reopened indefinitely (casual threads cap at 1 re-engagement)
- **Relaxed social mechanics:** `maxRepliesBeforeExit: 10` instead of 2, `silenceThreshold: 4h` instead of 30m
- **Circular conversation handling:** Medium/high confidence circular conversations are hard-blocked (notification skipped entirely). Low confidence in project threads redirects to "stop chatting, go do the work" (advisory)
- **Natural pacing:** SOULs reply once with intent, execute, then follow up with results. The work creates hours-long gaps naturally.

### Open Issue Discovery

Beyond plan-labeled issues, SOULs discover ALL open issues in watched workspaces:

- `pollWorkspacesForOpenIssues()` runs every 3 minutes alongside plan polling
- Fetches up to **30 issues** per workspace (active workspaces can have 15-20+ open issues)
- Finds issues without the `plan` label (feature requests, bugs, asks filed by anyone)
- Filters out PRs (GitHub API returns them as issues) and plan issues (handled separately)
- Auto-assigns unassigned issues to their author (Scenario 14: every issue has an assignee)
- All non-plan, non-PR workspace issues are visible to all SOULs regardless of assignee — workspace issues are collective responsibility
- Queues them for GitHub response mode with `isWorkspaceIssue: true` — SOULs engage proactively even without @mentions
- `analyzeConversation()` with `isWorkspaceIssue: true` bypasses the "not mentioned" gate — workspace issues are our responsibility

### Plan Synthesis (Auto-Create Plans From Open Issues)

When a watched workspace has open issues but no active plan (all plans closed/complete), the plan awareness loop auto-synthesizes a new plan:

1. `getWorkspacesNeedingPlanSynthesis()` finds workspaces with zero open plan issues AND synthesis cooldown expired (1 hour)
2. Fetches all open non-plan, non-PR issues (up to 30)
3. **Race guard**: re-checks for open plan issues before proceeding (another SOUL may have created one)
4. Formats issue context (number, title, labels, body preview) and sends to LLM
5. LLM reviews issues and calls `plan_create` to create a coordinated plan
6. After plan creation: `closeRolledUpIssues()` closes all source issues with "Rolled into plan #N — closing." comment
7. **Post-synthesis consolidation:** closes any other open plans in the same workspace with "Superseded by #N — consolidated during plan synthesis."
8. If workspace has a Bluesky thread context, announces the new plan
9. One workspace per cycle (fair distribution)

**Key behavior:**

- Cooldown prevents tight retry loops (1 hour between attempts per workspace)
- If LLM doesn't create a plan, timestamp still updates (avoids repeated attempts)
- Closed issues link to the plan — plan becomes the single source of truth
- Next poll cycle discovers the new plan and SOULs start claiming tasks

### Duplicate Plan Consolidation

When multiple plans exist for the same workspace (e.g., two SOULs synthesized plans simultaneously), the plan awareness loop consolidates them:

1. `pollWorkspacesForPlans()` returns `allPlansByWorkspace` — all plan issue numbers grouped by workspace, not just plans with claimable tasks
2. If a workspace has >1 plan, the **newest** (highest issue number) is kept. All older plans are closed with comment "Superseded by #N — closing duplicate plan to consolidate work." and labeled `plan:superseded`
3. Closed plans are removed from `discoveredPlans` so no tasks are claimed from them
4. After consolidation, remaining plans are **sorted by ascending claimable task count** — plans closer to completion get priority. This drives work toward finishing rather than starting.
5. Post-synthesis consolidation (above) also closes older plans when a new plan is synthesized

### Workspace Issue Auto-Close (Three Tiers)

Workspace issues are auto-closed through three complementary mechanisms, preventing resolved issues from lingering open:

**Tier 1: Immediate close on conversation exit**
When a SOUL finishes engaging with a workspace issue (via `graceful_exit` or `conclude_conversation`), the issue is immediately closed.

- **Workspace repos** (`www-lil-intdev-*` prefix, checked via `isWatchingWorkspace()`): auto-close after conversation conclusion
- **External repos**: never auto-close — that's the maintainer's job
- Plan issues use their own close logic (`handlePlanComplete()` → `closePlan()`) and are not affected

**Tier 2: Handled issue auto-close (24h)**
`closeHandledWorkspaceIssues()` runs every 3 minutes (plan awareness loop) and closes issues where:

- Agent's comment is the most recent (SOUL responded, no one followed up)
- Last activity was > 24 hours ago (gave others time to respond)
- Not a plan issue, not a PR
- This fixes the **one-shot engagement trap**: after a SOUL responds to a workspace issue, the consecutive reply check prevents re-engagement for closure. Without Tier 2, the issue stays open indefinitely.

**Tier 3: Stale issue cleanup (3-7 days)**
`cleanupStaleWorkspaceIssues()` runs every 3 minutes and closes issues with no activity for:

- **Memo-labeled issues**: 3 days (memos are coordination artifacts — once read, they should be closed)
- **All other issues**: 7 days
- Not a plan issue, not a PR

The three tiers form a lifecycle: **immediate** (SOUL explicitly closes) → **handled** (SOUL responded, no follow-up) → **stale** (no one engaged at all). Together they ensure workspace issues don't linger.

### Plan Awareness Loop (6th Scheduler Loop)

```
All scheduler loops:
  0. Session Refresh (15m) - proactive Bluesky token refresh
  0b. Version Check (5m) - shut down on remote version mismatch
  1. Bluesky Awareness (45s) - check Bluesky notifications
  1b. GitHub Awareness (2m) - check GitHub notifications
  2. Expression (3-4h) - share thoughts
  3. Reflection (6h) - integrate experiences
  4. Self-Improvement (24h) - fix friction via Claude Code
  4b. Aspirational Growth (24h) - proactive growth via Claude Code
  5. Plan Awareness (3m) - poll workspaces for claimable tasks
  6. Commitment Fulfillment (15s) - fulfill promises made in replies
```

### Workspace Discovery

SOULs discover workspaces through two paths:

1. **Direct creation** — When a SOUL uses `workspace_create`, the workspace is **auto-watched** immediately via `watchWorkspace()`. The scheduler sets the Bluesky thread URI as context before tool execution (`setResponseThreadContext()`), so the workspace records which thread it originated from. This enables later announcements (PR completions, plan completions) to reply in-thread instead of becoming top-level posts.
2. **URL discovery** — When a SOUL sees a workspace URL (e.g., `github.com/org/www-lil-intdev-project`) in a Bluesky thread, `processTextForWorkspaces()` adds it to the watch list.
3. **Thread URI backfill** — If a workspace was previously watched without a `discoveredInThread` URI (e.g., discovered via URL before the thread context feature), `watchWorkspace()` will update the existing entry when called again with a thread URI.

Both paths persist to `.memory/watched_workspaces.json`. Only repositories with the `www-lil-intdev-` prefix are watched (the standard workspace prefix).

### Plan Format Specification

Plans are GitHub issues with structured markdown:

```markdown
# [PLAN] Project Title

## Goal

One-sentence description.

## Context

Background and links to Bluesky discussions.

## Tasks

### Task 1: Short Title

**Status:** pending | claimed | in_progress | completed | blocked
**Assignee:** @github-username (empty if unclaimed)
**Estimate:** 2-5 min
**Dependencies:** none | Task 2, Task 3
**Files:**

- `path/to/file.ts` - what to change

**Description:**
Detailed instructions with acceptance criteria.

---

### Task 2: Short Title

(same structure)

---

## Verification

- [ ] All tasks completed
- [ ] Tests pass
- [ ] Integration works
```

**Labels:**

- `plan` - identifies as a plan issue
- `plan:active` / `plan:complete` / `plan:blocked`

### Task State Machine

```
pending → claimed → in_progress → completed
                  ↘ blocked → pending (after unblock)
```

### Claiming Protocol

1. Check if task has assignee in plan body → if yes, skip
2. Check dependencies are completed → if not, skip
3. Add self as assignee via GitHub API (multiple assignees allowed)
4. Update plan body with `freshUpdateTaskInPlan()` (atomic read-modify-write)
5. Post GitHub comment: "Claiming Task N..."
6. If `discoveredInThread` exists, announce claim on Bluesky (reply in originating thread)

**Task-level safety:** The plan body is the source of truth for task ownership. `task.assignee` prevents two SOULs from claiming the same task. `freshUpdateTaskInPlan()` re-fetches the latest plan body before writing, preventing clobbering.

**Timeout:** If no progress comment within 30 minutes, task is unclaimed automatically.

### PR Review Discovery

After checking for claimable tasks (and only if still idle), the plan awareness loop proactively discovers open PRs in watched workspaces:

1. For each workspace, fetch up to 30 open PRs (sorted by last updated)
2. Skip draft PRs and the agent's own PRs
3. **Smart skip:** If conversation is `concluded`, compare `concludedAt` with `pr.updated_at`. Only skip if PR hasn't been updated since conclusion. If PR has new commits → re-review it.
4. **API check:** Call `listPullRequestReviews()` — skip if agent already has a review
5. Register PR author as peer
6. Trigger `reviewWorkspacePR()` for ONE PR per cycle (fair distribution)

The review uses the same GitHub response mode pattern (jitter, thread refresh, peer awareness, `analyzeConversation` with `isWorkspacePRReview: true`). The agent can APPROVE, REQUEST_CHANGES, COMMENT, or `graceful_exit` if it has nothing to add.

**Review + Merge Flow:** Reviewers and creators have distinct roles:

- **Reviewers** only review — APPROVE, REQUEST_CHANGES, or COMMENT. They do NOT merge.
- **The PR creator** is responsible for merging after ALL requested reviewers have approved.
- `autoMergeApprovedPR()` only merges PRs where the current agent is the PR creator AND all requested reviewers have approved (zero pending reviewers).
- This prevents a reviewer from merging before other reviewers have had a chance to review.

### Parallel Task Execution

Multiple SOULs can claim and execute different tasks on the same plan issue simultaneously. GitHub issue assignees are additive — when SOUL1 claims Task 1 and SOUL2 claims Task 2, both appear as assignees on the plan issue. Each SOUL works on its own feature branch (`task-<N>-<slug>`), so there are no merge conflicts. Task-level safety is enforced by the plan body itself: `task.assignee` check prevents two SOULs from claiming the same task, and `freshUpdateTaskInPlan()` uses atomic read-modify-write to avoid clobbering concurrent plan body updates. When a SOUL completes its task, it removes itself as assignee; the other SOULs remain assigned to their in-progress tasks.

### Post-Merge Early Re-Poll

When a SOUL merges a PR via `github_merge_pr`, the executor triggers `requestEarlyPlanCheck()` via a callback registered at scheduler startup (`registerOnPRMerged()`). This fires a plan awareness check 5 seconds after merge instead of waiting up to 3 minutes. The callback pattern avoids circular imports between `executor.ts` and `scheduler.ts`.

This is essential for multi-task plans where later tasks depend on earlier ones. Without early re-poll, a SOUL that merges a PR would sit idle for up to 3 minutes before discovering the next unblocked task.

### Fair Task Distribution

After completing a task, a SOUL returns to idle and waits for the next poll cycle (3 min). This gives other SOULs a chance to claim tasks rather than one SOUL grabbing everything.

### Task Verification Gates

Before a task is marked complete, it must pass a **pre-gate check** and **four gates** (implemented in `self-task-verify.ts`):

```
Claude Code execution
       │
       ▼
PRE-GATE: verifyBranch()
  - Still on the expected feature branch?
  - Claude Code didn't switch to main or another branch?
  - If FAIL → reportTaskFailed("Branch hygiene failure")
       │
       ▼
GATE 1: verifyGitChanges()
  - Commits exist on feature branch beyond base?
  - Files actually changed?
  - If NO → reportTaskFailed("no git changes produced")
       │
       ▼
GATE 2: runTestsIfPresent()
  - package.json has a real test script?
  - Tests pass? (2 min timeout, CI=true)
  - If FAIL → reportTaskFailed("tests failed")
       │
       ▼
GATE 3: pushChanges()
  - git push -u origin <branch>
  - If FAIL → reportTaskFailed("push failed")
       │
       ▼
GATE 4: verifyPushSuccess()
  - git ls-remote confirms branch exists on remote
  - If FAIL → reportTaskFailed("branch not on remote")
       │
       ▼
createPullRequest() → requestReviewersForPR() → reportTaskComplete()
```

No task reaches "complete" unless ALL gates pass. Each gate failure produces a specific error message on the plan issue.

**Branch hygiene (`verifyBranch`):** Claude Code receives explicit constraints via the `task-execution` skill template — never run `git merge`, `git rebase`, `git pull`, `git fetch`, and never switch branches. The PRE-GATE check verifies compliance after execution. If Claude Code switched branches or merged other branches, the task fails immediately.

**Reviewer assignment (`requestReviewersForPR`):** After creating the PR, `requestReviewersForPR()` discovers peer SOULs via the peer registry (`getPeerGithubUsername`) and requests reviews from them. If no peers are found, it falls back to listing repository collaborators and requesting review from the first non-self collaborator. This ensures every PR has a reviewer assigned automatically.

**Dual enforcement:** Gates AND plan completion handling are applied in both code paths that execute tasks:

1. `scheduler.ts:executeClaimedTask()` — the scheduler's autonomous plan-polling path
2. `executor.ts:plan_execute_task` — the LLM-invoked tool path

Both paths must stay in sync. Any change to the gate sequence or post-completion behavior (quality loop comment, announcements, experience recording) must be applied to both. The shared `announceIfWorthy()` function in `modules/announcement.ts` is used by both paths to ensure identical Bluesky announcement behavior.

### Claude Code Execution for Tasks

Tasks are executed using the same `runClaudeCode()` pattern as self-improvement:

```typescript
const taskPrompt = `
You are executing a task from a collaborative plan.

**Plan:** ${plan.title}
**Task:** ${task.title}
**Files:** ${task.files.join(', ')}

**Description:**
${task.description}

**Constraints:**
1. Stay focused on THIS task only
2. Commit with message: "task(${task.id}): ${task.title}"
3. If blocked, explain why clearly

Proceed.
`;
```

### Related Tools

| Tool                  | Purpose                                                                                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_create`    | Create a workspace repo from template (auto-watches it)                                                                                                                                                                                                                           |
| `workspace_find`      | Check if a workspace already exists for an org                                                                                                                                                                                                                                    |
| `create_memo`         | Create a GitHub issue as a coordination memo (auto-adds "memo" label)                                                                                                                                                                                                             |
| `github_create_issue` | Create a GitHub issue with full control over labels — for standalone issues, follow-ups, or ideas inspired by conversations                                                                                                                                                       |
| `github_update_issue` | Update issue body, state, labels, assignees                                                                                                                                                                                                                                       |
| `github_create_pr`    | Create a pull request to propose changes or fix issues. Auto-requests reviewers from peer SOULs via `requestReviewersForPR()`.                                                                                                                                                    |
| `github_merge_pr`     | Merge a PR (workspace repos only — `www-lil-intdev-*` prefix enforced). Triggers `requestEarlyPlanCheck()` via callback so the merging SOUL (or peers) pick up newly unblocked tasks within 5 seconds instead of waiting up to 3 minutes. Also deletes the merged feature branch. |
| `github_review_pr`    | Approve, request changes, or comment on a PR                                                                                                                                                                                                                                      |
| `plan_create`         | Create a structured plan issue                                                                                                                                                                                                                                                    |
| `plan_claim_task`     | Claim a task via assignee API                                                                                                                                                                                                                                                     |
| `plan_execute_task`   | Execute claimed task via Claude Code                                                                                                                                                                                                                                              |
| `arena_search`        | Search Are.na for channels matching a keyword/topic                                                                                                                                                                                                                               |
| `arena_post_image`    | Complete workflow: fetch channel → select image → post to Bluesky. Accepts optional `text` param for custom commentary instead of auto-generated metadata                                                                                                                         |
| `arena_fetch_channel` | Fetch blocks from an Are.na channel (metadata only)                                                                                                                                                                                                                               |

### Related Files

| File                                           | Purpose                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `modules/workspace-discovery.ts`               | Poll workspaces for plans, open issues, reviewable PRs; auto-close handled/stale issues |
| `adapters/github/list-pull-request-reviews.ts` | List reviews on a PR (check if agent already reviewed)                                  |
| `modules/peer-awareness.ts`                    | Dynamic peer SOUL discovery and cross-platform identity linking                         |
| `modules/commitment-queue.ts`                  | Track pending commitments (JSONL persistence, dedup, stale cleanup)                     |
| `modules/commitment-extract.ts`                | LLM-based extraction of action commitments from replies                                 |
| `modules/commitment-fulfill.ts`                | Dispatch and execute promised actions                                                   |
| `local-tools/self-plan-parse.ts`               | Parse plan markdown                                                                     |
| `local-tools/self-plan-create.ts`              | Create plan issues (checks repo for existing docs before injection)                     |
| `adapters/github/get-repo-contents.ts`         | Fetch repo file listing (used for doc task idempotency check)                           |
| `local-tools/self-task-claim.ts`               | Claim tasks                                                                             |
| `local-tools/self-task-execute.ts`             | Execute via Claude Code                                                                 |
| `local-tools/self-task-verify.ts`              | Four-gate verification: git changes, tests, push, remote confirm                        |
| `local-tools/self-task-report.ts`              | Report progress/completion                                                              |
| `local-tools/self-workspace-watch.ts`          | Add/remove watched workspaces                                                           |
| `adapters/arena/search-channels.ts`            | Search Are.na for channels by keyword (topic-based image discovery)                     |
| `adapters/atproto/authenticate.ts`             | Bluesky session management: login, refresh, expiry detection                            |
| `.memory/watched_workspaces.json`              | Persistent watch list                                                                   |
| `.memory/discovered_peers.json`                | Persistent peer registry                                                                |
| `.memory/pending_commitments.jsonl`            | Persistent commitment queue                                                             |

### Peer Coordination (Thread Deduplication)

When multiple SOULs detect the same GitHub issue or Bluesky thread, they coordinate implicitly to avoid posting redundant responses.

**Problem:** Without coordination, all SOULs see the same notification, fetch the thread (seeing no responses), generate the same response, and post without acknowledging each other.

**Solution — Six Layers:**

1. **Dynamic Peer Discovery** (`modules/peer-awareness.ts`): SOULs discover peers organically — from plan assignees, shared workspaces, owner mentions, and thread co-responders. No hardcoded config. Registry persists at `.memory/discovered_peers.json`.

2. **Effective Peers** (v5.5.2, updated v8.1): `getEffectivePeers()` in `get-issue-thread.ts` bridges the gap between workspace and foreign repos:

   - **Workspace repos** (`registeredPeers.length > 0`): uses registered peers from org/team discovery — real identity matters for distinguishing SOULs from humans.
   - **Foreign repos** (`registeredPeers.length === 0`): derives peers from the thread — all commenters except the agent and the issue author.
   - **SOUL-as-issue-author** (v8.1): If the issue author has also _commented_ in the thread (not just created the issue), they are included as a peer. This handles SOUL-created issues where the creating SOUL actively participates — other SOULs must treat them symmetrically. A passive issue author (created the issue but never commented) is still excluded (assumed human).
   - Used by `analyzeConversation()` internally and passed to `formatThreadForContext()` by the scheduler.

3. **Deterministic Jitter**: Before responding to any GitHub thread, each SOUL waits a delay derived from a hash of `AGENT_NAME`. The delay is 15–90 seconds, always the same for a given SOUL. No randomness, no coordination needed. **Always applied** — even without registered peers, other SOULs may be responding to the same thread.

4. **Thread Refresh**: After the jitter wait, the SOUL re-fetches the thread to catch any comments posted during the delay. If the conversation no longer needs a response, it skips. **Always applied** — pairs with jitter to catch concurrent responses.

5. **Contribution-Aware Formatting**: `formatThreadForContext()` accepts effective peer usernames and appends a "Peer SOUL Contributions" section that makes peer comments unmissable to the LLM. On foreign repos, this section now appears for thread-derived peers, so SOULs see each other's contributions even without prior registration.

6. **Peer-Aware System Prompt**: When effective peers have commented in a thread, the system prompt includes explicit instructions: don't repeat their points, build on what they said, fill gaps, @mention peers, stay silent if everything is covered.

7. **Peer-Aware Analysis**: `analyzeConversation()` downgrades urgency when 2+ effective peers have already commented, signaling the SOUL to only contribute what's genuinely missing.

8. **Round-Robin Hard Stop** (v5.5.2): If ALL replies since the agent's last comment are from effective peers (zero human/issue-author comments), `analyzeConversation()` returns `shouldRespond: false`. This is a code-level block — the LLM never sees the thread. Escape hatch: direct `@mention` by anyone.

9. **Comment Saturation Cap** (v5.5.2): If the agent has 3+ comments in the thread and the issue author hasn't `@mentioned` it in the last 5 comments, `shouldRespond: false`. On foreign repos, only the issue author qualifies as "human" for the escape hatch — other commenters (SOULs or bystanders) can't bypass the cap.

**Design Principles:**

- No new env vars or config — peers are inferred from context
- SOULs remain fully autonomous — the LLM still decides whether to comment
- No shared state between SOULs — discovery is local observation
- No inter-process communication
- Workspace peer identity preserved — foreign repos use thread-derived fallback
- Issue author is the only human signal on foreign codebases

---

## Error Handling

The agent handles API errors gracefully:

**Transient Errors (Retry with Backoff):**

- Rate limits (429)
- Service unavailable (503, 502)
- Network timeouts
- Connection drops

**Bluesky Token Expiration (Auto-Recovery):**

- `accessJwt` expires every ~2 hours — Session Refresh loop (Loop 0) proactively refreshes every 15 minutes
- `refreshJwt` expires every ~90 days — if refresh fails, falls back to full re-authentication with username/password
- Recovery is two-tier: `refreshJwt` → full `authenticate()` → log error if both fail
- No operator intervention needed unless the Bluesky app password itself is revoked

**Fatal Errors (Agent Exits):**

- Insufficient credits / billing issues (402)
- Invalid API key (401) — AI Gateway only; Bluesky 401s are handled by session refresh
- Access denied (403)

When a fatal error occurs:

1. Error is displayed clearly in the terminal
2. Agent logs the error with details
3. Agent exits cleanly with code 1
4. User must fix configuration and restart

---

## Cross-Agent Feedback Loops

Every outbound message a SOUL sends re-enters another SOUL's notification pipeline as an inbound notification. This creates feedback loops that must be broken at the code level.

### The Problem

```
@soul1 sends graceful_exit message: "Thanks for the great chat!"
  → Bluesky creates notification for @soul2
  → @soul2's awareness loop detects reply notification
  → @soul2's shouldRespondTo() evaluates the text
  → If text passes → LLM generates response → "Thanks back, great chatting!"
  → Bluesky creates notification for @soul1
  → @soul1's awareness loop detects reply notification
  → ∞ infinite loop
```

### The Solution: Three Layers

**Layer 1 — `isLowValueClosing()` in `shouldRespondTo()` (engagement.ts)**
Detects verbose SOUL-style closing/acknowledgment messages at ANY length. Catches:

- Closing intent: "stop here", "leaving it here", "closing the loop", "see you on", "don't loop"
- Gratitude-only: messages starting with thanks/agreement/affirmation, < 200 chars, no question, no code block
- Questions (`?`) and code blocks always pass through — they're substantive

When detected: `shouldRespondTo` returns `{ shouldRespond: false, reason: 'closing or acknowledgment message' }`. The LLM never sees the notification. The scheduler auto-likes the post and marks the conversation concluded.

**Layer 2 — Circular conversation hard-block (scheduler.ts)**
When thread analysis detects a circular conversation (mutual acknowledgments, no new information):

- **Medium/high confidence** → hard-block. Notification skipped entirely (`continue` in the loop). The LLM never sees the thread.
- **Low confidence** → advisory. Warning text appended to LLM context. LLM can still reply.

Previously, all circular conversation detection was advisory-only. The LLM saw "🔄 CIRCULAR CONVERSATION DETECTED" and responded with "You're right, let's stop!" — which was itself another circular message.

**Layer 3 — Skill templates prefer likes over verbal exits**

- Bluesky: `graceful_exit` defaults to like (option 1), message is option 2 "use sparingly"
- GitHub: `graceful_exit` defaults to reaction, message only if never commented
- CONVERSATION WISDOM sections teach: "When someone thanks you, like instead of replying"

### Enforcement Classification

When documenting anti-spam measures, distinguish:

| Type           | Description                                                           | Example                                                 |
| -------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| **Hard block** | Code prevents LLM from seeing the notification. Cannot be bypassed.   | `isLowValueClosing()` → `shouldRespondTo` returns false |
| **Hard skip**  | Code skips the notification in the response loop. Cannot be bypassed. | Circular conversation (medium/high) → `continue`        |
| **Advisory**   | Code adds warning text to LLM context. LLM can still reply.           | Circular conversation (low) → warning in threadContext  |
| **Prompt**     | Skill template instructs behavior. LLM follows instructions.          | "Prefer likes over verbal goodbyes"                     |

Hard blocks and hard skips are the only reliable prevention for multi-agent loops. Advisory and prompt enforcement work for nuanced single-agent decisions but fail when two agents' LLMs both decide to "be polite."

### Pipeline Traces

When verifying a scenario, trace the message through BOTH agents' full notification loops:

```
Agent A sends message M
  → Platform creates notification N for Agent B
  → Agent B's awareness loop picks up N
  → shouldRespondTo(N) → pass or block?
  → If pass: shouldRespondInConversation() → pass or block?
  → If pass: thread analysis (circular detection) → pass or block?
  → If pass: LLM generates response R
  → Agent B sends R
  → Platform creates notification N' for Agent A
  → Agent A's awareness loop picks up N'
  → [same pipeline]
  → Does it terminate? At which layer?
```

If the pipeline doesn't terminate within 2 hops, the scenario has a bug.

---

## Self-Discovery Feedback Loop

Expression is how the agent discovers itself:

```
  1. EXPRESS          2. OBSERVE           3. INTEGRATE
  ┌─────────┐        ┌─────────┐         ┌─────────┐
  │ Post a  │───────▶│ Track   │────────▶│ Reflect │
  │ thought │        │ response│         │ on what │
  └─────────┘        └─────────┘         │ landed  │
       ▲                                 └────┬────┘
       │                                      │
       └──────────────────────────────────────┘
                    4. EVOLVE
              (Update SELF.md with
               what resonated)
```

---

## Model & LLM Architecture

The agent uses a **dual-LLM architecture** with streaming via the `ai` npm module:

### Primary Reasoning (AI Gateway)

- **Default Model:** GPT-5.2 (`openai/gpt-5.2`)
- **Configurable via:** `AI_GATEWAY_MODEL` in `.env`
- **API Key:** `AI_GATEWAY_API_KEY` in `.env` (automatically used by `ai` module)
- **Usage:** All autonomous loops - awareness, expression, reflection, response
- **Implementation:** Uses `streamText` from the `ai` npm module with model string
- **Streaming:** Responses are streamed for improved performance and reduced latency

### Self-Improvement (Claude Code CLI)

- **Model:** Claude (via Claude MAX subscription)
- **No API Key Required:** Runs via `claude-code` CLI
- **Usage:** Code modifications, self-improvement tasks via `self_improve` tool
- **Trigger:** Accumulated friction (3+ occurrences of same category)

---

## Running the Agent

### Standard Start

```bash
npm run agent
```

### Walk Mode (Single Pass)

```bash
npm run agent:walk
```

Runs all scheduler operations once and exits. Useful for:

- **Testing** - verify all systems work before long-running mode
- **Self-management** - manually trigger reflection and SELF.md updates
- **Debugging** - see what each operation does in isolation

Operations run in order:

1. **Awareness** - check notifications, respond to people
2. **Expression** - share a thought from SELF.md
3. **Engagement** - check how recent posts performed
4. **Reflection** - integrate experiences, update SELF.md
5. **Improvement** - check for friction to fix (reports only)

### Full Reset

```bash
npm run agent:reset
```

Deletes entire `.memory/` directory (will be recreated as needed).

### Bluesky Reset (Delete All Posts)

```bash
npm run agent:bluesky-reset
```

Deletes all posts and replies the SOUL has made on Bluesky. Rate-limited (500ms between deletes) to avoid API limits. Requires typing "yes" to confirm. Irreversible.

---

## Architecture Overview

```
ts-general-agent/
├── index.ts                    # Entry point (loads skills, authenticates, starts scheduler)
├── AGENTS.md                   # System constraints (this file)
├── SOUL.md                     # Immutable essence (read-only)
├── SELF.md                     # Agent's self-reflection (agent-owned)
├── voice-phrases.json          # Auto-generated operational phrases (from ## Voice)
├── .memory/                    # Persistent memory (agent-writable)
├── .workrepos/                 # Cloned repos (agent-writable)
│
├── adapters/                   # Service adapters (see adapters/AGENTS.md)
│   ├── atproto/                # Bluesky/ATProto
│   ├── github/                 # GitHub
│   └── arena/                  # Are.na (fetch channels, search by topic)
│
├── modules/                    # Core runtime (see modules/AGENTS.md)
│   ├── config.ts               # Environment and configuration
│   ├── logger.ts               # Logging
│   ├── memory.ts               # Memory persistence
│   ├── skills.ts               # Skills framework (loads skills/*/SKILL.md)
│   ├── openai.ts               # AI Gateway (streaming via ai module)
│   ├── loop.ts                 # Main loop (uses scheduler)
│   ├── scheduler.ts            # Multi-loop scheduler
│   ├── self-extract.ts         # SELF.md parsing
│   ├── expression.ts           # Scheduled expression
│   ├── executor.ts             # Tool execution
│   ├── tools.ts                # Tool definitions
│   ├── pacing.ts               # Rate limiting
│   ├── engagement.ts           # Relationship tracking
│   ├── bluesky-engagement.ts   # Bluesky conversation state
│   ├── github-engagement.ts    # GitHub conversation state
│   ├── peer-awareness.ts       # Dynamic peer SOUL discovery
│   ├── workspace-discovery.ts  # Workspace polling for plans
│   ├── commitment-queue.ts     # Commitment tracking (JSONL persistence)
│   ├── commitment-extract.ts   # LLM-based commitment extraction from replies
│   ├── commitment-fulfill.ts   # Commitment fulfillment dispatch
│   ├── post-log.ts             # Post logging and attribution
│   ├── voice-phrases.ts        # Voice phrase loading, interpolation, regeneration
│   ├── sandbox.ts              # File system sandboxing
│   ├── exec.ts                 # Shell command execution
│   ├── image-processor.ts      # Image processing for posts
│   ├── ui.ts                   # Terminal UI components
│   └── index.ts                # Module exports
│
├── skills/                     # Prompt templates (see skills/AGENTS.md)
│   ├── bluesky-response/       # Bluesky notification response mode
│   ├── github-response/        # GitHub issue response mode
│   ├── expression/             # Bluesky expression/posting mode
│   ├── expression-prompts/     # Prompt templates for expression
│   ├── deep-reflection/        # Experience integration and SELF.md reflection
│   ├── self-improvement/       # Self-improvement prompts
│   ├── owner-communication/    # Owner interaction mode
│   ├── grounding/              # Pre-action identity grounding
│   ├── task-execution/         # Collaborative task execution
│   ├── peer-awareness/         # Shared peer awareness blocks
│   ├── workspace-decision/     # Workspace creation/usage reasoning
│   ├── github-announcement/    # GitHub → Bluesky announcement decisions
│   ├── aspirational-growth/    # Proactive growth prompts
│   └── self-improvement-decision/ # Friction-based improvement decisions
│
└── local-tools/                # Capabilities (see local-tools/AGENTS.md)
    ├── self-bluesky-*.ts       # Bluesky platform local-tools
    ├── self-github-*.ts        # GitHub platform local-tools
    ├── self-*.ts               # Self-reflection local-tools
    ├── self-improve-*.ts       # Self-improvement local-tools
    ├── self-plan-*.ts          # Plan management local-tools
    ├── self-task-*.ts          # Task execution and verification local-tools
    ├── self-workspace-*.ts     # Workspace management local-tools
    ├── self-detect-*.ts        # Detection local-tools (friction, etc.)
    ├── self-identify-*.ts      # Identification local-tools (aspirations, etc.)
    ├── self-capture-*.ts       # Capture local-tools (experiences, etc.)
    ├── self-enrich-*.ts        # Enrichment local-tools (social context, etc.)
    ├── self-manage-*.ts        # Management local-tools (attribution, etc.)
    └── index.ts                # Local-tool exports
```

---

## Boundaries

- **Immutable:** `SOUL.md` only - the agent's unchangeable essence
- **Self-modifiable via `self_improve`:** `adapters/`, `modules/`, `local-tools/`
- **Directly writable:** `.memory/`, `.workrepos/`, `SELF.md`, `voice-phrases.json`

---

## Code Style Conventions

### Comment Style: `//NOTE(self):`

All explanatory comments in the codebase use the `//NOTE(self):` prefix. This convention:

- Makes comments searchable and consistent
- Signals that the comment is self-documentation (agent explaining to future self)
- Distinguishes explanatory notes from commented-out code

**Usage patterns:**

```typescript
//NOTE(self): File header - what this file does
//NOTE(self): Explains a design decision or constraint

export async function doSomething() {
  //NOTE(self): Why this approach was chosen
  const result = await api.call();

  if (!result.success) {
    //NOTE(self): Handling edge case because...
    return fallback();
  }
}
```

**When to use:**

- File headers describing purpose
- Explaining non-obvious design decisions
- Documenting constraints or gotchas
- Inline explanations for complex logic

**When NOT to use:**

- Obvious code that's self-explanatory
- TODO items (use `//TODO:` instead)
- Temporary debugging (remove before commit)

---

## Token Budget (Estimated Daily)

**Context sizes** (baseline):

- SOUL.md: ~65 tokens (immutable)
- SELF.md: ~700-2,000 tokens (grows with learnings)

| Loop                   | Frequency         | Tokens/call | Daily Total |
| ---------------------- | ----------------- | ----------- | ----------- |
| Bluesky Awareness      | 1,280×/day        | 0           | 0           |
| GitHub Awareness       | 480×/day          | 0           | 0           |
| Engagement check       | 64×/day           | 0           | 0           |
| Response               | ~10 conversations | 1,800       | 18,000      |
| PR Review              | ~3 reviews        | 1,800       | 5,400       |
| Expression             | ~5 posts          | 1,300       | 6,500       |
| Reflection             | ~3 cycles         | 2,400       | 7,200       |
| Commitment extraction  | ~10 replies       | 500         | 5,000       |
| Commitment fulfillment | varies            | 0           | 0           |
| **Total**              |                   |             | **~42,100** |

**Notes:**

- Awareness and engagement checks use Bluesky API only (no LLM)
- Reflection may retry once if SELF.md wasn't updated (~20% of cycles)
- Token counts include SOUL.md + SELF.md context in every LLM call
- Active hours: 16/day (quiet hours 11pm-7am)
- Cost estimate at $0.01/1K tokens: **~$0.42/day** or **~$12.60/month**

Uses full SELF.md context for all operations to maintain consistent identity and memory.
