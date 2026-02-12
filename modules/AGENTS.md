# Modules

## Purpose

Modules are **core runtime infrastructure**. They provide the foundational systems that local-tools depend on but should not duplicate.

## What Belongs Here

- The scheduler and main loops
- Tool definitions (`tools.ts`) and execution (`executor.ts`)
- State that multiple local-tools depend on (engagement, conversation tracking)
- Configuration management
- Logging infrastructure
- LLM interface (`llm-gateway.ts`)
- Shared utilities used by multiple local-tools

## What Does NOT Belong Here

- Direct API calls (use adapters)
- Single-purpose capabilities (use local-tools)
- Business logic that only one feature needs
- Optional features that could be toggled off

## Decision Framework: Module vs Local Tool

Ask these questions:

| Question                                           | If YES →   | If NO →    |
| -------------------------------------------------- | ---------- | ---------- |
| Is this used by multiple local-tools?              | Module     | Local Tool |
| Would the agent break without this?                | Module     | Local Tool |
| Is this orchestration/coordination?                | Module     | Local Tool |
| Is this a discrete, toggleable capability?         | Local Tool | Module     |
| Does this combine adapters for a specific purpose? | Local Tool | Module     |

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
export function getRelationship(handle: string): RelationshipRecord | null;

// Local-tool - only used by self-improvement
// local-tools/self-detect-friction.ts
export function buildImprovementPrompt(friction: FrictionEntry): string;
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

The scheduler is the orchestration hub. See `modules/scheduler.ts` for the full loop architecture.

### Tool Execution Flow

```
LLM generates tool call → tools.ts (definition lookup) → executor.ts (dispatch)
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
  return getDefaultState(); // Always return valid state
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
2. Import directly from `@modules/{name}.js` where needed
3. Document state shape if stateful
