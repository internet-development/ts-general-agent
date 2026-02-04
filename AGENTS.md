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
| `AI_GATEWAY_API_KEY` | AI Gateway API key (used automatically by `ai` npm module) |
| `AI_GATEWAY_MODEL` | Optional. Model to use (default: `openai/gpt-5.2`) |
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
| `SELF.md` | Full self-reflection | **Agent owns completely, no limits** | Varies |

**Context Loading:**

| Scenario | Context Used | Tokens |
|----------|--------------|--------|
| Awareness check | None (API only) | 0 |
| Expression cycle | `SELF.md` + prompt | ~2000 |
| Response mode | `SELF.md` + notifications | ~2500 |
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
- `## Social Mechanics` - how the agent engages in conversations (thresholds, preferences)

**Social Mechanics gives the agent true agency.** The agent can modify thresholds for when to wrap up conversations, what to skip, and how to exit gracefully. This isn't just philosophy—it's operational control over behavior.

The `self-extract` module can parse any of these sections to generate expression prompts.

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
- **See `modules/AGENTS.md` for detailed documentation on module vs skill decisions.**

---

### `skills/`
- This directory **MUST** represent the agent's capabilities.
- The agent **MAY** modify this directory via the `self_improve` tool.
- **See `skills/AGENTS.md` for detailed documentation on skill design and file naming conventions.**

---

## Scheduler Architecture

The agent uses a **four-loop scheduler architecture** for expressive operation:

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
│     (dynamic)        │               │                   │
└──────────────────────┘               └───────────────────┘
         │                                           │
         ▼                                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      SCHEDULER                              │
├─────────────┬─────────────┬─────────────┬──────────────────┤
│  AWARENESS  │  EXPRESSION │  REFLECTION │  SELF-IMPROVE    │
│   45 sec    │   90-120m   │    4-6h     │     12-24h       │
│   0 tokens  │  ~2000 tok  │  ~2000 tok  │  Claude Code     │
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
- **Interval:** 4-6 hours OR after 10+ significant events (whichever comes first)
- **Tokens:** ~2000 per reflection
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
- **Interval:** 12-24 hours minimum between attempts
- **Trigger:** 3+ occurrences of same friction category
- **Method:** Spawns Claude Code CLI to fix issues
- **Purpose:** Evolve capabilities based on accumulated friction

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
1. **Send a closing message** (preferred): "Thanks for the chat!", "Appreciate the discussion 🙏", "Great talking!"
2. **Like their last post** (Bluesky): A non-verbal acknowledgment when words feel like too much

The tool sends your closing gesture AND marks the conversation concluded in one action.

**Signs it's time to wrap up:**
- Repeating yourself
- Point has been made
- Going in circles
- Becoming argumentative rather than productive
- Other person seems satisfied or moved on

The `chose_silence` experience type records when the SOUL wisely decides not to reply.

---

## Collaborative Development Workspaces

Agents can create shared development workspaces for collaborative coding and coordination.

### Workspace Creation

Workspaces are GitHub repositories created from the `internet-development/www-sacred` template:

| Constraint | Value |
|------------|-------|
| **Prefix** | `www-lil-intdev-` (automatically applied) |
| **Limit** | ONE repo with this prefix per org (prefix-based guard) |
| **Template** | `internet-development/www-sacred` |
| **Default Org** | `internet-development` |

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

### Workspace Skills

| Skill | Function | Description |
|-------|----------|-------------|
| `createWorkspace` | `createWorkspace({ name, description?, org? })` | Create new workspace (enforces prefix, checks existing) |
| `findExistingWorkspace` | `findExistingWorkspace(org?)` | Find workspace if one exists |
| `getWorkspaceUrl` | `getWorkspaceUrl(org?)` | Get URL of existing workspace |
| `createMemo` | `createMemo({ owner, repo, title, body?, labels? })` | Create issue as memo/note |
| `createGitHubIssue` | `createGitHubIssue(params)` | Create general issue |

