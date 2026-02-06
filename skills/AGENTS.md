# Skills Framework

Skills are folders of instructions, scripts, and resources that ts-general-agent loads dynamically to improve performance on specialized tasks.

Each skill lives in `skills/<folder>/SKILL.md`. Folders use lowercase names; code references skills as `AGENT-<FOLDER-UPPERCASE>` (e.g. folder `self-improvement` is `AGENT-SELF-IMPROVEMENT` at the callsite).

## Structure

Each skill is a folder with a `SKILL.md` file:
- YAML frontmatter (`---` delimited) for metadata
- `## Section` headings split content into named sections
- `### Subsection` headings for nested content within sections
- `{{variable}}` placeholders for runtime interpolation

## Loader: `modules/skills.ts`

- `loadAllSkills()` — scans `skills/*/SKILL.md` at startup, registers each as `AGENT-*`
- `getSkill(id)` / `getSkillSection(id, name)` — raw access
- `renderSkill(id, vars)` / `renderSkillSection(id, section, vars)` — with interpolation
- `buildSystemPrompt(soul, self, skillId, vars)` — assembles `soul + self + skill` (prefers `## System Prompt` section)
- `reloadSkills()` — hot-reload after self-improvement

## Skills

| Folder | Callsite ID | Purpose |
|---|---|---|
| `bluesky-response` | `AGENT-BLUESKY-RESPONSE` | Bluesky notification response mode |
| `github-response` | `AGENT-GITHUB-RESPONSE` | GitHub issue response mode |
| `expression` | `AGENT-EXPRESSION` | Bluesky expression/posting mode |
| `expression-prompts` | `AGENT-EXPRESSION-PROMPTS` | Prompt templates, invitation content for expression |
| `deep-reflection` | `AGENT-DEEP-REFLECTION` | Experience integration and SELF.md reflection |
| `self-improvement` | `AGENT-SELF-IMPROVEMENT` | Unified self-improvement prompts (general + friction) |
| `self-improvement-decision` | `AGENT-SELF-IMPROVEMENT-DECISION` | Friction improvement decision prompt |
| `aspirational-growth` | `AGENT-ASPIRATIONAL-GROWTH` | Growth decision + execution templates |
| `owner-communication` | `AGENT-OWNER-COMMUNICATION` | Owner interaction mode |
| `grounding` | `AGENT-GROUNDING` | Pre-action identity grounding |
| `task-execution` | `AGENT-TASK-EXECUTION` | Multi-SOUL collaborative task execution |
| `peer-awareness` | `AGENT-PEER-AWARENESS` | Shared peer awareness blocks |
| `github-announcement` | `AGENT-GITHUB-ANNOUNCEMENT` | Cross-platform announcement decisions (PRs/issues → Bluesky) |
| `pr-workflow` | `AGENT-PR-WORKFLOW` | Branch and PR workflow constraints for task execution |
| `workspace-decision` | `AGENT-WORKSPACE-DECISION` | Workspace awareness context for creation/usage decisions |

## Adding a Skill

1. Create `skills/my-skill/SKILL.md`
2. Add frontmatter and sections
3. Reference as `AGENT-MY-SKILL` in code: `renderSkill('AGENT-MY-SKILL', vars)` or `buildSystemPrompt(soul, self, 'AGENT-MY-SKILL', vars)`
4. Skills are loaded automatically at startup
