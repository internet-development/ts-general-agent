# Modules

## Purpose

Modules are **core runtime infrastructure**. They provide the foundational systems that local-tools depend on but should not duplicate.

## Architectural Role

```
┌─────────────────────────────────────────────────────────────┐
│                       LOCAL-TOOLS                              │
│        (high-level capabilities, business logic)             │
└──────────────────────────┬──────────────────────────────────┘
                           │ uses
┌──────────────────────────▼──────────────────────────────────┐
│                        MODULES  ◄── You are here            │
│        (orchestration, state, scheduling)                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ uses
┌──────────────────────────▼──────────────────────────────────┐
│                        ADAPTERS                              │
│        (API wrappers, auth, request/response)                │
└─────────────────────────────────────────────────────────────┘
```

## Responsibilities

| Responsibility | Description |
|----------------|-------------|
| **Orchestration** | Coordinate multi-step workflows across local-tools and adapters |
| **Scheduling** | Manage the multi-loop architecture (awareness, GitHub awareness, expression, reflection, improvement, plan awareness, commitment fulfillment) |
| **State Management** | Persist and manage runtime state (engagement, conversations, relationships) |
| **Tool System** | Define tools for LLM and execute tool calls |
| **Configuration** | Load and validate environment configuration |
| **Logging** | Structured logging infrastructure |
| **Memory** | File-based persistence abstraction |

## What Belongs Here

- The scheduler and main loops
- Tool definitions (`tools.ts`) and execution (`executor.ts`)
- State that multiple local-tools depend on (engagement, conversation tracking)
- Configuration management
- Logging infrastructure
- LLM interface (`openai.ts`)
- Shared utilities used by multiple local-tools

## What Does NOT Belong Here

- Direct API calls (use adapters)
- Single-purpose capabilities (use local-tools)
- Business logic that only one feature needs
- Optional features that could be toggled off

## Decision Framework: Module vs Local Tool

Ask these questions:

| Question | If YES → | If NO → |
|----------|----------|---------|
| Is this used by multiple local-tools? | Module | Local Tool |
| Would the agent break without this? | Module | Local Tool |
| Is this orchestration/coordination? | Module | Local Tool |
| Is this a discrete, toggleable capability? | Local Tool | Module |
| Does this combine adapters for a specific purpose? | Local Tool | Module |

## Current Modules

### Core Infrastructure (Never Move)

| Module | Purpose | Depends On |
|--------|---------|------------|
| `scheduler.ts` | Multi-loop architecture (awareness, GitHub awareness, expression, reflection, improvement, plan awareness, commitment fulfillment). `executeClaimedTask()` includes PRE-GATE `verifyBranch()` check. `requestEarlyPlanCheck()` fires plan awareness 5s after PR merge via `registerOnPRMerged()` callback. | All modules |
| `executor.ts` | Tool execution handlers. `github_create_pr` auto-requests reviewers via `requestReviewersForPR()`. `github_merge_pr` triggers `onPRMergedCallback` for early re-poll. `plan_execute_task` includes PRE-GATE `verifyBranch()` check. Exports `registerOnPRMerged()` callback to avoid circular imports with scheduler. | Adapters, local-tools |
| `tools.ts` | Tool definitions for LLM | None |
| `config.ts` | Environment configuration | None |
| `logger.ts` | Logging infrastructure | None |
| `memory.ts` | File-based persistence | None |
| `openai.ts` | AI Gateway / LLM interface | Config |
| `sandbox.ts` | File system sandboxing | Config |
| `ui.ts` | Terminal UI components | None |
| `exec.ts` | Shell command execution utilities | None |
| `image-processor.ts` | Image processing for posts | None |
| `loop.ts` | Main agent loop runner | Scheduler |
| `skills.ts` | Skills framework (loads `skills/*/SKILL.md`, interpolation, prompt assembly) | Logger |
| `peer-awareness.ts` | Dynamic peer SOUL discovery from plans, workspaces, threads | Config, Memory |
| `strings.ts` | Shared string utilities: `isEmpty`, `createSlug`, `truncateGraphemes`, `PORTABLE_MAX_GRAPHEMES` (300) | `@atproto/common-web` |
| `announcement.ts` | Announcement guard shared by scheduler + executor for dual enforcement (`announceIfWorthy`) | Logger |
| `voice-phrases.ts` | Load/regenerate `voice-phrases.json` for personality-consistent phrasing (`getFulfillmentPhrase`, `getTaskClaimPhrase`, `getGitHubPhrase`) | Memory, Logger |

