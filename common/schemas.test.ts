import { describe, it, expect } from 'vitest';
import {
  VALID_COMMITMENT_TYPES,
  normalizeCommitmentFields,
  CommitmentSchema,
  SpaceDecisionSchema,
  ExtractedCommitmentSchema,
  ExtractedCommitmentArraySchema,
  SPACE_DECISION_TOOL,
  parseSpaceDecision,
  validateCommitments,
} from '@common/schemas.js';

// ─── VALID_COMMITMENT_TYPES ─────────────────────────────────────────────────

describe('VALID_COMMITMENT_TYPES', () => {
  it('contains exactly 4 commitment types', () => {
    expect(VALID_COMMITMENT_TYPES).toHaveLength(4);
  });

  it('includes all expected types', () => {
    expect(VALID_COMMITMENT_TYPES).toContain('create_issue');
    expect(VALID_COMMITMENT_TYPES).toContain('create_plan');
    expect(VALID_COMMITMENT_TYPES).toContain('comment_issue');
    expect(VALID_COMMITMENT_TYPES).toContain('post_bluesky');
  });
});

// ─── normalizeCommitmentFields ──────────────────────────────────────────────

describe('normalizeCommitmentFields', () => {
  it('maps "action" to "type"', () => {
    const result = normalizeCommitmentFields({ action: 'create_issue' });
    expect(result).toEqual({ type: 'create_issue' });
  });

  it('maps "commitmentType" to "type"', () => {
    const result = normalizeCommitmentFields({ commitmentType: 'create_plan' });
    expect(result).toEqual({ type: 'create_plan' });
  });

  it('maps "kind" to "type"', () => {
    const result = normalizeCommitmentFields({ kind: 'post_bluesky' });
    expect(result).toEqual({ type: 'post_bluesky' });
  });

  it('maps "repository" to "repo"', () => {
    const result = normalizeCommitmentFields({ repository: 'owner/repo' });
    expect(result).toEqual({ repo: 'owner/repo' });
  });

  it('maps "name" to "title"', () => {
    const result = normalizeCommitmentFields({ name: 'My Title' });
    expect(result).toEqual({ title: 'My Title' });
  });

  it('maps "subject" to "title"', () => {
    const result = normalizeCommitmentFields({ subject: 'My Subject' });
    expect(result).toEqual({ title: 'My Subject' });
  });

  it('maps "body" to "description"', () => {
    const result = normalizeCommitmentFields({ body: 'Some body' });
    expect(result).toEqual({ description: 'Some body' });
  });

  it('maps "details" to "description"', () => {
    const result = normalizeCommitmentFields({ details: 'Some details' });
    expect(result).toEqual({ description: 'Some details' });
  });

  it('maps "text" to "content"', () => {
    const result = normalizeCommitmentFields({ text: 'Some text' });
    expect(result).toEqual({ content: 'Some text' });
  });

  it('maps "message" to "content"', () => {
    const result = normalizeCommitmentFields({ message: 'Some message' });
    expect(result).toEqual({ content: 'Some message' });
  });

  it('maps "post" to "content"', () => {
    const result = normalizeCommitmentFields({ post: 'A post' });
    expect(result).toEqual({ content: 'A post' });
  });

  it('canonical names take priority over aliases when both present', () => {
    const result = normalizeCommitmentFields({
      type: 'create_issue',
      action: 'post_bluesky',
      title: 'Canonical Title',
      name: 'Alias Title',
      description: 'Canonical Desc',
      body: 'Alias Desc',
      content: 'Canonical Content',
      text: 'Alias Content',
      repo: 'canonical/repo',
      repository: 'alias/repo',
    });

    expect(result.type).toBe('create_issue');
    expect(result.title).toBe('Canonical Title');
    expect(result.description).toBe('Canonical Desc');
    expect(result.content).toBe('Canonical Content');
    expect(result.repo).toBe('canonical/repo');
  });

  it('alias overwrites canonical when canonical is empty string', () => {
    const result = normalizeCommitmentFields({
      type: '',
      action: 'create_issue',
    });
    expect(result.type).toBe('create_issue');
  });

  it('alias overwrites canonical when canonical is null', () => {
    const result = normalizeCommitmentFields({
      type: null,
      action: 'create_issue',
    });
    expect(result.type).toBe('create_issue');
  });

  it('alias overwrites canonical when canonical is undefined', () => {
    const result = normalizeCommitmentFields({
      type: undefined,
      action: 'create_issue',
    });
    expect(result.type).toBe('create_issue');
  });

  it('passes through unknown keys unchanged', () => {
    const result = normalizeCommitmentFields({
      type: 'create_issue',
      customField: 'custom_value',
      anotherKey: 42,
    });
    expect(result.type).toBe('create_issue');
    expect(result.customField).toBe('custom_value');
    expect(result.anotherKey).toBe(42);
  });

  it('returns empty object for empty input', () => {
    const result = normalizeCommitmentFields({});
    expect(result).toEqual({});
  });

  it('handles multiple aliases mapping to the same canonical key', () => {
    // "text", "message", "post" all map to "content" -- first one wins
    const result = normalizeCommitmentFields({
      text: 'from text',
      message: 'from message',
      post: 'from post',
    });
    expect(result.content).toBe('from text');
  });
});

