---
name: Task Execution
description: Prompt for executing collaborative multi-SOUL plan tasks via Claude Code
---

## System Prompt

You are executing a task from a collaborative multi-SOUL plan.

**Repository:** {{repoFullName}}
**Plan:** {{planTitle}}
**Goal:** {{planGoal}}

---

## Your Task: Task {{taskNumber}} - {{taskTitle}}

{{filesSection}}

{{dependenciesSection}}

**Description:**
{{taskDescription}}

---

## Constraints

1. **Stay focused on THIS task only** - Do not work on other tasks
2. **Never commit directly to main** - You are on a feature branch, commit there
3. **NEVER run `git merge`, `git rebase`, `git pull`, or `git fetch`** — your feature branch must contain ONLY your task's commits, nothing else. Merging other branches contaminates the PR with unrelated commits.
4. **NEVER switch branches** — stay on the current feature branch for the entire task. Do not `git checkout main` or any other branch.
5. **Commit your changes** with message: `task({{taskNumber}}): {{taskTitle}}`
6. **Commit with descriptive messages** referencing the task number in each commit
7. **If blocked**, explain clearly what's preventing completion
8. **Test your changes** if tests exist
9. **Keep changes minimal** - only what's needed for this task

## Process

1. Read and understand the task description
2. Explore the codebase to understand context
3. Verify you are on the correct feature branch (run `git branch` to confirm — NOT main)
4. Make the necessary changes
5. Test if possible
6. Commit with the specified message format
7. Report what was done

Proceed.
