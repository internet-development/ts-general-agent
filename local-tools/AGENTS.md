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

### 2. Flat Structure

No subdirectories. Use prefixes for organization (e.g., `self-github-`, `self-plan-`, `self-task-`).

### 3. Composable

Local-tools can use adapters and modules. Minimize local-tool-to-local-tool dependencies to avoid circular imports.

### 4. Self-Contained

A local-tool should be understandable in isolation. Document what it does, not how the system uses it.

### 5. Stateless Preferred

Local-tools should prefer stateless operation. If state is needed, use modules for persistence.

## Dependency Rules

Local-tools CAN import: `@adapters/*`, `@modules/*`, `@local-tools/*` (sparingly).
Local-tools CANNOT import: scheduler internals, executor internals, or direct external APIs.

## Error Handling

Local-tools handle errors gracefully and return meaningful results (boolean, result object) rather than throwing. See existing local-tools for the pattern.

## Adding a New Local Tool

1. Determine the correct prefix based on the local-tool's domain
2. Create `local-tools/{prefix}-{name}.ts`
3. Export one primary function
4. Add types file if needed: `local-tools/{prefix}-types.ts`

See `SCENARIOS.md` for behavioral expectations that local-tools must support.