// ─── CommitmentSchema ───────────────────────────────────────────────────────

describe('CommitmentSchema', () => {
  it('accepts a valid commitment with title', () => {
    const result = CommitmentSchema.safeParse({
      type: 'create_issue',
      title: 'Fix the bug',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid commitment with description', () => {
    const result = CommitmentSchema.safeParse({
      type: 'create_plan',
      description: 'A detailed plan',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid commitment with content', () => {
    const result = CommitmentSchema.safeParse({
      type: 'post_bluesky',
      content: 'Hello world!',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a commitment with all optional fields populated', () => {
    const result = CommitmentSchema.safeParse({
      type: 'create_issue',
      repo: 'owner/repo',
      title: 'Issue title',
      description: 'Issue description',
      content: 'Extra content',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repo).toBe('owner/repo');
      expect(result.data.title).toBe('Issue title');
      expect(result.data.description).toBe('Issue description');
      expect(result.data.content).toBe('Extra content');
    }
  });

  it('fails when type is missing', () => {
    const result = CommitmentSchema.safeParse({
      title: 'No type provided',
    });
    expect(result.success).toBe(false);
  });

  it('fails when type is invalid', () => {
    const result = CommitmentSchema.safeParse({
      type: 'send_email',
      title: 'Invalid type',
    });
    expect(result.success).toBe(false);
  });

  it('fails when no content field is provided (title, description, or content)', () => {
    const result = CommitmentSchema.safeParse({
      type: 'create_issue',
    });
    expect(result.success).toBe(false);
  });

  it('fails when content fields are all missing even with repo present', () => {
    const result = CommitmentSchema.safeParse({
      type: 'create_issue',
      repo: 'owner/repo',
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown properties (Zod default behavior)', () => {
    const result = CommitmentSchema.safeParse({
      type: 'create_issue',
      title: 'Test',
      unknownField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownField).toBeUndefined();
    }
  });

  it('accepts each valid commitment type', () => {
    for (const type of VALID_COMMITMENT_TYPES) {
      const result = CommitmentSchema.safeParse({ type, title: 'Test' });
      expect(result.success).toBe(true);
    }
  });
});

// ─── SpaceDecisionSchema ────────────────────────────────────────────────────

describe('SpaceDecisionSchema', () => {
  it('accepts a minimal valid decision', () => {
    const result = SpaceDecisionSchema.safeParse({
      shouldSpeak: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shouldSpeak).toBe(true);
      expect(result.data.reason).toBe('');
    }
  });

  it('defaults reason to empty string when omitted', () => {
    const result = SpaceDecisionSchema.safeParse({
      shouldSpeak: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe('');
    }
  });

  it('accepts a full valid decision with all fields', () => {
    const result = SpaceDecisionSchema.safeParse({
      shouldSpeak: true,
      reason: 'I have something relevant to say',
      message: 'Here is my contribution',
      commitments: [{ type: 'post_bluesky', content: 'Hello' }],
      adjustBehavior: { cooldown: 30 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shouldSpeak).toBe(true);
      expect(result.data.reason).toBe('I have something relevant to say');
      expect(result.data.message).toBe('Here is my contribution');
      expect(result.data.commitments).toHaveLength(1);
      expect(result.data.adjustBehavior).toEqual({ cooldown: 30 });
    }
  });

  it('fails when shouldSpeak is missing', () => {
    const result = SpaceDecisionSchema.safeParse({
      reason: 'No shouldSpeak field',
    });
    expect(result.success).toBe(false);
  });

  it('fails when shouldSpeak is not a boolean', () => {
    const result = SpaceDecisionSchema.safeParse({
      shouldSpeak: 'yes',
    });
    expect(result.success).toBe(false);
  });

  it('accepts messages of any length (space is local — no platform constraints)', () => {
    const result = SpaceDecisionSchema.safeParse({
      shouldSpeak: true,
      message: 'x'.repeat(5000),
    });
    expect(result.success).toBe(true);
  });

  it('accepts decision without message', () => {
    const result = SpaceDecisionSchema.safeParse({
      shouldSpeak: false,
      reason: 'Nothing to say',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBeUndefined();
    }
  });

  it('accepts empty commitments array', () => {
    const result = SpaceDecisionSchema.safeParse({
      shouldSpeak: true,
      commitments: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commitments).toEqual([]);
    }
  });

  it('accepts commitments as array of arbitrary record objects', () => {
    const result = SpaceDecisionSchema.safeParse({
      shouldSpeak: true,
      commitments: [
        { action: 'create_issue', name: 'Test' },
        { kind: 'post_bluesky', text: 'hello' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commitments).toHaveLength(2);
    }
  });
});

// ─── parseSpaceDecision ─────────────────────────────────────────────────────

describe('parseSpaceDecision', () => {
  it('returns success with data for valid input', () => {
    const result = parseSpaceDecision({
      shouldSpeak: true,
      reason: 'Testing',
      message: 'Hello',
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.shouldSpeak).toBe(true);
    expect(result.data!.reason).toBe('Testing');
    expect(result.data!.message).toBe('Hello');
    expect(result.error).toBeUndefined();
  });

  it('returns failure with error string for invalid input', () => {
    const result = parseSpaceDecision({
      reason: 'Missing shouldSpeak',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
    expect(result.data).toBeUndefined();
  });

  it('accepts long messages (space is local — no platform constraints)', () => {
    const result = parseSpaceDecision({
      shouldSpeak: true,
      message: 'a'.repeat(5000),
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.message).toHaveLength(5000);
  });

  it('handles non-object input gracefully', () => {
    const result = parseSpaceDecision('not an object');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('handles null input gracefully', () => {
    const result = parseSpaceDecision(null);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('handles undefined input gracefully', () => {
    const result = parseSpaceDecision(undefined);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('handles numeric input gracefully', () => {
    const result = parseSpaceDecision(42);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('applies defaults when parsing valid minimal input', () => {
    const result = parseSpaceDecision({ shouldSpeak: false });
    expect(result.success).toBe(true);
    expect(result.data!.reason).toBe('');
  });
});

// ─── validateCommitments ────────────────────────────────────────────────────

describe('validateCommitments', () => {
  it('validates a batch of valid commitments', () => {
    const { valid, dropped } = validateCommitments([
      { type: 'create_issue', title: 'Bug fix' },
      { type: 'post_bluesky', content: 'Hello Bluesky!' },
    ]);
    expect(valid).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it('normalizes field names before validation', () => {
    const { valid, dropped } = validateCommitments([
      { action: 'create_issue', name: 'Normalized title' },
    ]);
    expect(valid).toHaveLength(1);
    expect(dropped).toHaveLength(0);
    expect(valid[0].type).toBe('create_issue');
    expect(valid[0].title).toBe('Normalized title');
  });

  it('drops invalid commitments with reasons', () => {
    const { valid, dropped } = validateCommitments([
      { type: 'create_issue', title: 'Good one' },
      { type: 'invalid_type', title: 'Bad type' },
      { type: 'create_issue' }, // no content field
    ]);
    expect(valid).toHaveLength(1);
    expect(dropped).toHaveLength(2);
    expect(dropped[0].reason).toBeDefined();
    expect(dropped[0].reason.length).toBeGreaterThan(0);
    expect(dropped[1].reason).toBeDefined();
  });

  it('includes the original raw object in dropped items', () => {
    const rawBad = { type: 'fake_type', title: 'Bad' };
    const { dropped } = validateCommitments([rawBad]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].raw).toBe(rawBad);
  });

  it('returns empty arrays for empty input', () => {
    const { valid, dropped } = validateCommitments([]);
    expect(valid).toHaveLength(0);
    expect(dropped).toHaveLength(0);
  });

  describe('socialOnly filtering', () => {
    it('blocks create_issue when socialOnly is true', () => {
      const { valid, dropped } = validateCommitments(
        [{ type: 'create_issue', title: 'Issue' }],
        { socialOnly: true }
      );
      expect(valid).toHaveLength(0);
      expect(dropped).toHaveLength(1);
      expect(dropped[0].reason).toContain('Social-only');
      expect(dropped[0].reason).toContain('create_issue');
    });

    it('blocks create_plan when socialOnly is true', () => {
      const { valid, dropped } = validateCommitments(
        [{ type: 'create_plan', title: 'Plan' }],
        { socialOnly: true }
      );
      expect(valid).toHaveLength(0);
      expect(dropped).toHaveLength(1);
      expect(dropped[0].reason).toContain('Social-only');
      expect(dropped[0].reason).toContain('create_plan');
    });

    it('blocks comment_issue when socialOnly is true', () => {
      const { valid, dropped } = validateCommitments(
        [{ type: 'comment_issue', description: 'Comment' }],
        { socialOnly: true }
      );
      expect(valid).toHaveLength(0);
      expect(dropped).toHaveLength(1);
      expect(dropped[0].reason).toContain('Social-only');
      expect(dropped[0].reason).toContain('comment_issue');
    });

    it('allows post_bluesky when socialOnly is true', () => {
      const { valid, dropped } = validateCommitments(
        [{ type: 'post_bluesky', content: 'Hello!' }],
        { socialOnly: true }
      );
      expect(valid).toHaveLength(1);
      expect(dropped).toHaveLength(0);
      expect(valid[0].type).toBe('post_bluesky');
    });

    it('allows all types when socialOnly is false', () => {
      const { valid, dropped } = validateCommitments(
        [
          { type: 'create_issue', title: 'Issue' },
          { type: 'create_plan', title: 'Plan' },
          { type: 'comment_issue', description: 'Comment' },
          { type: 'post_bluesky', content: 'Post' },
        ],
        { socialOnly: false }
      );
      expect(valid).toHaveLength(4);
      expect(dropped).toHaveLength(0);
    });

    it('allows all types when options not provided', () => {
      const { valid, dropped } = validateCommitments([
        { type: 'create_issue', title: 'Issue' },
        { type: 'post_bluesky', content: 'Post' },
      ]);
      expect(valid).toHaveLength(2);
      expect(dropped).toHaveLength(0);
    });

    it('filters github types while keeping social + dropping invalid in same batch', () => {
      const { valid, dropped } = validateCommitments(
        [
          { type: 'create_issue', title: 'Blocked' },
          { type: 'post_bluesky', content: 'Allowed' },
          { type: 'bad_type', title: 'Invalid' },
        ],
        { socialOnly: true }
      );
      expect(valid).toHaveLength(1);
      expect(valid[0].type).toBe('post_bluesky');
      expect(dropped).toHaveLength(2);
    });
  });
});

// ─── SPACE_DECISION_TOOL ────────────────────────────────────────────────────

describe('SPACE_DECISION_TOOL', () => {
  it('has the correct tool name', () => {
    expect(SPACE_DECISION_TOOL.name).toBe('space_decision');
  });

  it('has a description', () => {
    expect(SPACE_DECISION_TOOL.description).toBeDefined();
    expect(typeof SPACE_DECISION_TOOL.description).toBe('string');
    expect(SPACE_DECISION_TOOL.description.length).toBeGreaterThan(0);
  });

  it('has input_schema of type object', () => {
    expect(SPACE_DECISION_TOOL.input_schema.type).toBe('object');
  });

  it('requires shouldSpeak and reason', () => {
    expect(SPACE_DECISION_TOOL.input_schema.required).toContain('shouldSpeak');
    expect(SPACE_DECISION_TOOL.input_schema.required).toContain('reason');
  });

  it('defines shouldSpeak as boolean', () => {
    const props = SPACE_DECISION_TOOL.input_schema.properties;
    expect(props.shouldSpeak.type).toBe('boolean');
  });

  it('defines reason as string', () => {
    const props = SPACE_DECISION_TOOL.input_schema.properties;
    expect(props.reason.type).toBe('string');
  });

  it('defines message as string', () => {
    const props = SPACE_DECISION_TOOL.input_schema.properties;
    expect(props.message.type).toBe('string');
  });

  it('defines commitments as array', () => {
    const props = SPACE_DECISION_TOOL.input_schema.properties;
    expect(props.commitments.type).toBe('array');
  });

  it('defines commitment items as object with type enum', () => {
    const items = SPACE_DECISION_TOOL.input_schema.properties.commitments.items;
    expect(items.type).toBe('object');
    expect(items.properties.type.enum).toEqual([
      'create_issue',
      'create_plan',
      'comment_issue',
      'post_bluesky',
    ]);
  });

  it('requires type in commitment items', () => {
    const items = SPACE_DECISION_TOOL.input_schema.properties.commitments.items;
    expect(items.required).toContain('type');
  });

  it('defines adjustBehavior as object', () => {
    const props = SPACE_DECISION_TOOL.input_schema.properties;
    expect(props.adjustBehavior.type).toBe('object');
  });
});

// ─── ExtractedCommitmentSchema ──────────────────────────────────────────────

describe('ExtractedCommitmentSchema', () => {
  it('accepts a valid extracted commitment', () => {
    const result = ExtractedCommitmentSchema.safeParse({
      description: 'Create a tracking issue',
      type: 'create_issue',
      confidence: 'high',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('Create a tracking issue');
      expect(result.data.type).toBe('create_issue');
      expect(result.data.confidence).toBe('high');
      expect(result.data.params).toEqual({});
    }
  });

  it('accepts all valid confidence levels', () => {
    for (const confidence of ['high', 'medium', 'low'] as const) {
      const result = ExtractedCommitmentSchema.safeParse({
        description: 'Test',
        type: 'post_bluesky',
        confidence,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts optional params', () => {
    const result = ExtractedCommitmentSchema.safeParse({
      description: 'Post update',
      type: 'post_bluesky',
      confidence: 'medium',
      params: { hashtag: '#test', urgent: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.params).toEqual({ hashtag: '#test', urgent: true });
    }
  });

  it('defaults params to empty object when omitted', () => {
    const result = ExtractedCommitmentSchema.safeParse({
      description: 'Test',
      type: 'create_plan',
      confidence: 'low',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.params).toEqual({});
    }
  });

  it('fails when confidence is missing', () => {
    const result = ExtractedCommitmentSchema.safeParse({
      description: 'Test',
      type: 'create_issue',
    });
    expect(result.success).toBe(false);
  });

  it('fails when confidence is invalid', () => {
    const result = ExtractedCommitmentSchema.safeParse({
      description: 'Test',
      type: 'create_issue',
      confidence: 'very_high',
    });
    expect(result.success).toBe(false);
  });

  it('fails when description is missing', () => {
    const result = ExtractedCommitmentSchema.safeParse({
      type: 'create_issue',
      confidence: 'high',
    });
    expect(result.success).toBe(false);
  });

  it('fails when type is missing', () => {
    const result = ExtractedCommitmentSchema.safeParse({
      description: 'Test',
      confidence: 'high',
    });
    expect(result.success).toBe(false);
  });

  it('fails when type is invalid', () => {
    const result = ExtractedCommitmentSchema.safeParse({
      description: 'Test',
      type: 'send_email',
      confidence: 'high',
    });
    expect(result.success).toBe(false);
  });
});

// ─── ExtractedCommitmentArraySchema ─────────────────────────────────────────

describe('ExtractedCommitmentArraySchema', () => {
  it('accepts an empty array', () => {
    const result = ExtractedCommitmentArraySchema.safeParse([]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('accepts an array of valid extracted commitments', () => {
    const result = ExtractedCommitmentArraySchema.safeParse([
      { description: 'First', type: 'create_issue', confidence: 'high' },
      { description: 'Second', type: 'post_bluesky', confidence: 'low', params: { key: 'val' } },
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('fails if any item in the array is invalid', () => {
    const result = ExtractedCommitmentArraySchema.safeParse([
      { description: 'Good', type: 'create_issue', confidence: 'high' },
      { description: 'Bad', type: 'invalid_type', confidence: 'high' },
    ]);
    expect(result.success).toBe(false);
  });

  it('fails for non-array input', () => {
    const result = ExtractedCommitmentArraySchema.safeParse({
      description: 'Not an array',
      type: 'create_issue',
      confidence: 'high',
    });
    expect(result.success).toBe(false);
  });
});
