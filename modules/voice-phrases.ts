//NOTE(self): Voice Phrases Module
//NOTE(self): Loads, interpolates, and regenerates operational phrases from voice-phrases.json.
//NOTE(self): Phrases are derived from ## Voice in SELF.md during reflection cycles.
//NOTE(self): Falls back to hardcoded defaults if the JSON is missing or corrupted.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getConfig } from '@modules/config.js';
import { readSelf } from '@modules/memory.js';
import { chat } from '@modules/llm-gateway.js';
import { extractFromSelf } from '@local-tools/self-extract.js';
import { logger } from '@modules/logger.js';

//NOTE(self): Schema for voice-phrases.json
export interface VoicePhrases {
  version: 1;
  generatedAt: string;
  fulfillment: {
    create_issue: string;
    create_plan: string;
    default: string;
  };
  task_claim: string;
  github: {
    task_claim: string;           //NOTE(self): {{number}}, {{title}}
    task_release: string;         //NOTE(self): {{number}}
    task_complete: string;        //NOTE(self): {{number}}, {{title}}, {{details}}, {{username}}
    task_progress: string;        //NOTE(self): {{number}}, {{details}}, {{username}}
    task_blocked: string;         //NOTE(self): {{number}}, {{title}}, {{details}}, {{username}}
    task_failed: string;          //NOTE(self): {{number}}, {{title}}, {{details}}, {{username}}
    plan_complete: string;        //NOTE(self): no placeholders
    workspace_finished: string;   //NOTE(self): {{summary}} — sentinel issue body when project is complete
  };
}

//NOTE(self): Hardcoded defaults — same strings that existed before this module
const DEFAULT_PHRASES: VoicePhrases = {
  version: 1,
  generatedAt: '',
  fulfillment: {
    create_issue: 'Done — here it is: {{url}}',
    create_plan: 'Plan is ready: {{url}}',
    default: 'Done: {{url}}',
  },
  task_claim: 'Claiming Task {{number}}: {{title}} from the plan. I\'ll start working on this now.',
  github: {
    task_claim: '🤖 **Claiming Task {{number}}: {{title}}**\n\nI\'ll start working on this now.',
    task_release: '🔓 **Releasing Task {{number}}**\n\nThis task is available to be claimed.',
    task_complete: '✅ **Task {{number}} Complete: {{title}}**\n\n{{details}}\n\n---\n*Completed by @{{username}}*',
    task_progress: '🔄 **Task {{number}} Progress**\n\n{{details}}\n\n---\n*Progress update by @{{username}}*',
    task_blocked: '🚫 **Task {{number}} Blocked: {{title}}**\n\n**Reason:**\n{{details}}\n\nThis task cannot proceed until the blocking issue is resolved.\n\n---\n*Blocked by @{{username}}*',
    task_failed: '❌ **Task {{number}} Failed: {{title}}**\n\n**Error:**\n```\n{{details}}\n```\n\nThis task encountered an error and could not be completed. Manual intervention may be required.\n\n---\n*Failed attempt by @{{username}}*',
    plan_complete: '🎉 **Plan Complete!**\n\nAll tasks have been completed. The plan is now ready for final verification.\n\nPlease review:\n- [ ] All changes are correct\n- [ ] Tests pass\n- [ ] Integration works as expected\n\nOnce verified, this issue can be closed.',
    workspace_finished: 'This workspace has been assessed as complete.\n\n**Summary:** {{summary}}\n\n---\n\n**What this means:**\n- No new plans will be created\n- No new tasks will be claimed\n- No new work will be started in this workspace\n\n**To restart work:** Close this issue, or comment on it describing what you need. Work will resume automatically on the next poll cycle.',
  },
};

//NOTE(self): Lazy-cached phrases
let _cached: VoicePhrases | null = null;

//NOTE(self): Load voice phrases from disk, falling back to defaults
export function loadVoicePhrases(): VoicePhrases {
  if (_cached) return _cached;

  const phrasesPath = join(getConfig().paths.root, 'voice-phrases.json');

  if (!existsSync(phrasesPath)) {
    _cached = DEFAULT_PHRASES;
    return _cached;
  }

  try {
    const raw = readFileSync(phrasesPath, 'utf-8');
    const parsed = JSON.parse(raw) as VoicePhrases;

    //NOTE(self): Validate structure — all required fields must exist
    if (
      parsed.version === 1 &&
      parsed.fulfillment?.create_issue &&
      parsed.fulfillment?.create_plan &&
      parsed.fulfillment?.default &&
      parsed.task_claim &&
      parsed.github?.task_claim &&
      parsed.github?.task_release &&
      parsed.github?.task_complete &&
      parsed.github?.task_progress &&
      parsed.github?.task_blocked &&
      parsed.github?.task_failed &&
      parsed.github?.plan_complete &&
      parsed.github?.workspace_finished
    ) {
      _cached = parsed;
      return _cached;
    }

    logger.warn('voice-phrases.json has invalid structure, using defaults');
    _cached = DEFAULT_PHRASES;
    return _cached;
  } catch (err) {
    logger.warn('Failed to load voice-phrases.json, using defaults', { error: String(err) });
    _cached = DEFAULT_PHRASES;
    return _cached;
  }
}

//NOTE(self): Generic template interpolation — replaces all {{key}} with values
function interpolate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

