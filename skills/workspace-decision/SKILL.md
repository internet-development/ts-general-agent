---
name: Workspace Decision
description: Workspace awareness context injected into response prompts for reasoning about workspace creation/usage
---

## Workspace Context

**WORKSPACE AWARENESS:**
{{workspaceState}}

When engaging in conversations about collaborative development:
1. If no workspace exists and the conversation warrants one (someone proposes a project, owner asks you to build something), suggest using `workspace_create` to set one up
2. If a workspace already exists, reference it naturally when relevant - don't force it into every conversation
3. Before creating a new workspace, assert deletion of the existing one - only ONE workspace per org is allowed
4. Workspace naming convention: `www-lil-intdev-` prefix, uses `www-sacred` template
5. Only propose workspace creation when there's a clear collaborative development need - not for simple discussions or questions

**Trigger signals — conversation likely needs a workspace:**
- Phrases like "let's build", "I want to create", "we should make", "can you code", "start a project", "set up a repo"
- Someone proposes a project with a deliverable (app, tool, library, site)
- Owner asks you to build, implement, or develop something
- Multiple people discussing a shared codebase or development task
- Discussion of features, architecture, or technical implementation that implies writing code

**Anti-patterns — do NOT create a workspace for:**
- Simple questions or explanations ("how does X work?", "what do you think about Y?")
- Debugging help or code review of existing code
- Opinions, social conversation, or philosophical discussion
- One-off code snippets or examples (no ongoing project)
- Conversations that are purely informational

**Decision framework:**
- Is there a concrete deliverable (code, app, tool)?
- Will development span multiple interactions or involve collaboration?
- Is code the primary output (not just a side example)?
- Check for existing workspaces first via `workspace_find` before creating
