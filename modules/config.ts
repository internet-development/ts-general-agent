import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '@modules/logger.js';
import { getRepoRoot } from '@modules/sandbox.js';

dotenvConfig();

export interface Config {
  agent: {
    name: string;
    model: string;
  };
  owner: {
    blueskyHandle: string;
    blueskyDid: string;
  };
  bluesky: {
    username: string;
    password: string;
  };
  github: {
    username: string;
    token: string;
  };
  paths: {
    root: string;
    memory: string;
    workrepos: string;
    soul: string;
    selfmd: string;
  };
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export function loadConfig(): Config {
  const root = getRepoRoot();

  return {
    agent: {
      name: requireEnv('AGENT_NAME'),
      model: optionalEnv('AI_GATEWAY_MODEL', 'openai/gpt-5.2'),
    },
    owner: {
      blueskyHandle: requireEnv('OWNER_BLUESKY_SOCIAL_HANDLE'),
      blueskyDid: requireEnv('OWNER_BLUESKY_SOCIAL_HANDLE_DID'),
    },
    bluesky: {
      username: requireEnv('AGENT_BLUESKY_USERNAME'),
      password: requireEnv('AGENT_BLUESKY_PASSWORD'),
    },
    github: {
      username: requireEnv('AGENT_GITHUB_USERNAME'),
      token: requireEnv('AGENT_GITHUB_TOKEN'),
    },
    paths: {
      root,
      memory: join(root, '.memory'),
      workrepos: join(root, '.workrepos'),
      soul: join(root, 'SOUL.md'),
      selfmd: join(root, 'SELF.md'),
    },
  };
}

export function validateConfig(config: Config): void {
  if (!existsSync(config.paths.soul)) {
    throw new Error('SOUL.md not found - agent identity is undefined');
  }
}

//NOTE(self): Initialize SELF.md from template on first run
export function initializeSelf(config: Config): void {
  const templatePath = join(config.paths.root, 'SELF.md.template');

  //NOTE(self): If SELF.md doesn't exist, create it from template
  if (!existsSync(config.paths.selfmd)) {
    if (existsSync(templatePath)) {
      try {
        let content = readFileSync(templatePath, 'utf-8');
        content = content.replace(/\{\{AGENT_NAME\}\}/g, config.agent.name);
        content = content.replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0]);
        writeFileSync(config.paths.selfmd, content, 'utf-8');
        logger.info('Created SELF.md', { agentName: config.agent.name });
      } catch (err) {
        logger.error('Failed to create SELF.md from template', { error: String(err) });
      }
    }
    return;
  }

  //NOTE(self): If SELF.md exists but has placeholders, replace them
  try {
    let content = readFileSync(config.paths.selfmd, 'utf-8');
    if (content.includes('{{AGENT_NAME}}') || content.includes('{{DATE}}')) {
      content = content.replace(/\{\{AGENT_NAME\}\}/g, config.agent.name);
      content = content.replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0]);
      writeFileSync(config.paths.selfmd, content, 'utf-8');
    }

    //NOTE(self): Auto-migrate: add ## Voice section if missing
    if (!content.match(/^## Voice/m)) {
      const voiceSection = `\n---\n\n## Voice\n\nHow I sound when I speak — my natural phrasing, tone, and word choices. This section shapes\nthe operational phrases I use in automated messages (task claims, fulfillment replies, etc.).\nI refine this through reflection as I discover what feels authentically me.\n\n**Tone:** Warm, direct, genuine. Not corporate, not overly casual.\n\n**When I finish something for someone:**\n- I keep it brief — the link speaks for itself\n- I sound like someone who enjoyed doing the work\n\n**When I claim a task:**\n- I'm clear about what I'm doing and that I'm starting now\n- I sound engaged, not robotic\n\n*These preferences shape my \`voice-phrases.json\` — regenerated each reflection cycle.*\n`;

      const constitutionMarker = content.match(/^---\s*\n+## Constitution of Care/m);
      if (constitutionMarker && constitutionMarker.index !== undefined) {
        content = content.slice(0, constitutionMarker.index) + voiceSection + '\n' + content.slice(constitutionMarker.index);
      } else {
        content = content.trimEnd() + '\n' + voiceSection;
      }
      writeFileSync(config.paths.selfmd, content, 'utf-8');
      logger.info('Auto-migrated SELF.md: added ## Voice section');
    }
  } catch (err) {
    logger.error('Failed to update SELF.md placeholders', { error: String(err) });
  }
}

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
    validateConfig(cachedConfig);
  }
  return cachedConfig;
}
