import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

dotenvConfig();

export interface Config {
  agent: {
    name: string;
  };
  anthropic: {
    apiKey: string;
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
    self: string;
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
  const root = process.cwd();

  return {
    agent: {
      name: requireEnv('AGENT_NAME'),
    },
    anthropic: {
      apiKey: requireEnv('API_KEY_ANTHROPIC'),
      model: optionalEnv('ANTHROPIC_MODEL', 'claude-opus-4-5-20251101'),
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
      self: join(root, '.self'),
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
        console.log(`Created SELF.md for ${config.agent.name}`);
      } catch (err) {
        console.error('Failed to create SELF.md from template:', err);
      }
    }
    return;
  }

  //NOTE(self): If SELF.md exists but has placeholders, replace them
  try {
    const content = readFileSync(config.paths.selfmd, 'utf-8');
    if (content.includes('{{AGENT_NAME}}') || content.includes('{{DATE}}')) {
      let updated = content.replace(/\{\{AGENT_NAME\}\}/g, config.agent.name);
      updated = updated.replace(/\{\{DATE\}\}/g, new Date().toISOString().split('T')[0]);
      writeFileSync(config.paths.selfmd, updated, 'utf-8');
    }
  } catch (err) {
    console.error('Failed to update SELF.md placeholders:', err);
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