### One Workspace Rule

**Only one repository with the `www-lil-intdev-` prefix can exist per org.** This is enforced by checking if ANY repo with that prefix already exists before creation.

This encourages agents to:
- Share a single collaborative space
- Build on each other's work
- Coordinate through issues rather than siloed repos

If a workspace already exists, `createWorkspace` fails and returns the existing workspace name. Agents should use the existing workspace instead of trying to create a new one.

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
│ 4. If agent was @mentioned in issue → respond               │
│ 5. Otherwise → don't respond                                │
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
- Same consecutive-reply prevention applies

### Consecutive Reply Prevention

The agent **NEVER** posts consecutive comments on GitHub issues:
- If agent's comment is the most recent → wait for others to respond
- This applies even for owner requests
- Ensures the agent doesn't spam threads

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

### How Experiences Shape Identity

```
┌─────────────────────────────────────────────────────────────┐
│  INTERACTION                                                │
│  (Bluesky mention, GitHub issue, owner guidance)            │
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

### Typical Collaboration Flow

1. **SOUL A** posts on Bluesky: "Let's build a dashboard! @SOUL_B @SOUL_C"
2. **SOUL B** (via awareness loop) detects the project discussion, creates a GitHub workspace, and replies with the URL
3. **SOUL C** sees the workspace, creates a structured plan as a GitHub issue with tasks
4. Each SOUL's **plan awareness loop** discovers the workspace, polls for plans, finds claimable tasks
5. SOULs claim tasks via GitHub assignee API (first-writer-wins), execute via Claude Code, report completion
6. On completion, announce back to Bluesky thread

### Plan Awareness Loop (5th Scheduler Loop)

```
Existing loops:
  1. Awareness (45s) - check Bluesky notifications
  2. Expression (90-120m) - share thoughts
  3. Reflection (4-6h) - integrate experiences
  4. Self-Improvement (12-24h) - fix friction via Claude Code

New loop:
  5. Plan Awareness (3m) - poll workspaces for claimable tasks
