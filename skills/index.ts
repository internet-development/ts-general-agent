//NOTE(self): Skills exports - single function per file, flat structure

// Bluesky skills
export { checkTimeline } from '@skills/self-bluesky-check-timeline.js';
export { checkNotifications } from '@skills/self-bluesky-check-notifications.js';
export { getOwnerFollows } from '@skills/self-bluesky-get-owner-follows.js';
export { replyToPost } from '@skills/self-bluesky-reply.js';
export { engageWithPost } from '@skills/self-bluesky-engage.js';
export { followPerson } from '@skills/self-bluesky-follow.js';
export { post } from '@skills/self-bluesky-post.js';
export type { EngagementTarget } from '@skills/self-bluesky-types.js';

// GitHub skills
export { getOpenIssues } from '@skills/self-github-get-issues.js';
export { getOpenPRs } from '@skills/self-github-get-prs.js';
export { commentOnIssue } from '@skills/self-github-comment-issue.js';
export { commentOnPR } from '@skills/self-github-comment-pr.js';
export { cloneRepo } from '@skills/self-github-clone-repo.js';
export { starRepo } from '@skills/self-github-star-repo.js';
export {
  createWorkspace,
  findExistingWorkspace,
  getWorkspaceUrl,
  type CreateWorkspaceParams,
  type WorkspaceResult,
} from '@skills/self-github-create-workspace.js';
export {
  createMemo,
  createGitHubIssue,
  type CreateMemoParams,
  type MemoResult,
} from '@skills/self-github-create-issue.js';
export type { RepoToMonitor } from '@skills/self-github-types.js';

// Self-reflection skills
export { readSelf } from '@skills/self-read.js';
export { writeSelf } from '@skills/self-write.js';
export { appendToSelf } from '@skills/self-append.js';
export { recordReflection, type Reflection } from '@skills/self-record-reflection.js';
export { getRecentReflections } from '@skills/self-get-reflections.js';
export { recordObservation } from '@skills/self-record-observation.js';
export { recordRelationship } from '@skills/self-record-relationship.js';

// Self-improvement skills
export { findClaudeBinary } from '@skills/self-improve-find-claude.js';
export { checkClaudeCodeInstalled } from '@skills/self-improve-check-installed.js';
export { installClaudeCode } from '@skills/self-improve-install.js';
export { runClaudeCode } from '@skills/self-improve-run.js';
export { requestSelfImprovement } from '@skills/self-improve-request.js';
export type { ClaudeCodeResult } from '@skills/self-improve-types.js';

// Detection & Analysis skills
export {
  recordFriction,
  getFrictionReadyForImprovement,
  shouldAttemptImprovement,
  markFrictionAttempted,
  recordImprovementOutcome,
  markFrictionResolved,
  getFrictionStats,
  buildImprovementPrompt,
  getUnresolvedFriction,
  cleanupResolvedFriction,
  loadFrictionState,
  type FrictionCategory,
  type FrictionRecord,
  type ImprovementRecord,
} from '@skills/self-detect-friction.js';

export {
  extractAspirations,
  refreshAspirations,
  getActionableAspirations,
  getAspirationForGrowth,
  shouldAttemptGrowth,
  markAspirationAttempted,
  recordGrowthOutcome,
  buildGrowthPrompt,
  getAspirationStats,
  getAllAspirations,
  type AspirationCategory,
  type Aspiration,
} from '@skills/self-identify-aspirations.js';

// Capture & Recording skills
export {
  recordExperience,
  getExperiencesForReflection,
  markExperiencesIntegrated,
  pruneOldExperiences,
  getUnintegratedCount,
  type ExperienceType,
  type Experience,
} from '@skills/self-capture-experiences.js';

// Management skills
export {
  getAttributionBacklogStats,
  getAttributionReflectionPrompt,
  shouldSuggestAttributionWork,
  type AttributionBacklogStats,
} from '@skills/self-manage-attribution.js';

// Enrichment skills
export {
  extractHandles,
  extractMentionedEntities,
  loadCachedProfile,
  cacheProfile,
  enrichMentionedEntities,
  formatEnrichedContext,
  buildSocialContext,
  type MentionedEntity,
  type EnrichedProfile,
  type SocialGraphData,
} from '@skills/self-enrich-social-context.js';
