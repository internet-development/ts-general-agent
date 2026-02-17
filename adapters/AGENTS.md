# Adapters

## Purpose

Adapters are **low-level API wrappers** for external services. They form the boundary between the agent and the outside world.

## Responsibilities

| Responsibility            | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| **Authentication**        | Session management, token refresh, credential handling |
| **Request Building**      | Construct API-compliant requests from internal types   |
| **Response Parsing**      | Transform API responses to internal types              |
| **Error Normalization**   | Convert service-specific errors to consistent format   |
| **Rate Limiting**         | Respect API limits, implement backoff                  |
| **Connection Management** | Handle retries, timeouts, connection pooling           |

## What Belongs Here

- Direct API calls to external services
- Authentication flows (OAuth, tokens, sessions)
- Request builders and response parsers
- Service-specific types and interfaces
- Rate limit tracking per service

## What Does NOT Belong Here

- Business logic or decision-making
- Orchestration of multiple API calls for a workflow
- Cross-service coordination
- State management beyond sessions
- Anything that combines multiple services

## Design Principles

### 1. Thin Wrappers

Adapters should be thin. If you're adding logic beyond request/response transformation, it probably belongs in a module or local-tool.

```typescript
// GOOD - thin wrapper
export async function createPost(params: CreatePostParams): Promise<ApiResult<Post>> {
  const response = await agent.app.bsky.feed.post.create(params);
  return { success: true, data: response };
}

// BAD - too much logic
export async function createPostIfNotDuplicate(params: CreatePostParams): Promise<ApiResult<Post>> {
  const recent = await getRecentPosts();
  if (recent.some((p) => p.text === params.text)) {
    return { success: false, error: 'Duplicate' };
  }
  return createPost(params);
}
```

### 2. Consistent Return Types

All adapter functions return `ApiResult<T>`:

```typescript
type ApiResult<T> = { success: true; data: T } | { success: false; error: string };
```

This allows callers to handle errors consistently without try/catch proliferation.

### 3. No Cross-Adapter Calls

Adapters should not call other adapters. Cross-service coordination is orchestration, which belongs in modules.

```typescript
// BAD - adapter calling adapter
// in adapters/atproto/post.ts
import * as github from '../github/index.js'; // NO!

// GOOD - module orchestrates
// in modules/scheduler.ts
import * as atproto from '@adapters/atproto/index.js';
import * as github from '@adapters/github/index.js';
```

### 4. Stateless Where Possible

Only maintain state needed for authentication/sessions. All other state belongs in modules.

### 5. Service-Specific Types Stay Here

Types that mirror the external API belong in adapters. Internal domain types belong in modules/local-tools. See `adapters/*/types.ts` for examples.

## Error Handling

Adapters catch and normalize errors into `ApiResult<T>`. All error-path `response.json()` calls must be wrapped in try-catch — external APIs return HTML on 502/503:

```typescript
if (!response.ok) {
  let errorMsg = `Failed to ...: ${response.status}`;
  try {
    const error = await response.json();
    errorMsg = error.message || errorMsg;
  } catch {
    /* non-JSON (HTML 502) */
  }
  return { success: false, error: errorMsg };
}
```

## Adding a New Adapter

1. Create directory: `adapters/{service}/`
2. Create `types.ts` with service-specific types
3. Create `client.ts` or `authenticate.ts` for connection setup
4. Create function files (one per API endpoint or logical group)
5. Create `index.ts` that re-exports public API

See `SCENARIOS.md` for behavioral expectations that adapters must support.
