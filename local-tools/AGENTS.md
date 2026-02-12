# Local-Tools

## Purpose

Local-tools are **agent capabilities** - discrete things the agent can do. They represent features that could be enabled, disabled, or replaced independently.

## Responsibilities

| Responsibility     | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| **Capabilities**   | Implement discrete agent actions (post, reply, comment, reflect)     |
| **Business Logic** | Contain feature-specific logic that doesn't belong in infrastructure |
| **Composition**    | Combine adapters and modules to accomplish specific tasks            |
| **Self-Contained** | Be understandable and testable in isolation                          |

## What Belongs Here

- High-level agent actions (post, reply, follow, comment)
- Self-reflection and introspection capabilities
- Self-improvement mechanisms
- Feature-specific logic (friction detection, aspiration tracking)
- Optional enhancements that could be toggled

## What Does NOT Belong Here

- Raw API calls (use adapters)
- Core runtime infrastructure (use modules)
- Shared state management (use modules)
- Orchestration logic (use scheduler)

## Design Principles

### 1. Single Function Per File

Each local-tool file exports one primary function. Helpers can be internal but the public API is one function.

```typescript
// GOOD - one primary export
// local-tools/self-github-comment-issue.ts
export async function commentOnIssue(params: CommentParams): Promise<boolean> { ... }

// BAD - multiple unrelated exports
export async function commentOnIssue(params: CommentParams) { ... }
export async function scheduleComment(params: CommentParams, when: Date) { ... }
export async function validateCommentLength(text: string) { ... }
```

### 2. Flat Structure

No subdirectories. Use prefixes for organization. This makes it easy to see all local-tools at a glance.

```
local-tools/
├── self-github-comment-issue.ts  ✓ Flat with prefix
├── self-detect-friction.ts
└── self-plan-create.ts

local-tools/
├── github/                       ✗ No subdirectories
│   └── comment-issue.ts
```

### 3. Composable

Local-tools can use adapters and modules. Minimize local-tool-to-local-tool dependencies to avoid circular imports.

```typescript
// GOOD - uses adapter and module
import * as github from '@adapters/github/index.js';
import { logger } from '@modules/logger.js';

export async function commentOnIssue(owner: string, repo: string, issueNumber: number, body: string): Promise<boolean> {
  const result = await github.createComment(owner, repo, issueNumber, body);
  if (!result) {
    logger.error('Failed to comment', { owner, repo, issueNumber });
    return false;
  }
  return true;
}

// CAREFUL - local-tool-to-local-tool dependency (OK if necessary)
import { readSelf } from '@local-tools/self-read.js';

export function appendToSelf(selfPath: string, addition: string): void {
  const current = readSelf(selfPath); // OK - related local-tools
  // ...
}
```

### 4. Self-Contained

A local-tool should be understandable in isolation. Document what it does, not how the system uses it.

```typescript
/**
 * Detect friction patterns in agent operation.
 *
 * Friction is anything that prevents the agent from operating smoothly:
 * - API errors
 * - Failed tool executions
 * - Expression failures
 *
 * Accumulated friction triggers self-improvement cycles.
 */
export function recordFriction(
  category: FrictionCategory,
  description: string,
  context: string
): void { ... }
```

### 5. Stateless Preferred

Local-tools should prefer stateless operation. If state is needed, use modules for persistence.

```typescript
// GOOD - stateless, uses module for state
import { getRelationship } from '@modules/self-engagement.js';

export function shouldRespond(handle: string): boolean {
  const relationship = getRelationship(handle);
  return relationship?.sentiment !== 'negative';
}

// BAD - local-tool maintains its own state
let cache: Map<string, boolean> = new Map(); // Don't do this

export function shouldRespond(handle: string): boolean {
  if (cache.has(handle)) return cache.get(handle)!;
  // ...
}
```

## Dependency Rules

```
Local-tools CAN import:
├── @adapters/*       (API wrappers)
├── @modules/*        (infrastructure)
└── @local-tools/*    (other local-tools, sparingly)

Local-tools CANNOT import:
├── Scheduler internals
├── Executor internals
└── Direct external APIs (use adapters)
```

## Error Handling

Local-tools should handle errors gracefully and return meaningful results:

```typescript
// GOOD - graceful error handling
export async function commentOnIssue(owner: string, repo: string, num: number, body: string): Promise<boolean> {
  const result = await github.createComment(owner, repo, num, body);
  if (!result) {
    logger.error('Failed to comment on issue', { owner, repo, num });
    return false; // Caller handles false
  }
  return true;
}

// BAD - throws without context
export async function commentOnIssue(owner: string, repo: string, num: number, body: string): Promise<void> {
  const result = await github.createComment(owner, repo, num, body);
  if (!result) {
    throw new Error('Comment failed'); // Unhelpful
  }
}
```

## Testing Strategy

1. **Unit tests** - Test local-tool logic with mocked adapters/modules
2. **Integration tests** - Test local-tool with real adapters in sandbox
3. **Snapshot tests** - For local-tools that generate prompts or formatted output

```typescript
// Example test structure
describe('self-detect-friction', () => {
  it('should record friction with correct category', () => {
    recordFriction('social', 'Failed to post', 'Rate limited');
    const stats = getFrictionStats();
    expect(stats.unresolved).toBe(1);
  });
});
```

## Adding a New Local Tool

1. Determine the correct prefix based on the local-tool's domain
2. Create `local-tools/{prefix}-{name}.ts`
3. Export one primary function
4. Add types file if needed: `local-tools/{prefix}-types.ts`

### Checklist

- [ ] Single primary function exported
- [ ] Uses adapters for external APIs
- [ ] Uses modules for shared state
- [ ] Handles errors gracefully

## Migration Notes

When migrating a module to a local-tool:

1. **Identify the boundary** - What functions are the public API vs internal helpers?
2. **Check dependencies** - Update imports in scheduler and other consumers
3. **Delete the old module** - Don't leave dead code
4. **Update AGENTS.md files** - Document the migration in both local-tools/AGENTS.md and modules/AGENTS.md