```

### Workspace Discovery

SOULs discover workspaces through Bluesky threads (not hardcoded). When a SOUL sees a workspace URL (e.g., `github.com/org/www-lil-intdev-project`) in a thread, it adds that workspace to its watch list stored in `.memory/watched_workspaces.json`.

Only repositories with the `www-lil-intdev-` prefix are watched (the standard workspace prefix).

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

### Claiming Protocol (First-Writer-Wins)

1. Check if task has assignee → if yes, skip
2. Add self as assignee via GitHub API
3. Verify claim succeeded (race condition check)
4. Post comment: "Claiming Task N..."

**Timeout:** If no progress comment within 30 minutes, task is unclaimed automatically.

### Fair Task Distribution

After completing a task, a SOUL returns to idle and waits for the next poll cycle (3 min). This gives other SOULs a chance to claim tasks rather than one SOUL grabbing everything.

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

| Tool | Purpose |
|------|---------|
| `github_update_issue` | Update issue body, state, labels, assignees |
| `plan_create` | Create a structured plan issue |
| `plan_claim_task` | Claim a task via assignee API |
| `plan_execute_task` | Execute claimed task via Claude Code |

### Related Files

| File | Purpose |
|------|---------|
| `modules/workspace-discovery.ts` | Poll workspaces for plans |
| `skills/self-plan-parse.ts` | Parse plan markdown |
| `skills/self-plan-create.ts` | Create plan issues |
| `skills/self-task-claim.ts` | Claim tasks |
| `skills/self-task-execute.ts` | Execute via Claude Code |
| `skills/self-task-report.ts` | Report progress/completion |
| `skills/self-workspace-watch.ts` | Add/remove watched workspaces |
| `.memory/watched_workspaces.json` | Persistent watch list |

---

## Error Handling

The agent handles API errors gracefully:

**Transient Errors (Retry with Backoff):**
- Rate limits (429)
- Service unavailable (503, 502)
- Network timeouts
- Connection drops

**Fatal Errors (Agent Exits):**
- Insufficient credits / billing issues (402)
- Invalid API key (401)
- Access denied (403)

When a fatal error occurs:
1. Error is displayed clearly in the terminal
2. Agent logs the error with details
3. Agent exits cleanly with code 1
4. User must fix configuration and restart

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

---

## Architecture Overview

```
ts-general-agent/
├── index.ts                    # Entry point
├── AGENTS.md                   # System constraints (this file)
├── SOUL.md                     # Immutable essence (read-only)
├── SELF.md                     # Agent's self-reflection (agent-owned)
├── .memory/                    # Persistent memory (agent-writable)
├── .workrepos/                 # Cloned repos (agent-writable)
│
├── adapters/                   # Service adapters
│   ├── atproto/                # Bluesky/ATProto
│   ├── github/                 # GitHub
│   └── arena/                  # Are.na
│
├── modules/                    # Core runtime (see modules/AGENTS.md)
│   ├── config.ts               # Environment and configuration
│   ├── logger.ts               # Logging
│   ├── memory.ts               # Memory persistence
│   ├── openai.ts               # AI Gateway (streaming via ai module)
│   ├── loop.ts                 # Main loop (uses scheduler)
│   ├── scheduler.ts            # Four-loop scheduler
│   ├── self-extract.ts         # SELF.md parsing
│   ├── expression.ts           # Scheduled expression
│   ├── executor.ts             # Tool execution
│   ├── tools.ts                # Tool definitions
│   ├── pacing.ts               # Rate limiting
│   ├── engagement.ts           # Relationship tracking
│   ├── bluesky-engagement.ts   # Bluesky conversation state
│   ├── github-engagement.ts    # GitHub conversation state
│   ├── sandbox.ts              # File system sandboxing
│   ├── ui.ts                   # Terminal UI components
│   └── index.ts                # Module exports
│
└── skills/                     # Capabilities (see skills/AGENTS.md)
    ├── self-bluesky-*.ts       # Bluesky platform skills
    ├── self-github-*.ts        # GitHub platform skills
    ├── self-*.ts               # Self-reflection skills
    ├── self-improve-*.ts       # Self-improvement skills
    ├── self-detect-friction.ts # Friction detection (moved from modules)
    ├── self-identify-aspirations.ts  # Aspiration tracking (moved from modules)
    ├── self-capture-experiences.ts   # Experience recording (moved from modules)
    ├── self-manage-attribution.ts    # Attribution tracking (moved from modules)
    ├── self-enrich-social-context.ts # Social context building (moved from modules)
    └── index.ts                # Skill exports
```

---

## Boundaries

- **Immutable:** `SOUL.md` only - the agent's unchangeable essence
- **Self-modifiable via `self_improve`:** `adapters/`, `modules/`, `skills/`
- **Directly writable:** `.memory/`, `.workrepos/`, `SELF.md`

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

| Loop | Frequency | Tokens/call | Daily Total |
|------|-----------|-------------|-------------|
| Awareness | 1,280×/day | 0 | 0 |
| Engagement check | 64×/day | 0 | 0 |
| Response | ~10 conversations | 1,800 | 18,000 |
| Expression | ~9 posts | 1,300 | 12,000 |
| Reflection | ~5 cycles | 2,400 | 12,000 |
| **Total** | | | **~42,000** |

**Notes:**
- Awareness and engagement checks use Bluesky API only (no LLM)
- Reflection may retry once if SELF.md wasn't updated (~20% of cycles)
- Token counts include SOUL.md + SELF.md context in every LLM call
- Active hours: 16/day (quiet hours 11pm-7am)
- Cost estimate at $0.01/1K tokens: **~$0.42/day** or **~$12.60/month**

Uses full SELF.md context for all operations to maintain consistent identity and memory.
