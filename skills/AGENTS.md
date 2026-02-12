# Skills Framework

Skills are prompt templates that ts-general-agent loads dynamically to shape behavior for specialized tasks. Each skill gives the SOUL context, instructions, and personality for a specific mode of operation.

Each skill lives in `skills/<folder>/SKILL.md`. Folders use lowercase names; code references skills as `AGENT-<FOLDER-UPPERCASE>` (e.g. folder `self-improvement` is `AGENT-SELF-IMPROVEMENT` at the callsite).

SOULS can freely modify their own skills and add new skills when necessary. SKILLS are a good opportunity to replace hardcoded logic, to give SOULS more self-determination.

## Structure

Each skill is a folder with a `SKILL.md` file:

- YAML frontmatter (`---` delimited) for metadata
- `## Section` headings split content into named sections
- `### Subsection` headings for nested content within sections
- `{{variable}}` placeholders for runtime interpolation
- `buildSystemPrompt()` prefers `## System Prompt` section, falls back to full body
- Multi-section skills (e.g., aspirational-growth) need `renderSkillSection()` + manual assembly
- **Variables must be passed even if empty** — `renderSkillSection()` replaces `{{var}}` literally

## Loader: `modules/skills.ts`

Check the file for how it works each time.

## Adding a Skill

1. Create `skills/my-skill/SKILL.md`
2. Add frontmatter and sections
3. Reference as `AGENT-MY-SKILL` in code: `renderSkill('AGENT-MY-SKILL', vars)` or `buildSystemPrompt(soul, self, 'AGENT-MY-SKILL', vars)`
4. Skills are loaded automatically at startup via `loadAllSkills()`
5. After self-improvement, `reloadSkills()` picks up changes without restart
