# Skills

## Purpose

Skills are **agent capabilities** - discrete things the agent can do. They represent features that could be enabled, disabled, or replaced independently.

## Architectural Role

```
┌─────────────────────────────────────────────────────────────┐
│                         SKILLS  ◄── You are here            │
│        (high-level capabilities, business logic)             │
└──────────────────────────┬──────────────────────────────────┘
                           │ uses
┌──────────────────────────▼──────────────────────────────────┐
│                        MODULES                               │
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
| **Capabilities** | Implement discrete agent actions (post, reply, comment, reflect) |
| **Business Logic** | Contain feature-specific logic that doesn't belong in infrastructure |
| **Composition** | Combine adapters and modules to accomplish specific tasks |
| **Self-Contained** | Be understandable and testable in isolation |

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

## File Naming Convention

All skill files use a **flat structure** with semantic prefixes:

| Prefix | Domain | Description |
|--------|--------|-------------|
| `self-bluesky-` | Bluesky/social | Actions on Bluesky platform |
| `self-github-` | GitHub | Actions on GitHub platform |
| `self-` | Core self | Self-reflection, reading/writing SELF.md |
| `self-improve-` | Self-improvement | Claude Code integration, code changes |
| `self-detect-` | Detection | Pattern detection (friction, etc.) |
| `self-identify-` | Identification | Finding opportunities (aspirations, etc.) |
| `self-capture-` | Capture | Recording data (experiences, etc.) |
| `self-enrich-` | Enrichment | Adding context (social graph, etc.) |
| `self-manage-` | Management | Managing state (attribution, etc.) |
| `self-plan-` | Planning | Multi-SOUL plan creation and parsing |
| `self-task-` | Task execution | Claiming and executing tasks from plans |
| `self-workspace-` | Workspaces | Collaborative workspace discovery and management |

## Current Skills

### Platform Actions

#### Bluesky (`self-bluesky-*`)
| Skill | Purpose |
|-------|---------|
| `check-timeline` | Get home timeline feed |
| `check-notifications` | Get notifications |
| `get-owner-follows` | Get owner's follows list |
| `reply` | Reply to a post |
| `engage` | Like or repost |
| `follow` | Follow a user |
| `post` | Create a new post |
| `types` | Shared type definitions |

#### GitHub (`self-github-*`)
| Skill | Purpose |
|-------|---------|
| `get-issues` | List open issues |
| `get-prs` | List open PRs |
| `comment-issue` | Comment on an issue |
| `comment-pr` | Comment on a PR |
| `clone-repo` | Clone a repository |
| `star-repo` | Star a repository |
| `create-workspace` | Create collaborative development workspace from template |
| `create-issue` | Create issues/memos in repositories |
| `types` | Shared type definitions |

### Self-Reflection (`self-*`)
| Skill | Purpose |
|-------|---------|
| `read` | Read SELF.md |
| `write` | Write SELF.md |
| `append` | Append to SELF.md |
| `record-reflection` | Record a reflection entry |
| `get-reflections` | Get recent reflections |
| `record-observation` | Record an observation |
| `record-relationship` | Record relationship notes |

### Self-Improvement (`self-improve-*`)
| Skill | Purpose |
|-------|---------|
| `find-claude` | Locate Claude binary |
| `check-installed` | Verify Claude Code installed |
| `install` | Install Claude Code |
| `run` | Execute Claude Code with prompt |
| `request` | Request a self-improvement |
| `types` | Shared type definitions |

### Detection & Analysis (`self-detect-*`, `self-identify-*`)
| Skill | Purpose | Migrated From |
|-------|---------|---------------|
| `detect-friction` | Track friction for self-improvement | `modules/friction.ts` |
| `identify-aspirations` | Extract growth goals from SELF.md | `modules/aspiration.ts` |

### Capture & Recording (`self-capture-*`)
| Skill | Purpose | Migrated From |
|-------|---------|---------------|
| `capture-experiences` | Record meaningful experiences | `modules/experiences.ts` |

### Enrichment (`self-enrich-*`)
| Skill | Purpose | Migrated From |
|-------|---------|---------------|
| `enrich-social-context` | Build social graph context | `modules/social-graph.ts` |

### Management (`self-manage-*`)
| Skill | Purpose | Migrated From |
|-------|---------|---------------|
| `manage-attribution` | Track and manage post attribution | `modules/attribution.ts` |

### Plan Management (`self-plan-*`)
| Skill | Purpose |
|-------|---------|
| `plan-create` | Create structured plan issues with tasks, status, and verification steps |
| `plan-parse` | Parse plan markdown from GitHub issues into structured data |

### Task Execution (`self-task-*`)
| Skill | Purpose |
|-------|---------|
| `task-claim` | Claim tasks via GitHub assignee API (first-writer-wins protocol) |
| `task-execute` | Execute claimed tasks via Claude Code |
| `task-report` | Report task progress, completion, blocked status, or failure |

### Workspace Management (`self-workspace-*`)
| Skill | Purpose |
|-------|---------|
| `workspace-watch` | Add/remove workspaces from watch list, extract workspace URLs from text |

## Design Principles

### 1. Single Function Per File
Each skill file exports one primary function. Helpers can be internal but the public API is one function.

```typescript
// GOOD - one primary export
// skills/self-bluesky-post.ts
export async function post(text: string): Promise<string | null> { ... }

