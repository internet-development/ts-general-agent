//NOTE(self): Runtime-configurable space participation behavior
//NOTE(self): Agents can adjust their own conversation pacing by writing to .memory/space-config.json
//NOTE(self): This file is read fresh on every participation check — no restart needed
//NOTE(self): Operators can also hand-edit the JSON for immediate effect

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@modules/logger.js';
import { stampVersion, checkVersion } from '@common/memory-version.js';

const CONFIG_PATH = '.memory/space-config.json';

export interface SpaceConfig {
  checkIntervalMs: number;
  reconnectIntervalMs: number;
  cooldownMinMs: number;
  cooldownMaxMs: number;
  replyDelayMinMs: number;
  replyDelayMaxMs: number;
  reflectionEveryN: number;
  behaviorNotes: string;
  lastAdjustedAt: string | null;
  lastAdjustedReason: string;
}

const DEFAULTS: SpaceConfig = {
  checkIntervalMs: 5_000,
  reconnectIntervalMs: 5 * 60_000,
  cooldownMinMs: 10_000,
  cooldownMaxMs: 20_000,
  replyDelayMinMs: 1_000,
  replyDelayMaxMs: 3_000,
  reflectionEveryN: 5,
  behaviorNotes: '',
  lastAdjustedAt: null,
  lastAdjustedReason: '',
};

//NOTE(self): Sanity clamps — prevent extreme values from breaking the conversation loop
interface Clamp { min: number; max: number }
const CLAMPS: Record<string, Clamp> = {
  checkIntervalMs:     { min: 2_000,  max: 30_000 },
  reconnectIntervalMs: { min: 30_000, max: 30 * 60_000 },
  cooldownMinMs:       { min: 3_000,  max: 2 * 60_000 },
  cooldownMaxMs:       { min: 3_000,  max: 5 * 60_000 },
  replyDelayMinMs:     { min: 500,    max: 10_000 },
  replyDelayMaxMs:     { min: 500,    max: 30_000 },
  reflectionEveryN:    { min: 1,      max: 50 },
};

function clampValue(field: string, value: number): number {
  const c = CLAMPS[field];
  if (!c) return value;
  return Math.max(c.min, Math.min(c.max, Math.round(value)));
}

//NOTE(self): Ensure min/max pairs are consistent (max >= min)
function enforceMinMaxPairs(config: SpaceConfig): SpaceConfig {
  if (config.cooldownMaxMs < config.cooldownMinMs) {
    config.cooldownMaxMs = config.cooldownMinMs;
  }
  if (config.replyDelayMaxMs < config.replyDelayMinMs) {
    config.replyDelayMaxMs = config.replyDelayMinMs;
  }
  return config;
}

//NOTE(self): Read from disk every time — hot-reloadable, no cache
export function loadSpaceConfig(): SpaceConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const data = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      if (!checkVersion(data)) {
        logger.info('Space config version mismatch, using defaults', { path: CONFIG_PATH });
        return { ...DEFAULTS };
      }
      //NOTE(self): Merge with defaults so new fields are always present
      const merged: SpaceConfig = { ...DEFAULTS };
      for (const key of Object.keys(DEFAULTS) as (keyof SpaceConfig)[]) {
        if (key in data && data[key] !== undefined) {
          (merged as any)[key] = data[key];
        }
      }
      //NOTE(self): Clamp numeric fields
      for (const field of Object.keys(CLAMPS)) {
        if (typeof (merged as any)[field] === 'number') {
          (merged as any)[field] = clampValue(field, (merged as any)[field]);
        }
      }
      return enforceMinMaxPairs(merged);
    }
  } catch (err) {
    logger.error('Failed to load space config', { error: String(err) });
  }
  return { ...DEFAULTS };
}

export function saveSpaceConfig(config: SpaceConfig): void {
  try {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(stampVersion(config), null, 2));
  } catch (err) {
    logger.error('Failed to save space config', { error: String(err) });
  }
}

//NOTE(self): Partial update with sanity clamps — used when the agent adjusts its own behavior
export function updateSpaceConfig(adjustments: Partial<SpaceConfig>, reason: string): SpaceConfig {
  const current = loadSpaceConfig();

  for (const [key, value] of Object.entries(adjustments)) {
    if (key in DEFAULTS && value !== undefined) {
      if (typeof value === 'number' && key in CLAMPS) {
        (current as any)[key] = clampValue(key, value);
      } else {
        (current as any)[key] = value;
      }
    }
  }

  current.lastAdjustedAt = new Date().toISOString();
  current.lastAdjustedReason = reason;

  enforceMinMaxPairs(current);
  saveSpaceConfig(current);

  logger.info('Space config updated', { reason, adjustments });
  return current;
}

function formatMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

//NOTE(self): Human-readable summary for LLM prompt context
export function formatSpaceConfigForPrompt(config: SpaceConfig): string {
  const lines: string[] = [
    `**Current conversation pacing:**`,
    `- Cooldown after speaking: ${formatMs(config.cooldownMinMs)}–${formatMs(config.cooldownMaxMs)}`,
    `- Reply delay: ${formatMs(config.replyDelayMinMs)}–${formatMs(config.replyDelayMaxMs)}`,
    `- Reflection every ${config.reflectionEveryN} messages`,
  ];

  if (config.behaviorNotes) {
    lines.push(`- Behavioral notes: ${config.behaviorNotes}`);
  }

  if (config.lastAdjustedAt) {
    lines.push(`- Last adjusted: ${config.lastAdjustedAt} — ${config.lastAdjustedReason}`);
  }

  return lines.join('\n');
}
