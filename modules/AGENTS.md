# Modules

## Purpose

Modules are **core runtime infrastructure**. They provide the foundational systems that skills depend on but should not duplicate.

## Architectural Role

```
┌─────────────────────────────────────────────────────────────┐
│                         SKILLS                               │
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
| **Orchestration** | Coordinate multi-step workflows across skills and adapters |
| **Scheduling** | Manage the four-loop architecture (awareness, expression, reflection, improvement) |
| **State Management** | Persist and manage runtime state (engagement, conversations, relationships) |
| **Tool System** | Define tools for LLM and execute tool calls |
| **Configuration** | Load and validate environment configuration |
| **Logging** | Structured logging infrastructure |
| **Memory** | File-based persistence abstraction |

## What Belongs Here

- The scheduler and main loops
- Tool definitions (`tools.ts`) and execution (`executor.ts`)
- State that multiple skills depend on (engagement, conversation tracking)
- Configuration management
- Logging infrastructure
- LLM interface (`openai.ts`)
- Shared utilities used by multiple skills

## What Does NOT Belong Here

- Direct API calls (use adapters)
- Single-purpose capabilities (use skills)
- Business logic that only one feature needs
- Optional features that could be toggled off

## Decision Framework: Module vs Skill

Ask these questions:

| Question | If YES → | If NO → |
|----------|----------|---------|
| Is this used by multiple skills? | Module | Skill |
| Would the agent break without this? | Module | Skill |
| Is this orchestration/coordination? | Module | Skill |
| Is this a discrete, toggleable capability? | Skill | Module |
| Does this combine adapters for a specific purpose? | Skill | Module |

## Current Modules

### Core Infrastructure (Never Move)

| Module | Purpose | Depends On |
|--------|---------|------------|
| `scheduler.ts` | Four-loop architecture (awareness, expression, reflection, improvement, plan awareness) | All modules |
| `executor.ts` | Tool execution handlers | Adapters, skills |
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

### State Management (Keep in Modules)

| Module | Purpose | Why It Stays |
|--------|---------|--------------|
| `engagement.ts` | Relationship tracking, notification prioritization | Used by scheduler, multiple skills depend on it |
| `bluesky-engagement.ts` | Bluesky conversation state | Essential for response loop |
| `github-engagement.ts` | GitHub conversation state | Essential for response loop |
| `expression.ts` | Expression scheduling (core parts) | Orchestration infrastructure |
| `pacing.ts` | Rate limiting | Cross-cutting concern |
| `post-log.ts` | Post logging (core parts) | Infrastructure for attribution skills |
| `self-extract.ts` | SELF.md parsing | Foundational identity infrastructure |
| `action-queue.ts` | Persistent queue for outbound actions (replies) with retry/backoff | Ensures follow-through when rate limits defer actions |
| `workspace-discovery.ts` | Poll workspaces for plan issues, manage watch list | Multi-SOUL collaboration infrastructure |

### Moved to Skills

These were previously modules but have been migrated to skills as they represent discrete, toggleable capabilities:

| Former Module | New Skill | Reason Moved |
|---------------|-----------|--------------|
| `friction.ts` | `self-detect-friction.ts` | Optional self-improvement trigger |
| `aspiration.ts` | `self-identify-aspirations.ts` | Optional growth tracking |
| `experiences.ts` | `self-capture-experiences.ts` | Optional reflection enhancement |
| `social-graph.ts` | `self-enrich-social-context.ts` | Optional context enrichment |
| `attribution.ts` | `self-manage-attribution.ts` | Optional attribution tracking |

## Design Principles

### 1. Infrastructure, Not Features
Modules provide the rails; skills run on them. If something is a "feature," it's a skill.

```typescript
// GOOD - infrastructure
export function recordSignificantEvent(type: string): void {
  state.reflection.significantEvents++;
  saveState(state);
}

// BAD - this is a feature/skill
export async function analyzeThreadSentiment(threadUri: string): Promise<Sentiment> {
  // This is a discrete capability, not infrastructure
}
```

### 2. Shared Dependencies
If multiple skills need it, it's a module. If only one skill needs it, put it in that skill.

```typescript
// Module - used by multiple skills
// modules/engagement.ts
export function getRelationship(handle: string): RelationshipRecord | null

// Skill - only used by self-improvement
// skills/self-detect-friction.ts
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
├── awareness loop
│   ├── atproto adapter (notifications)
│   ├── engagement module (prioritization)
│   └── skills (response generation)
├── expression loop
│   ├── expression module (scheduling)
│   └── skills (post creation)
├── reflection loop
│   ├── experiences skill (gather)
│   └── skills (SELF.md update)
└── improvement loop
    ├── friction skill (identify)
    └── improvement skill (execute)
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
       ├── Skill calls (capabilities)
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
- [ ] Used by multiple skills
- [ ] Agent would break without it
- [ ] It's infrastructure, not a feature

If adding:
1. Create `modules/{name}.ts`
2. Export from `modules/index.ts`
3. Add to this AGENTS.md
4. Document state shape if stateful
