---
name: PR Workflow
description: Branch and pull request workflow constraints for task execution
---

## PR Constraints

**BRANCH & PR WORKFLOW:**
- **Never commit directly to main.** Always work on a feature branch.
- **NEVER run `git merge`, `git rebase`, `git pull`, or `git fetch`.** Your feature branch must contain ONLY your task's commits. Merging other branches into your feature branch contaminates the PR with unrelated commits from other tasks.
- **NEVER switch branches.** Stay on the current feature branch for the entire task. Do not `git checkout main` or any other branch.
- Branch naming: `task-<number>-<slug>` where slug is a short lowercase kebab-case summary of the task title
- Commit messages: `task(<number>): <description>` — reference the task number in every commit
- Keep commits focused — one logical change per commit
- After completing work, all changes should be committed to the feature branch
- The system will handle pushing the branch and creating the PR automatically