### State Management (Keep in Modules)

| Module | Purpose | Why It Stays |
|--------|---------|--------------|
| `engagement.ts` | Relationship tracking, notification prioritization, `isLowValueClosing()` (verbose closing/acknowledgment detection), `shouldRespondTo()` (notification filtering with hard-block for closings) | Used by scheduler, multiple local-tools depend on it |
| `bluesky-engagement.ts` | Bluesky conversation state | Essential for response loop |
| `github-engagement.ts` | GitHub conversation state | Essential for response loop |
| `expression.ts` | Expression scheduling (core parts) | Orchestration infrastructure |
| `pacing.ts` | Rate limiting | Cross-cutting concern |
| `post-log.ts` | Post logging (core parts) | Infrastructure for attribution local-tools |
| `self-extract.ts` | SELF.md parsing | Foundational identity infrastructure |
| `action-queue.ts` | Persistent queue for outbound actions (replies) with retry/backoff | Ensures follow-through when rate limits defer actions |
| `workspace-discovery.ts` | Poll workspaces for plan issues (up to 30 per workspace), manage watch list, three-tier auto-close (handled 24h, stale memo 3d, stale other 7d), `pollWorkspacesForApprovedPRs()` (up to 30 PRs) + `autoMergeApprovedPR()` for auto-merging approved PRs. **Merge-gated task completion:** tasks stay `in_progress` until PR merges — `completeTaskAfterMerge()` marks `completed` and checks plan closure. **PR recovery:** `handleMergeConflictPR()` closes conflicting/rejected/unreviewed PRs, deletes branch, resets task to `pending`. **Follow-up issues:** `createFollowUpIssueFromReviews()` creates issues from reviewer feedback after merge. **Auto-assignment:** `pollWorkspacesForOpenIssues()` assigns unassigned issues to their author but does NOT filter by assignee — all workspace issues visible to all SOULs. **Plan synthesis:** `getWorkspacesNeedingPlanSynthesis()` finds workspaces with zero open plans and cooldown expired (1h), `updateWorkspaceSynthesisTimestamp()` records attempt, `closeRolledUpIssues()` closes source issues with plan link comment. **Duplicate plan consolidation:** `PlanPollResult.allPlansByWorkspace` tracks all plan issue numbers per workspace — scheduler uses this to close older duplicate plans (superseded by newest). | Multi-SOUL collaboration infrastructure |
| `commitment-queue.ts` | Track pending commitments with JSONL persistence, dedup, stale cleanup | Ensures follow-through on promises made in replies |
| `commitment-extract.ts` | LLM-based extraction of action commitments from Bluesky replies | Feeds commitment queue from response mode |
| `commitment-fulfill.ts` | Dispatch commitments to fulfillment handlers (create_issue, create_plan, comment_issue) | Executes promised actions autonomously |

### Moved to Local-Tools

These were previously modules but have been migrated to local-tools as they represent discrete, toggleable capabilities:

| Former Module | New Local Tool | Reason Moved |
|---------------|-----------|--------------|
| `friction.ts` | `self-detect-friction.ts` | Optional self-improvement trigger |
| `aspiration.ts` | `self-identify-aspirations.ts` | Optional growth tracking |
| `experiences.ts` | `self-capture-experiences.ts` | Optional reflection enhancement |
| `social-graph.ts` | `self-enrich-social-context.ts` | Optional context enrichment |
| `attribution.ts` | `self-manage-attribution.ts` | Optional attribution tracking |

## Design Principles

### 1. Infrastructure, Not Features
Modules provide the rails; local-tools run on them. If something is a "feature," it's a local-tool.

```typescript
// GOOD - infrastructure
export function recordSignificantEvent(type: string): void {
  state.reflection.significantEvents++;
  saveState(state);
}

// BAD - this is a feature/local-tool
export async function analyzeThreadSentiment(threadUri: string): Promise<Sentiment> {
  // This is a discrete capability, not infrastructure
}
```

### 2. Shared Dependencies
If multiple local-tools need it, it's a module. If only one local-tool needs it, put it in that local-tool.

