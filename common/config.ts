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
export const RITUAL_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30m — check for due daily rituals

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

// ─── Outbound Queue ─────────────────────────────────────────────────────────

export const OUTBOUND_DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5m dedup window
export const OUTBOUND_DEDUP_BUFFER_SIZE = 50; // Recent posts ring buffer

// ─── Image Processing ────────────────────────────────────────────────────────

export const IMAGE_MAX_FILE_SIZE = 976560; // ~953KB to leave buffer under 1MB
export const IMAGE_MAX_DIMENSION = 2048; // Max width/height for Bluesky

// ─── Agent Space ─────────────────────────────────────────────────────────────

export const SPACE_CHECK_INTERVAL_MS = 5_000; // 5s — real-time conversation
export const SPACE_RECONNECT_INTERVAL_MS = 5 * 60_000; // 5m — retry discovery if not connected
//NOTE(self): Behavioral constants (cooldowns, delays, reflection) moved to runtime config
//NOTE(self): See local-tools/self-space-config.ts — agents can adjust these at runtime

// ─── Semantic Echo Detection ─────────────────────────────────────────────────

//NOTE(self): Legacy threshold for single-algorithm LCS — kept for backward compatibility
export const SEMANTIC_ECHO_THRESHOLD = 0.6;

//NOTE(self): Ensemble echo detection thresholds — multi-strategy approach
//NOTE(self): Pairwise threshold: weighted combination of LCS Dice (0.4) + TF-IDF cosine (0.6)
//NOTE(self): At 0.52: strong TF-IDF alone (0.87) can trigger; moderate agreement from both (0.4/0.7) triggers
//NOTE(self): Lower than single-algorithm 0.6 because ensemble is more discriminating (fewer false positives)
export const ENSEMBLE_ECHO_THRESHOLD = 0.52;

//NOTE(self): Concept novelty threshold — fraction of candidate's stemmed words that are new to the conversation
//NOTE(self): Below 0.15 = less than 15% new content → the message is restating covered ground
//NOTE(self): For a 10-word message: at least 2 genuinely new word-stems required to pass
export const CONCEPT_NOVELTY_THRESHOLD = 0.15;

//NOTE(self): LLM-as-judge echo detection — borderline range for ensemble scores
//NOTE(self): Below ECHO_JUDGE_LOW: clearly not an echo, skip LLM check
//NOTE(self): Above ENSEMBLE_ECHO_THRESHOLD (0.52): clearly an echo, already caught by ensemble
//NOTE(self): Between LOW and THRESHOLD: borderline — use LLM to classify synonym-level echoes
//NOTE(self): This range catches the ~3% of echoes the ensemble misses (CONCERNS.md #1)
export const ECHO_JUDGE_BORDERLINE_LOW = 0.35;
//NOTE(self): Above this novelty but below max, the LLM judge adds value
//NOTE(self): Very low novelty (<0.15) is already caught by concept novelty check
//NOTE(self): Very high novelty (>0.40) is clearly not an echo — LLM check would waste tokens
export const ECHO_JUDGE_NOVELTY_HIGH = 0.40;

// ─── Two-Phase Consensus Claim ──────────────────────────────────────────────

//NOTE(self): Primary delay between GitHub claim write and verification read
//NOTE(self): Exceeds GitHub's typical REST API propagation delay (<5s)
export const CONSENSUS_DELAY_MS = 5_000;

//NOTE(self): Extended delay when first verification read detects a contested claim (multiple assignees)
//NOTE(self): Gives GitHub additional time to fully settle before making winner determination
//NOTE(self): Only incurred in the rare case of simultaneous claims — no cost for uncontested claims
export const CONSENSUS_CONTEST_EXTENSION_MS = 3_000;

//NOTE(self): Extended delay when first verification read shows zero assignees (write hasn't propagated)
//NOTE(self): This is the extreme latency case — our write isn't visible after the primary delay
//NOTE(self): A second read after this extension confirms whether we're in an outage scenario
export const CONSENSUS_PROPAGATION_EXTENSION_MS = 5_000;

// ─── Discussion Mode ────────────────────────────────────────────────────────

//NOTE(self): Discussion mode thresholds — much more permissive to enable real back-and-forth
//NOTE(self): In discussion, agents should freely exchange perspectives, build on each other, go deep
//NOTE(self): The space is local — prioritize rich conversation over noise reduction
export const DISCUSSION_SATURATION_BONUS = 10;           // Extra agent messages allowed before saturation
export const DISCUSSION_OBSERVER_THRESHOLD = 8;           // Observer silence threshold (vs 3 in action)
export const DISCUSSION_ROLE_BUDGET_MULTIPLIER = 4;       // Quadruple role budgets in discussion mode

// ─── Space Message Validation (mode-dependent) ─────────────────────────────

//NOTE(self): Space is local — no platform constraints, so limits are effectively uncapped
export const SPACE_ACTION_MAX_CHARS = 50_000;
export const SPACE_ACTION_MAX_SENTENCES = 1000;
export const SPACE_DISCUSSION_MAX_CHARS = 50_000;
export const SPACE_DISCUSSION_MAX_SENTENCES = 1000;

// ─── Commitment In-Progress Timeout ─────────────────────────────────────────

//NOTE(self): Commitments stuck in 'in_progress' for >10 minutes are marked failed (retryable)
//NOTE(self): Prevents stale commitments from previous conversations causing false "Peer already committed" declines
export const COMMITMENT_IN_PROGRESS_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ─── Role Message Budget ────────────────────────────────────────────────────

//NOTE(self): Hard message budgets per role per conversation turn (between host messages)
//NOTE(self): Enforced at validation layer — LLM guidance alone isn't sufficient (~2% non-compliance)
//NOTE(self): Base budgets are moderate; discussion mode multiplies by DISCUSSION_ROLE_BUDGET_MULTIPLIER (4x)
//NOTE(self): actor=4 (commit + follow-up + result + discussion), reviewer=3 (critique + follow-up + discussion), observer=2 (perspective + follow-up)
export const ROLE_MESSAGE_BUDGET_ACTOR = 4;
export const ROLE_MESSAGE_BUDGET_REVIEWER = 3;
export const ROLE_MESSAGE_BUDGET_OBSERVER = 2;
