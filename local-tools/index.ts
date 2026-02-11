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

// Self-improvement local-tools
export { findClaudeBinary } from '@local-tools/self-improve-find-claude.js';
export { installClaudeCode } from '@local-tools/self-improve-install.js';
export { runClaudeCode } from '@local-tools/self-improve-run.js';
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

// Extract & Analysis local-tools (moved from modules/)
export {
  extractFromSelf,
  assessSelfRichness,
  getSocialMechanics,
  randomFrom,
  PROJECT_SOCIAL_MECHANICS,
  type SelfExtract,
  type SocialMechanics,
} from '@local-tools/self-extract.js';

// Commitment local-tools (moved from modules/)
export {
  extractCommitments,
  type ReplyForExtraction,
  type ExtractedCommitment,
} from '@local-tools/self-commitment-extract.js';

export {
  fulfillCommitment,
  type FulfillmentResult,
} from '@local-tools/self-commitment-fulfill.js';

// Announcement local-tool (moved from modules/)
export { announceIfWorthy } from '@local-tools/self-announcement.js';