```typescript
// Module - used by multiple local-tools
// modules/engagement.ts
export function getRelationship(handle: string): RelationshipRecord | null

// Local-tool - only used by self-improvement
// local-tools/self-detect-friction.ts
export function buildImprovementPrompt(friction: FrictionEntry): string
```

### 3. No Direct External API Calls
Modules use adapters for external services. Never import `fetch` or service-specific clients directly.

```typescript
// BAD
import { BskyAgent } from '@atproto/api';
const agent = new BskyAgent({ service: 'https://bsky.social' });

// GOOD
import * as atproto from '@adapters/atproto/index.js';
const result = await atproto.getTimeline({ limit: 20 });
```

### 4. State Isolation
Each module manages its own state. Cross-module state coordination happens in the scheduler.

```typescript
// modules/engagement.ts - owns engagement state
let engagementState: EngagementState | null = null;

// modules/github-engagement.ts - owns GitHub state
let conversationState: GitHubConversationState | null = null;

// modules/scheduler.ts - coordinates across modules
if (getSignificantEventCount() >= threshold) {
  await triggerReflection();
}
```

### 5. Explicit Dependencies
Import from module entry points, not internal files:

```typescript
// GOOD
import { recordInteraction } from '@modules/engagement.js';

// BAD
import { recordInteraction } from '@modules/engagement/interactions.js';
```

## Module Interaction Patterns

### Scheduler → Everything
The scheduler is the orchestration hub:

```
scheduler.ts
├── awareness loop (45s)
│   ├── atproto adapter (notifications)
│   ├── engagement module (prioritization)
│   ├── workspace-discovery (URL extraction from records)
│   └── local-tools (response generation)
├── github awareness loop (2m)
│   ├── github adapter (notifications)
│   └── github-engagement module (conversation tracking)
├── expression loop (3-4h)
│   ├── expression module (scheduling)
│   └── local-tools (post creation)
├── reflection loop (6h)
│   ├── experiences local-tool (gather)
│   └── local-tools (SELF.md update)
├── improvement loop (24h)
│   ├── friction local-tool (identify)
│   └── improvement local-tool (execute via Claude Code)
├── plan awareness loop (3m)
│   ├── workspace-discovery (poll plans, PRs, open issues)
│   ├── plan synthesis: if no open plans → synthesizePlanForWorkspaces() → LLM creates plan → close rolled-up issues
│   ├── task-claim → task-execute → task-verify → PR created (task stays in_progress)
│   ├── PR review: all requested reviewers must LGTM before merge
│   ├── auto-merge approved PRs → completeTaskAfterMerge → on allComplete → handlePlanComplete + announceIfWorthy
│   ├── recover stuck PRs: rejected >1h, unreviewed >2h, merge conflicts → close PR, reset task to pending
│   ├── stuck task recovery: in_progress >30m with NO open PR → reset to pending
│   ├── follow-up issues from reviewer feedback after merge
│   ├── PR review (one per cycle)
│   ├── auto-assign unassigned workspace issues to author
│   ├── closeHandledWorkspaceIssues (24h: agent responded, no follow-up)
│   └── cleanupStaleWorkspaceIssues (3d memos, 7d others)
└── commitment fulfillment loop (15s)
    ├── commitment-queue (pending commitments)
    └── commitment-fulfill (dispatch by type)
```

### Tool Execution Flow

```
LLM generates tool call
       │
       ▼
tools.ts (definition lookup)
       │
       ▼
executor.ts (dispatch)
       │
       ├── Adapter calls (direct API)
       ├── Local-tool calls (capabilities)
       └── Module calls (state updates)
```

## Error Handling

Modules should not crash the agent. Use defensive patterns:

```typescript
export function loadState(): EngagementState {
  try {
    if (existsSync(STATE_PATH)) {
      return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    }
  } catch (err) {
    logger.error('Failed to load state', { error: String(err) });
  }
  return getDefaultState();  // Always return valid state
}
```

## Testing Strategy

1. **Unit tests** - Test state management and pure functions
2. **Integration tests** - Test module interactions via scheduler
3. **Mock adapters** - Never hit real APIs in module tests

## Adding a New Module

Before adding a module, verify it meets the criteria:
- [ ] Used by multiple local-tools
- [ ] Agent would break without it
- [ ] It's infrastructure, not a feature

If adding:
1. Create `modules/{name}.ts`
2. Export from `modules/index.ts`
3. Add to this AGENTS.md
4. Document state shape if stateful
