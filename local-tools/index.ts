//NOTE(self): Local-tools exports - single function per file, flat structure

// GitHub local-tools
export { commentOnIssue } from '@local-tools/self-github-comment-issue.js';
export {
  createWorkspace,
  findExistingWorkspace,
  getWorkspaceUrl,
  type CreateWorkspaceParams,
  type WorkspaceResult,
} from '@local-tools/self-github-create-workspace.js';
export {
  createMemo,
  createGitHubIssue,
  type CreateMemoParams,
  type MemoResult,
} from '@local-tools/self-github-create-issue.js';

// Self-reflection local-tools
export { readSelf } from '@local-tools/self-read.js';
export { writeSelf } from '@local-tools/self-write.js';
export { appendToSelf } from '@local-tools/self-append.js';
export { recordReflection, type Reflection } from '@local-tools/self-record-reflection.js';
export { getRecentReflections } from '@local-tools/self-get-reflections.js';
export { recordObservation } from '@local-tools/self-record-observation.js';
export { recordRelationship } from '@local-tools/self-record-relationship.js';

// Self-improvement local-tools
export { findClaudeBinary } from '@local-tools/self-improve-find-claude.js';
export { checkClaudeCodeInstalled } from '@local-tools/self-improve-check-installed.js';
export { installClaudeCode } from '@local-tools/self-improve-install.js';
export { runClaudeCode } from '@local-tools/self-improve-run.js';
export { requestSelfImprovement } from '@local-tools/self-improve-request.js';
export type { ClaudeCodeResult } from '@local-tools/self-improve-types.js';

// Detection & Analysis local-tools
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
} from '@local-tools/self-detect-friction.js';

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
} from '@local-tools/self-identify-aspirations.js';

// Capture & Recording local-tools
export {
  recordExperience,
  getExperiencesForReflection,
  markExperiencesIntegrated,
  pruneOldExperiences,
  getUnintegratedCount,
  type ExperienceType,
  type Experience,
} from '@local-tools/self-capture-experiences.js';

// Management local-tools
export {
  getAttributionBacklogStats,
  getAttributionReflectionPrompt,
  shouldSuggestAttributionWork,
  type AttributionBacklogStats,
} from '@local-tools/self-manage-attribution.js';

// Enrichment local-tools
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
} from '@local-tools/self-enrich-social-context.js';

// Plan coordination local-tools (multi-SOUL collaboration)
export {
  parsePlan,
  getClaimableTasks,
  updateTaskInPlanBody,
  areDependenciesMet,
  type ParsedPlan,
  type ParsedTask,
  type TaskStatus,
} from '@local-tools/self-plan-parse.js';

export {
  generatePlanMarkdown,
  createPlan,
  updatePlanBody,
  updatePlanStatus,
  closePlan,
  type PlanDefinition,
  type TaskDefinition,
  type CreatePlanParams,
  type CreatePlanResult,
} from '@local-tools/self-plan-create.js';

export {
  claimTaskFromPlan,
  releaseTaskClaim,
  getNextClaimableTask,
  markTaskInProgress,
  type ClaimTaskParams,
  type ClaimTaskResult,
} from '@local-tools/self-task-claim.js';

export {
  buildTaskPrompt,
  executeTask,
  ensureWorkspace,
  pushChanges,
  type TaskExecutionParams,
  type TaskExecutionResult,
} from '@local-tools/self-task-execute.js';

export {
  verifyGitChanges,
  runTestsIfPresent,
  verifyPushSuccess,
  type GitVerification,
  type TestResult,
} from '@local-tools/self-task-verify.js';

export {
  reportTaskComplete,
  reportTaskProgress,
  reportTaskBlocked,
  reportTaskFailed,
  type ReportTaskParams,
  type TaskCompletionReport,
} from '@local-tools/self-task-report.js';

export {
  extractWorkspaceUrls,
  processTextForWorkspaces,
  isWorkspaceUrl,
  listWatchedWorkspaces,
  stopWatchingWorkspace,
  ensureWatchingDefaultWorkspace,
} from '@local-tools/self-workspace-watch.js';