// BAD - multiple unrelated exports
export async function post(text: string) { ... }
export async function schedulePost(text: string, when: Date) { ... }
export async function validatePostLength(text: string) { ... }
```

### 2. Flat Structure
No subdirectories. Use prefixes for organization. This makes it easy to see all skills at a glance.

```
skills/
├── self-bluesky-post.ts       ✓ Flat with prefix
├── self-github-comment-issue.ts
└── self-detect-friction.ts

skills/
├── bluesky/                   ✗ No subdirectories
│   └── post.ts
```

### 3. Composable
Skills can use adapters and modules. Minimize skill-to-skill dependencies to avoid circular imports.

```typescript
// GOOD - uses adapter and module
import * as atproto from '@adapters/atproto/index.js';
import { logger } from '@modules/logger.js';

export async function post(text: string): Promise<string | null> {
  const result = await atproto.createPost({ text });
  if (!result.success) {
    logger.error('Failed to post', { error: result.error });
    return null;
  }
  return result.data.uri;
}

// CAREFUL - skill-to-skill dependency (OK if necessary)
import { readSelf } from '@skills/self-read.js';

export function appendToSelf(selfPath: string, addition: string): void {
  const current = readSelf(selfPath);  // OK - related skills
  // ...
}
```

### 4. Self-Contained
A skill should be understandable in isolation. Document what it does, not how the system uses it.

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
Skills should prefer stateless operation. If state is needed, use modules for persistence.

```typescript
// GOOD - stateless, uses module for state
import { getRelationship } from '@modules/engagement.js';

export function shouldRespond(handle: string): boolean {
  const relationship = getRelationship(handle);
  return relationship?.sentiment !== 'negative';
}

// BAD - skill maintains its own state
let cache: Map<string, boolean> = new Map();  // Don't do this

export function shouldRespond(handle: string): boolean {
  if (cache.has(handle)) return cache.get(handle)!;
  // ...
}
```

## Dependency Rules

```
Skills CAN import:
├── @adapters/*     (API wrappers)
├── @modules/*      (infrastructure)
└── @skills/*       (other skills, sparingly)

Skills CANNOT import:
├── Scheduler internals
├── Executor internals
└── Direct external APIs (use adapters)
```

## Error Handling

Skills should handle errors gracefully and return meaningful results:

```typescript
// GOOD - graceful error handling
export async function post(text: string): Promise<string | null> {
  const result = await atproto.createPost({ text });
  if (!result.success) {
    logger.error('Failed to post', { error: result.error });
    return null;  // Caller handles null
  }
  return result.data.uri;
}

// BAD - throws without context
export async function post(text: string): Promise<string> {
  const result = await atproto.createPost({ text });
  if (!result.success) {
    throw new Error(result.error);  // Unhelpful
  }
  return result.data.uri;
}
```

## Testing Strategy

1. **Unit tests** - Test skill logic with mocked adapters/modules
2. **Integration tests** - Test skill with real adapters in sandbox
3. **Snapshot tests** - For skills that generate prompts or formatted output

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

## Adding a New Skill

1. Determine the correct prefix based on the skill's domain
2. Create `skills/{prefix}-{name}.ts`
3. Export one primary function
4. Add types file if needed: `skills/{prefix}-types.ts`
5. Update `skills/index.ts` with exports
6. Update this AGENTS.md

### Checklist
- [ ] Single primary function exported
- [ ] Uses adapters for external APIs
- [ ] Uses modules for shared state
- [ ] Handles errors gracefully
- [ ] Has JSDoc documentation
- [ ] Added to index.ts
- [ ] Added to this AGENTS.md

## Migration Notes

When migrating a module to a skill:

1. **Identify the boundary** - What functions are the public API vs internal helpers?
2. **Check dependencies** - Update imports in scheduler and other consumers
3. **Update index.ts** - Export from the new location
4. **Delete the old module** - Don't leave dead code
5. **Update modules/AGENTS.md** - Document the migration
