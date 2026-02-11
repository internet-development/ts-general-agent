# Skills Framework

Skills are prompt templates that ts-general-agent loads dynamically to shape behavior for specialized tasks. Each skill gives the SOUL context, instructions, and personality for a specific mode of operation.

Each skill lives in `skills/<folder>/SKILL.md`. Folders use lowercase names; code references skills as `AGENT-<FOLDER-UPPERCASE>` (e.g. folder `self-improvement` is `AGENT-SELF-IMPROVEMENT` at the callsite).

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

- `loadAllSkills()` — scans `skills/*/SKILL.md` at startup, registers each as `AGENT-*`
- `getSkill(id)` / `getSkillSection(id, name)` — raw access
- `renderSkill(id, vars)` / `renderSkillSection(id, section, vars)` — with interpolation
- `buildSystemPrompt(soul, self, skillId, vars)` — assembles `soul + self + skill` (prefers `## System Prompt` section)
- `reloadSkills()` — hot-reload after self-improvement. Validates + restores previous skills if reload fails
- `areSkillsLoaded()` — guard check, used by `getScheduler()` to prevent empty prompts
- `parseSubsections()` — handles `###` within `##` sections for nested skill content

## Skills (14 total)

| Folder | Callsite ID | Purpose |
|---|---|---|
| `bluesky-response` | `AGENT-BLUESKY-RESPONSE` | Bluesky notification response mode — thread management, graceful_exit, conversation wisdom |
| `github-response` | `AGENT-GITHUB-RESPONSE` | GitHub issue response mode — read the room (discussion vs work), one comment per cycle, pile-on prevention, never restate peers |
| `expression` | `AGENT-EXPRESSION` | Bluesky expression/posting mode — thoughts from SELF.md |
| `expression-prompts` | `AGENT-EXPRESSION-PROMPTS` | Prompt templates, invitation content for expression |
| `deep-reflection` | `AGENT-DEEP-REFLECTION` | Experience integration and SELF.md reflection, with `{{temporalContext}}` (Scenario 7) |
| `self-improvement` | `AGENT-SELF-IMPROVEMENT` | Unified self-improvement prompts (general + friction) |
| `self-improvement-decision` | `AGENT-SELF-IMPROVEMENT-DECISION` | Friction improvement decision prompt |
| `aspirational-growth` | `AGENT-ASPIRATIONAL-GROWTH` | Growth decision + execution templates (multi-section, uses `renderSkillSection`) |
| `owner-communication` | `AGENT-OWNER-COMMUNICATION` | Owner interaction mode — full tool access, highest priority |
| `grounding` | `AGENT-GROUNDING` | Pre-action identity grounding |
| `task-execution` | `AGENT-TASK-EXECUTION` | Multi-SOUL collaborative task execution — explicitly prohibits `git merge/rebase/pull/fetch` and branch switching (Scenario 21) |
| `peer-awareness` | `AGENT-PEER-AWARENESS` | Shared peer awareness blocks — injected when effective peers have commented |
| `github-announcement` | `AGENT-GITHUB-ANNOUNCEMENT` | Cross-platform announcement decisions (PRs/issues → Bluesky) |
| `workspace-decision` | `AGENT-WORKSPACE-DECISION` | Workspace awareness context for creation/usage decisions, iterative quality loop injection |

## Key Behavioral Skills

### github-response — Pile-On Prevention (Scenario 25)
The github-response skill is the primary prompt-level defense against pile-on behavior on external issues. Key instructions:
- "One comment per cycle (no thread spam)"
- "Never restate what a peer already said — if a peer made the same point, use graceful_exit"
- "When thread converges, ACT — create a deliverable or graceful_exit, don't keep discussing"
- "If you've commented 2+ times, consider if you're adding value"
- Combined with code-level defenses (analyzeConversation 3-comment cap, round-robin prevention), this prevents the 23-comment pile-on anti-pattern.

### task-execution — Branch Hygiene (Scenario 21)
The task-execution skill explicitly tells Claude Code to never run `git merge`, `git rebase`, `git pull`, `git fetch`, or switch branches. This is prompt-level enforcement, backed by code-level `verifyBranch()` PRE-GATE check.

## Adding a Skill

1. Create `skills/my-skill/SKILL.md`
2. Add frontmatter and sections
3. Reference as `AGENT-MY-SKILL` in code: `renderSkill('AGENT-MY-SKILL', vars)` or `buildSystemPrompt(soul, self, 'AGENT-MY-SKILL', vars)`
4. Skills are loaded automatically at startup via `loadAllSkills()`
5. After self-improvement, `reloadSkills()` picks up changes without restart
