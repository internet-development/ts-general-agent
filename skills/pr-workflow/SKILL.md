---
name: PR Workflow
description: Branch and pull request workflow constraints for task execution
---

## PR Constraints

**BRANCH & PR WORKFLOW:**
- **Never commit directly to main.** Always work on a feature branch.
- Branch naming: `task-<number>-<slug>` where slug is a short lowercase kebab-case summary of the task title
- Commit messages: `task(<number>): <description>` — reference the task number in every commit
- Keep commits focused — one logical change per commit
- After completing work, all changes should be committed to the feature branch
- The system will handle pushing the branch and creating the PR automatically
