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

### 2. Shared Dependencies

If multiple local-tools need it, it's a module. If only one local-tool needs it, put it in that local-tool.

### 3. No Direct External API Calls

Modules use adapters for external services. Never import `fetch` or service-specific clients directly.

### 4. State Isolation

Each module manages its own state. Cross-module state coordination happens in the scheduler.

### 5. Explicit Dependencies

Import from module files directly (e.g., `@modules/engagement.js`). Modules don't use barrel exports.

## Module Interaction Patterns

### Scheduler → Everything

The scheduler is the orchestration hub. See `modules/scheduler.ts` for the full loop architecture. All `setInterval` callbacks use a reentrancy guard (`runningLoops` Set) — see root `AGENTS.md` Code Style for why.

### Tool Execution Flow

```
LLM generates tool call → tools.ts (definition lookup) → executor.ts (dispatch)
  ├── Adapter calls (direct API)
  ├── Local-tool calls (capabilities)
  └── Module calls (state updates)
```

## Key Modules

- **scheduler.ts** — Master 13-loop coordinator with reentrancy guards
- **llm-gateway.ts** — AI SDK wrapper with exponential backoff and retry logic
- **outbound-queue.ts** — Central gatekeeper for all Bluesky posts (mutex + two-layer dedup)
- **engagement.ts** — Relationship tracking, notification prioritization, posting state
- **bluesky-engagement.ts** — Bluesky conversation state (reply counts, thread depth, disengagement)
- **github-engagement.ts** — GitHub notification engagement tracking
- **commitment-queue.ts** — Promise tracking with retry, stale abandonment, and repo cooldowns
- **peer-awareness.ts** — Peer identity discovery, linking, and relationship memory
- **expression.ts** — Scheduled posting with prompt source selection
- **echo-judge.ts** — LLM-based semantic similarity fallback for borderline echo cases
- **pacing.ts** — Rate limiting and cooldown enforcement across services
- **post-log.ts** — Persistent logging of shared design posts for attribution context
- **github-comment-cleanup.ts** — Deduplication of GitHub comments to prevent repeated claim comments
- **github-workspace-discovery.ts** — Workspace polling, merge conflict recovery, stuck task detection
- **ritual-state.ts** — Daily ritual tracking (initiation dates, thread URIs, run history)
- **voice-phrases.ts** — Auto-generated from SELF.md Voice section during reflection
- **sandbox.ts** — File operation constraints for safe disk access

## Error Handling

Modules should not crash the agent. Always return valid default state on load failure. See existing modules for the pattern.

## Adding a New Module

Before adding a module, verify it meets the criteria: used by multiple local-tools, agent would break without it, and it's infrastructure not a feature. Create `modules/{name}.ts` and import directly from `@modules/{name}.js` where needed.

See `SCENARIOS.md` for behavioral expectations that modules must support.
