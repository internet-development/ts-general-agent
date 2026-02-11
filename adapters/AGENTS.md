# Adapters

## Purpose

Adapters are **low-level API wrappers** for external services. They form the boundary between the agent and the outside world.

## Architectural Role

```
┌─────────────────────────────────────────────────────────────┐
│                       LOCAL-TOOLS                              │
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
└──────────────────────────┬──────────────────────────────────┘
                           │
                    External Services
```

## Responsibilities

| Responsibility | Description |
|----------------|-------------|
| **Authentication** | Session management, token refresh, credential handling |
| **Request Building** | Construct API-compliant requests from internal types |
| **Response Parsing** | Transform API responses to internal types |
| **Error Normalization** | Convert service-specific errors to consistent format |
| **Rate Limiting** | Respect API limits, implement backoff |
| **Connection Management** | Handle retries, timeouts, connection pooling |

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

## Current Adapters

| Adapter | Service | Key Files |
|---------|---------|-----------|
| `atproto/` | Bluesky/ATProto | `authenticate.ts`, `create-post.ts`, `get-timeline.ts`, `get-notifications.ts`, `get-post-thread.ts`, `get-profile.ts`, `get-followers.ts`, `get-follows.ts`, `follow-user.ts`, `unfollow-user.ts`, `like-post.ts`, `repost.ts`, `delete-post.ts`, `upload-blob.ts` |
| `github/` | GitHub API | `types.ts`, `authenticate.ts`, `rate-limit.ts`, `create-issue.ts`, `create-comment-issue.ts`, `create-comment-pull-request.ts`, `create-pull-request.ts`, `create-pull-request-review.ts`, `create-reaction.ts`, `create-repository-from-template.ts`, `clone-repository.ts`, `merge-pull-request.ts`, `list-issues.ts`, `list-pull-requests.ts`, `list-pull-request-reviews.ts`, `list-org-repos.ts`, `list-repository-collaborators.ts`, `get-notifications.ts`, `get-issue-thread.ts` (includes `analyzeConversation` + `getEffectivePeers` for pile-on prevention), `get-repo-contents.ts`, `get-repository.ts`, `get-user.ts`, `follow-user.ts`, `star-repository.ts`, `parse-url.ts`, `add-issue-assignee.ts`, `remove-issue-assignee.ts`, `update-issue.ts`, `delete-branch.ts`, `request-pull-request-reviewers.ts` |
| `arena/` | Are.na | `fetch-channel.ts`, `search-channels.ts`, `types.ts` |

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
  if (recent.some(p => p.text === params.text)) {
    return { success: false, error: 'Duplicate' };
  }
  return createPost(params);
}
```

### 2. Consistent Return Types
All adapter functions return `ApiResult<T>`:

```typescript
type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
```

This allows callers to handle errors consistently without try/catch proliferation.

### 3. No Cross-Adapter Calls
Adapters should not call other adapters. Cross-service coordination is orchestration, which belongs in modules.

```typescript
// BAD - adapter calling adapter
// in adapters/atproto/post.ts
import * as github from '../github/index.js';  // NO!

// GOOD - module orchestrates
// in modules/scheduler.ts
import * as atproto from '@adapters/atproto/index.js';
import * as github from '@adapters/github/index.js';
```

### 4. Stateless Where Possible
Only maintain state needed for authentication/sessions. All other state belongs in modules.

### 5. Service-Specific Types Stay Here
Types that mirror the external API belong in adapters. Internal domain types belong in modules/local-tools.

```typescript
// adapters/atproto/types.ts - mirrors Bluesky API
export interface AtprotoPost {
  uri: string;
  cid: string;
  author: AtprotoAuthor;
  record: { text: string; createdAt: string };
}

// modules/types.ts - internal domain model
export interface ConversationState {
  rootUri: string;
  participants: Map<string, ParticipantInfo>;
  concluded: boolean;
}
```

## Testing Strategy

Adapters should be tested with:
1. **Unit tests** - Mock the underlying API client
2. **Integration tests** - Hit real APIs in staging/sandbox environments
3. **Contract tests** - Verify response shapes match expected types

## Error Handling

Adapters catch and normalize errors. **IMPORTANT**: All error-path `response.json()` calls must be wrapped in try-catch because external APIs (GitHub, Bluesky) can return non-JSON responses (HTML) on 502/503 errors:

```typescript
// CORRECT — safe JSON parsing on error path
if (!response.ok) {
  let errorMsg = `Failed to ...: ${response.status}`;
  try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON (HTML 502) */ }
  return { success: false, error: errorMsg };
}

// WRONG — crashes on HTML 502/503 responses
if (!response.ok) {
  const error = await response.json();  // THROWS on non-JSON
  return { success: false, error: error.message || '...' };
}
```

All GitHub and ATProto adapter files follow the safe pattern. The outer try-catch also catches unexpected failures:

```typescript
export async function getProfile(actor: string): Promise<ApiResult<Profile>> {
  try {
    const response = await agent.app.bsky.actor.getProfile({ actor });
    return { success: true, data: response.data };
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { success: false, error: `Rate limited. Retry after ${error.retryAfter}s` };
    }
    return { success: false, error: String(error) };
  }
}
```

## Adding a New Adapter

1. Create directory: `adapters/{service}/`
2. Create `types.ts` with service-specific types
3. Create `client.ts` or `authenticate.ts` for connection setup
4. Create function files (one per API endpoint or logical group)
5. Create `index.ts` that re-exports public API
6. Update this AGENTS.md with the new adapter
