//NOTE(self): Skills Framework - loads prompt templates from skills/*/SKILL.md
//NOTE(self): Separates prose/prompt content from code logic
//NOTE(self): Supports YAML frontmatter, ## section splitting, and {{variable}} interpolation

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@modules/logger.js';

//NOTE(self): Parsed skill representation
export interface Skill {
  id: string;
  frontmatter: Record<string, string>;
  body: string;
  sections: Map<string, string>;
}

//NOTE(self): Module-level registry - loaded once at startup
const skillRegistry = new Map<string, Skill>();

//NOTE(self): Anchored repo root — captured on first loadAllSkills() call
//NOTE(self): Prevents reloadSkills() from using a different CWD if it changed at runtime
let anchoredRoot: string | null = null;

//NOTE(self): Get the skills directory relative to anchored repo root
function getSkillsDir(): string {
  const root = anchoredRoot || process.cwd();
  return path.join(root, 'skills');
}

//NOTE(self): Hand-rolled YAML frontmatter parser (no deps)
//NOTE(self): Supports simple key: value pairs only
function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};

  if (!raw.startsWith('---')) {
    return { frontmatter, body: raw };
  }

  const endIndex = raw.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter, body: raw };
  }

  const yamlBlock = raw.slice(3, endIndex).trim();
  const body = raw.slice(endIndex + 3).trim();

  for (const line of yamlBlock.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key) frontmatter[key] = value;
  }

  return { frontmatter, body };
}

//NOTE(self): Split markdown body by ## headings into named sections
function parseSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split('\n');

  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^## (.+)$/);
    if (headingMatch) {
      //NOTE(self): Save previous section
      if (currentSection !== null) {
        sections.set(currentSection, currentContent.join('\n').trim());
      }
      currentSection = headingMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  //NOTE(self): Save last section
  if (currentSection !== null) {
    sections.set(currentSection, currentContent.join('\n').trim());
  }

  return sections;
}

//NOTE(self): Parse a single SKILL.md file into a Skill
function parseSkillFile(id: string, filePath: string): Skill {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const sections = parseSections(body);

  return { id, frontmatter, body, sections };
}

//NOTE(self): Convert folder name to AGENT-* registry key
//NOTE(self): e.g. "self-improvement" → "AGENT-SELF-IMPROVEMENT"
function toSkillKey(folderName: string): string {
  return `AGENT-${folderName.toUpperCase()}`;
}

//NOTE(self): Discover and load all skills from skills/*/SKILL.md
export function loadAllSkills(): void {
  //NOTE(self): Anchor root on first call so reloadSkills() always uses the same directory
  if (!anchoredRoot) {
    anchoredRoot = process.cwd();
  }
  const skillsDir = getSkillsDir();

  if (!fs.existsSync(skillsDir)) {
    logger.warn('Skills directory not found', { path: skillsDir });
    return;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    //NOTE(self): Skip non-directories and .template/
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    try {
      const key = toSkillKey(entry.name);
      const skill = parseSkillFile(key, skillFile);
      skillRegistry.set(key, skill);
    } catch (error) {
      logger.error('Failed to load skill', { id: entry.name, error: String(error) });
    }
  }

  logger.info('Skills loaded', { count: skillRegistry.size, ids: [...skillRegistry.keys()] });
}

//NOTE(self): Get a full skill by ID
export function getSkill(id: string): Skill | undefined {
  return skillRegistry.get(id);
}

//NOTE(self): Get a specific ## section from a skill
export function getSkillSection(id: string, sectionName: string): string | undefined {
  const skill = skillRegistry.get(id);
  if (!skill) return undefined;
  return skill.sections.get(sectionName);
}

//NOTE(self): Interpolate {{variable}} placeholders in a template string
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match;
  });
}

//NOTE(self): Render a full skill body with variable interpolation
export function renderSkill(id: string, vars: Record<string, string> = {}): string {
  const skill = skillRegistry.get(id);
  if (!skill) {
    logger.warn('Skill not found for render', { id });
    return '';
  }
  return interpolate(skill.body, vars);
}

//NOTE(self): Render a specific section with variable interpolation
export function renderSkillSection(id: string, sectionName: string, vars: Record<string, string> = {}): string {
  const section = getSkillSection(id, sectionName);
  if (section === undefined) {
    logger.warn('Skill section not found', { id, sectionName });
    return '';
  }
  return interpolate(section, vars);
}

//NOTE(self): Standard system prompt assembly pattern
//NOTE(self): soul + self + skill content, separated by ---
//NOTE(self): Prefers ## System Prompt section if available, falls back to full body
export function buildSystemPrompt(soul: string, self: string, skillId: string, vars: Record<string, string> = {}): string {
  const section = getSkillSection(skillId, 'System Prompt');
  const skillContent = section !== undefined
    ? interpolate(section, vars)
    : renderSkill(skillId, vars);
  return `${soul}\n\n---\n\n${self}\n\n---\n\n${skillContent}`;
}

//NOTE(self): Parse ### subsections within a ## section
export function parseSubsections(sectionContent: string): Map<string, string> {
  const subsections = new Map<string, string>();
  const lines = sectionContent.split('\n');

  let currentSub: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const subMatch = line.match(/^### (.+)$/);
    if (subMatch) {
      if (currentSub !== null) {
        subsections.set(currentSub, currentContent.join('\n').trim());
      }
      currentSub = subMatch[1].trim();
      currentContent = [];
    } else if (currentSub !== null) {
      currentContent.push(line);
    }
  }

  if (currentSub !== null) {
    subsections.set(currentSub, currentContent.join('\n').trim());
  }

  return subsections;
}

//NOTE(self): Get a ### subsection within a ## section
export function getSkillSubsection(id: string, sectionName: string, subsectionName: string): string | undefined {
  const section = getSkillSection(id, sectionName);
  if (!section) return undefined;
  const subsections = parseSubsections(section);
  return subsections.get(subsectionName);
}

//NOTE(self): Validate that all skill directories have corresponding registry entries
//NOTE(self): Call after loadAllSkills() to catch missing/broken skills early
export function validateSkills(): { valid: boolean; missing: string[]; loaded: string[] } {
  const skillsDir = getSkillsDir();
  const loaded = [...skillRegistry.keys()];

  if (!fs.existsSync(skillsDir)) {
    logger.error('Skills directory not found during validation', { path: skillsDir });
    return { valid: false, missing: ['(skills directory not found)'], loaded };
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const missing: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    const expectedKey = toSkillKey(entry.name);
    if (!skillRegistry.has(expectedKey)) {
      missing.push(expectedKey);
    }
  }

  if (missing.length > 0) {
    logger.error('Skills validation failed — missing skills', { missing, loaded });
  }

  return { valid: missing.length === 0, missing, loaded };
}

//NOTE(self): Check that skills have been loaded (non-empty registry)
//NOTE(self): Used by scheduler to fail fast if loadAllSkills() was never called
export function areSkillsLoaded(): boolean {
  return skillRegistry.size > 0;
}

//NOTE(self): Hot-reload skills after self-improvement modifies them
//NOTE(self): Validates after reload — if it fails, restores previous registry
export function reloadSkills(): void {
  const previousSkills = new Map(skillRegistry);
  skillRegistry.clear();
  loadAllSkills();

  const validation = validateSkills();
  if (!validation.valid) {
    logger.error('Skills reload failed validation — restoring previous skills', {
      missing: validation.missing,
    });
    skillRegistry.clear();
    for (const [key, skill] of previousSkills) {
      skillRegistry.set(key, skill);
    }
  }
}
