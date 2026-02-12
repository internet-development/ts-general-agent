//NOTE(self): Centralized configuration for ts-general-agent
//NOTE(self): All tunable constants in one place so the whole system is configurable from here.
//NOTE(self): Domain-specific files import from this module instead of hardcoding values.

// ─── Scheduler Loop Intervals ────────────────────────────────────────────────

export const AWARENESS_INTERVAL_MS = 45_000; // 45s — quick enough to feel responsive to replies
export const GITHUB_AWARENESS_INTERVAL_MS = 2 * 60_000; // 2m — GitHub rate limits are stricter
export const EXPRESSION_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3h — minimum between posts (token-heavy)
export const EXPRESSION_MAX_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h — maximum between posts
export const REFLECTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — between reflections (token-heavy)
export const PLAN_AWARENESS_INTERVAL_MS = 3 * 60_000; // 3m — poll workspaces for collaborative tasks
export const SESSION_REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15m — proactive JWT refresh
export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5m
export const EXPRESSION_CHECK_INTERVAL_MS = 5 * 60_000; // 5m
export const REFLECTION_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30m
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5m
export const ENGAGEMENT_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15m
export const COMMITMENT_CHECK_INTERVAL_MS = 15_000; // 15s

// ─── Self-Improvement ────────────────────────────────────────────────────────

export const IMPROVEMENT_MIN_HOURS = 24; // at least 24h between improvement attempts
export const IMPROVEMENT_BURN_IN_MS = 48 * 60 * 60 * 1000; // 48h uptime before self-improvement enabled

// ─── Quiet Hours ─────────────────────────────────────────────────────────────

export const QUIET_HOURS_START = 23; // 11pm
export const QUIET_HOURS_END = 7; // 7am

// ─── Reflection ──────────────────────────────────────────────────────────────

export const REFLECTION_EVENT_THRESHOLD = 10; // reflect after 10 significant events

// ─── Social Mechanics (defaults, overridable in SELF.md) ─────────────────────

export const DEFAULT_MAX_REPLIES_BEFORE_EXIT = 4;
export const DEFAULT_MAX_THREAD_DEPTH = 12;
export const DEFAULT_SILENCE_THRESHOLD_MS = 30 * 60 * 1000; // 30m
export const DEFAULT_NO_RESPONSE_TIMEOUT_MS = 60 * 60 * 1000; // 1h

export const PROJECT_MAX_REPLIES_BEFORE_EXIT = 10;
export const PROJECT_MAX_THREAD_DEPTH = 50;
export const PROJECT_SILENCE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4h
export const PROJECT_NO_RESPONSE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8h

// ─── Pacing (human-like social media behavior) ───────────────────────────────

export const PACING_POST_COOLDOWN_S = 1800; // 30m between original posts
export const PACING_REPLY_COOLDOWN_S = 60; // 1m between replies
export const PACING_LIKE_COOLDOWN_S = 45; // 45s between likes
export const PACING_FOLLOW_COOLDOWN_S = 3600; // 1h between follows
export const PACING_ACTION_COOLDOWN_S = 10; // 10s between any action
export const PACING_TICK_INTERVAL_S = 120; // 2m between ticks
export const PACING_MAX_ACTIONS_PER_TICK = 3;
export const PACING_REFLECTION_PAUSE_S = 3; // think before acting

// ─── Rate Limiting (API-level) ───────────────────────────────────────────────

export const ATPROTO_MIN_SPACING_MS = 5000;
export const ATPROTO_LOW_BUDGET_THRESHOLD = 20;
export const GITHUB_MIN_SPACING_MS = 5000;
export const GITHUB_LOW_BUDGET_THRESHOLD = 100;

// ─── LLM Gateway ────────────────────────────────────────────────────────────

export const LLM_MAX_RETRIES = 3;
export const LLM_BASE_BACKOFF_MS = 5000;
export const LLM_MAX_BACKOFF_MS = 60000;
export const LLM_MAX_TOOL_RESULT_CHARS = 30000;

// ─── Commitment Queue ────────────────────────────────────────────────────────

export const COMMITMENT_MAX_ATTEMPTS = 3;
export const COMMITMENT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

// ─── Workspace Management ────────────────────────────────────────────────────

export const STALE_ISSUE_DAYS = 7;
export const STALE_MEMO_DAYS = 3;
export const HANDLED_ISSUE_HOURS = 24;
export const REJECTED_PR_TIMEOUT_MS = 60 * 60 * 1000; // 1h
export const UNREVIEWED_PR_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2h
export const PLAN_SYNTHESIS_COOLDOWN_MS = 60 * 60 * 1000; // 1h
export const HEALTH_CHECK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

// ─── Task Execution ──────────────────────────────────────────────────────────

export const STUCK_TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30m before force-abandoning
export const MAX_TASK_RETRIES = 3;

// ─── Self-Improvement Logging ────────────────────────────────────────────────

export const EXEC_LOG_MAX_BYTES = 50 * 1024; // 50KB
export const EXEC_LOG_KEEP_ENTRIES = 25;

// ─── Image Processing ────────────────────────────────────────────────────────

export const IMAGE_MAX_FILE_SIZE = 976560; // ~953KB to leave buffer under 1MB
export const IMAGE_MAX_DIMENSION = 2048; // Max width/height for Bluesky
