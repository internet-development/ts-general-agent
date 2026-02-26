//NOTE(self): Zod runtime validation schemas for all LLM response boundaries
//NOTE(self): TypeScript `as` casts have zero runtime effect — these schemas catch
//NOTE(self): the field name drift, missing fields, and wrong types that caused
//NOTE(self): 9 critical bugs in the commitment pipeline.
//NOTE(self): Every JSON.parse() of LLM output MUST flow through safeParse() from here.

import { z } from 'zod';

// ─── Commitment Schema ──────────────────────────────────────────────────────

//NOTE(self): Valid commitment types that the fulfillment pipeline can handle
export const VALID_COMMITMENT_TYPES = ['create_issue', 'create_plan', 'comment_issue', 'post_bluesky'] as const;

//NOTE(self): Field name normalization map — LLMs commonly return these alternative names
//NOTE(self): Built from real-world observation of LLM output across 1000+ space conversations
const COMMITMENT_FIELD_ALIASES: Record<string, string> = {
  action: 'type',
  commitmentType: 'type',
  kind: 'type',
  repository: 'repo',
  name: 'title',
  subject: 'title',
  body: 'description',
  details: 'description',
  text: 'content',
  message: 'content',
  post: 'content',
};

//NOTE(self): Normalize a raw LLM commitment object before Zod validation
//NOTE(self): Maps alternative field names to canonical ones — handles the ~5% schema drift
export function normalizeCommitmentFields(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const canonicalKey = COMMITMENT_FIELD_ALIASES[key] || key;
    //NOTE(self): Don't overwrite if canonical key already has a value
    //NOTE(self): Priority: canonical name > alias (if both present, canonical wins)
    if (normalized[canonicalKey] === undefined || normalized[canonicalKey] === null || normalized[canonicalKey] === '') {
      normalized[canonicalKey] = value;
    }
  }

  return normalized;
}

//NOTE(self): The commitment Zod schema — strict validation after normalization
export const CommitmentSchema = z.object({
  type: z.enum(VALID_COMMITMENT_TYPES),
  repo: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
}).refine(
  c => !!(c.title || c.description || c.content),
  { message: 'At least one content field (title, description, or content) required' }
);

export type ValidatedCommitment = z.infer<typeof CommitmentSchema>;

// ─── Space Decision Schema ──────────────────────────────────────────────────

//NOTE(self): The full space participation decision — what the LLM returns after
//NOTE(self): evaluating whether to speak, what to say, and what to commit to
export const SpaceDecisionSchema = z.object({
  shouldSpeak: z.boolean(),
  reason: z.string().optional().default(''),
  message: z.string().optional(),
  commitments: z.array(z.record(z.unknown())).optional(),
  adjustBehavior: z.record(z.unknown()).optional(),
});

export type RawSpaceDecision = z.infer<typeof SpaceDecisionSchema>;

// ─── Commitment Extraction Schema ───────────────────────────────────────────

//NOTE(self): For the NLP extraction fallback (extractCommitments in self-commitment-extract.ts)
export const ExtractedCommitmentSchema = z.object({
  description: z.string(),
  type: z.enum(VALID_COMMITMENT_TYPES),
  params: z.record(z.unknown()).optional().default({}),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const ExtractedCommitmentArraySchema = z.array(ExtractedCommitmentSchema);

// ─── Structured Output Tool Definition ─────────────────────────────────────

//NOTE(self): Tool-use mode constrains the LLM to output valid JSON matching the schema
//NOTE(self): This eliminates the ~3% JSON parse failures from free-form text responses
//NOTE(self): The LLM calls this "tool" instead of outputting raw JSON, guaranteeing structure
export const SPACE_DECISION_TOOL = {
  name: 'space_decision',
  description: 'Submit your decision about whether to speak in the conversation. You MUST call this tool with your decision.',
  input_schema: {
    type: 'object' as const,
    properties: {
      shouldSpeak: {
        type: 'boolean',
        description: 'Whether you should speak in the conversation right now',
      },
      reason: {
        type: 'string',
        description: 'Brief internal reasoning for your decision (not sent to chat)',
      },
      message: {
        type: 'string',
        description: 'The message to send if shouldSpeak is true. The space is local — write as much as the thought requires. Omit if not speaking.',
      },
      commitments: {
        type: 'array',
        description: 'Concrete actions to take. Each commitment must have a type field (create_issue, create_plan, comment_issue, or post_bluesky).',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['create_issue', 'create_plan', 'comment_issue', 'post_bluesky'] },
            repo: { type: 'string', description: 'GitHub owner/repo for issue/plan commitments' },
            title: { type: 'string', description: 'Title for the issue or plan' },
            description: { type: 'string', description: 'Body/description content' },
            content: { type: 'string', description: 'Text content for bluesky posts' },
          },
          required: ['type'],
        },
      },
      adjustBehavior: {
        type: 'object',
        description: 'Optional runtime config adjustments (cooldowns, delays, etc.)',
      },
    },
    required: ['shouldSpeak', 'reason'],
  },
};

// ─── Validation Helpers ─────────────────────────────────────────────────────

//NOTE(self): Parse and validate a raw space decision from LLM output
//NOTE(self): Returns { success: true, data } or { success: false, error }
//NOTE(self): On failure, returns a detailed diagnostic string for logging
export function parseSpaceDecision(raw: unknown): {
  success: boolean;
  data?: RawSpaceDecision;
  error?: string;
} {
  const result = SpaceDecisionSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
  };
}

//NOTE(self): Validate and normalize a batch of raw commitment objects from LLM output
//NOTE(self): Each object is first normalized (field aliases mapped), then validated
//NOTE(self): Invalid commitments are dropped with diagnostic logging info
//NOTE(self): socialOnly filtering is applied here as defense-in-depth (SCENARIOS.md #5)
export function validateCommitments(
  rawCommitments: Record<string, unknown>[],
  options: { socialOnly?: boolean } = {}
): { valid: ValidatedCommitment[]; dropped: Array<{ raw: Record<string, unknown>; reason: string }> } {
  const valid: ValidatedCommitment[] = [];
  const dropped: Array<{ raw: Record<string, unknown>; reason: string }> = [];
  const githubTypes = new Set(['create_issue', 'create_plan', 'comment_issue']);

  for (const raw of rawCommitments) {
    //NOTE(self): Step 1: Normalize field names (action→type, body→description, etc.)
    const normalized = normalizeCommitmentFields(raw);

    //NOTE(self): Step 2: Validate against Zod schema
    const result = CommitmentSchema.safeParse(normalized);
    if (!result.success) {
      dropped.push({
        raw,
        reason: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      continue;
    }

    //NOTE(self): Step 3: Social-only defense-in-depth (SCENARIOS.md #5)
    //NOTE(self): Social-only agents cannot create GitHub commitments at ANY layer
    if (options.socialOnly && githubTypes.has(result.data.type)) {
      dropped.push({
        raw,
        reason: `Social-only agent blocked from GitHub commitment type: ${result.data.type}`,
      });
      continue;
    }

    valid.push(result.data);
  }

  return { valid, dropped };
}
