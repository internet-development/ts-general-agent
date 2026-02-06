//NOTE(self): Core module exports
export * from '@modules/config.js';
export * from '@modules/logger.js';
export * from '@modules/memory.js';
export * from '@modules/openai.js';
export * from '@modules/exec.js';
export * from '@modules/loop.js';
export * from '@modules/sandbox.js';
export * from '@modules/tools.js';
export * from '@modules/executor.js';
export * from '@modules/ui.js';
export * from '@modules/pacing.js';
export * from '@modules/post-log.js';

//NOTE(self): New scheduler architecture modules
export * from '@modules/self-extract.js';
export * from '@modules/expression.js';
export * from '@modules/scheduler.js';
export * from '@modules/workspace-discovery.js';
export * from '@modules/peer-awareness.js';

//NOTE(self): Re-export skills that were migrated from modules for backward compatibility
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

export {
  recordExperience,
  getExperiencesForReflection,
  markExperiencesIntegrated,
  pruneOldExperiences,
  getUnintegratedCount,
  type ExperienceType,
  type Experience,
} from '@skills/self-capture-experiences.js';

export {
  getAttributionBacklogStats,
  getAttributionReflectionPrompt,
  shouldSuggestAttributionWork,
  type AttributionBacklogStats,
} from '@skills/self-manage-attribution.js';

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