//NOTE(self): Get interpolated fulfillment phrase
export function getFulfillmentPhrase(type: string, url: string): string {
  const phrases = loadVoicePhrases();
  const template =
    type === 'create_issue' ? phrases.fulfillment.create_issue :
    type === 'create_plan' ? phrases.fulfillment.create_plan :
    phrases.fulfillment.default;
  return interpolate(template, { url });
}

//NOTE(self): Get interpolated task claim phrase
export function getTaskClaimPhrase(number: number, title: string): string {
  const phrases = loadVoicePhrases();
  return interpolate(phrases.task_claim, { number: String(number), title });
}

//NOTE(self): Get interpolated GitHub comment phrase
export function getGitHubPhrase(key: keyof VoicePhrases['github'], vars: Record<string, string>): string {
  const phrases = loadVoicePhrases();
  return interpolate(phrases.github[key], vars);
}

//NOTE(self): Validate that generated phrases preserve required placeholders
function validatePhrases(phrases: VoicePhrases): boolean {
  if (!phrases.fulfillment.create_issue.includes('{{url}}')) return false;
  if (!phrases.fulfillment.create_plan.includes('{{url}}')) return false;
  if (!phrases.fulfillment.default.includes('{{url}}')) return false;
  if (!phrases.task_claim.includes('{{number}}')) return false;
  if (!phrases.task_claim.includes('{{title}}')) return false;

  //NOTE(self): GitHub phrase placeholder validation
  const g = phrases.github;
  if (!g?.task_claim?.includes('{{number}}') || !g.task_claim.includes('{{title}}')) return false;
  if (!g?.task_release?.includes('{{number}}')) return false;
  for (const key of ['task_complete', 'task_progress', 'task_blocked', 'task_failed'] as const) {
    if (!g?.[key]?.includes('{{number}}') || !g[key].includes('{{details}}') || !g[key].includes('{{username}}')) return false;
  }
  for (const key of ['task_complete', 'task_blocked', 'task_failed'] as const) {
    if (!g?.[key]?.includes('{{title}}')) return false;
  }
  //NOTE(self): plan_complete has no required placeholders
  if (!g?.plan_complete) return false;
  //NOTE(self): workspace_finished must have {{summary}}
  if (!g?.workspace_finished?.includes('{{summary}}')) return false;

  return true;
}

//NOTE(self): Regenerate voice phrases from ## Voice in SELF.md via a lightweight LLM call
export async function regenerateVoicePhrases(): Promise<boolean> {
  const config = getConfig();
  const selfContent = readSelf(config.paths.selfmd);
  const extract = extractFromSelf(selfContent);

  if (!extract.voice) {
    logger.debug('No ## Voice section found in SELF.md, skipping regeneration');
    return false;
  }

  const prompt = `You are generating operational phrases for an autonomous agent based on their voice preferences.

Here is the agent's ## Voice section from SELF.md:

${extract.voice}

Generate a JSON object with these exact fields. Each string MUST contain the placeholders shown — they are interpolated at runtime.

{
  "version": 1,
  "generatedAt": "${new Date().toISOString()}",
  "fulfillment": {
    "create_issue": "phrase with {{url}} placeholder",
    "create_plan": "phrase with {{url}} placeholder",
    "default": "phrase with {{url}} placeholder"
  },
  "task_claim": "phrase with {{number}} and {{title}} placeholders",
  "github": {
    "task_claim": "markdown comment with {{number}} and {{title}} — posted when claiming a task",
    "task_release": "markdown comment with {{number}} — posted when releasing a task",
    "task_complete": "markdown comment with {{number}}, {{title}}, {{details}}, {{username}} — posted on task completion",
    "task_progress": "markdown comment with {{number}}, {{details}}, {{username}} — posted as progress update",
    "task_blocked": "markdown comment with {{number}}, {{title}}, {{details}}, {{username}} — posted when task is blocked",
    "task_failed": "markdown comment with {{number}}, {{title}}, {{details}}, {{username}} — posted when task fails",
    "plan_complete": "markdown comment (no placeholders) — posted when all tasks are done",
    "workspace_finished": "markdown issue body with {{summary}} — posted as the body of a 'project finished' sentinel issue. Explain what 'finished' means and how to restart work (close the issue or comment on it)"
  }
}

Rules:
- fulfillment and task_claim phrases: keep SHORT (under 120 chars each)
- github phrases: these are full GitHub issue comments — use markdown formatting (bold, headings, emoji)
- Multi-line templates use \\n in JSON strings (not actual newlines)
- Preserve ALL {{placeholders}} exactly — they are required
- Match the tone described in the Voice section
- Output ONLY valid JSON, no markdown fences, no explanation`;

  try {
    const response = await chat({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1000,
      temperature: 0.7,
    });

    //NOTE(self): Extract JSON from response (handle potential markdown fences)
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const generated = JSON.parse(jsonStr) as VoicePhrases;

    if (!validatePhrases(generated)) {
      logger.warn('Generated voice phrases missing required placeholders, keeping existing');
      return false;
    }

    //NOTE(self): Ensure version and timestamp
    generated.version = 1;
    generated.generatedAt = new Date().toISOString();

    const phrasesPath = join(config.paths.root, 'voice-phrases.json');
    writeFileSync(phrasesPath, JSON.stringify(generated, null, 2) + '\n', 'utf-8');

    //NOTE(self): Invalidate cache so next load picks up new phrases
    _cached = null;

    logger.info('Voice phrases regenerated from SELF.md');
    return true;
  } catch (err) {
    logger.warn('Voice phrase regeneration failed', { error: String(err) });
    return false;
  }
}
