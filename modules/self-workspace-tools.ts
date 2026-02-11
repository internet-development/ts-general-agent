import type { ToolDefinition } from '@modules/tools.js';

export const WORKSPACE_TOOLS: ToolDefinition[] = [
  {
    name: 'workspace_create',
    description: 'Create a new collaboration workspace from the www-sacred template. Auto-prefixes "www-lil-intdev-" to the name. One workspace per org (returns existing if one exists). Use this when the owner wants to start a new project or repo.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Workspace name (will be auto-prefixed with "www-lil-intdev-"). E.g., "dashboard" becomes "www-lil-intdev-dashboard".',
        },
        description: {
          type: 'string',
          description: 'Optional repository description',
        },
        org: {
          type: 'string',
          description: 'GitHub org to create in (default: internet-development)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'workspace_find',
    description: 'Check if a collaboration workspace already exists for an org. Returns workspace name and URL if found, null otherwise. Use this before creating to see if one already exists.',
    input_schema: {
      type: 'object',
      properties: {
        org: {
          type: 'string',
          description: 'GitHub org to search in (default: internet-development)',
        },
      },
    },
  },
  {
    name: 'create_memo',
    description: 'Create a GitHub issue for coordination or discussion. Default label: "memo" (short-lived coordination artifact). Pass labels: ["discussion"] for long-form brainstorming threads that should stay open.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (username or org)',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        title: {
          type: 'string',
          description: 'Memo title',
        },
        body: {
          type: 'string',
          description: 'Memo body/content (markdown supported)',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels for the issue. Defaults to ["memo"] if not provided. Use ["discussion"] for brainstorming/writing threads.',
        },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'plan_create',
    description: 'Create a collaborative plan as a GitHub issue. Plans have a specific markdown format with tasks that can be claimed by multiple SOULs.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        title: {
          type: 'string',
          description: 'Plan title',
        },
        goal: {
          type: 'string',
          description: 'One-sentence goal description',
        },
        context: {
          type: 'string',
          description: 'Background and links to discussions',
        },
        tasks: {
          type: 'array',
          description: 'List of task definitions',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title' },
              estimate: { type: 'string', description: 'Time estimate (e.g., "2-5 min")' },
              dependencies: { type: 'array', items: { type: 'string' }, description: 'Task dependencies (e.g., ["Task 1"])' },
              files: { type: 'array', items: { type: 'string' }, description: 'Files to modify' },
              description: { type: 'string', description: 'Detailed task description' },
            },
            required: ['title', 'description'],
          },
        },
        verification: {
          type: 'array',
          items: { type: 'string' },
          description: 'Verification checklist items',
        },
      },
      required: ['owner', 'repo', 'title', 'goal', 'context', 'tasks'],
    },
  },
  {
    name: 'plan_claim_task',
    description: 'Claim a task from a plan. Uses first-writer-wins via GitHub assignee API. Returns whether claim succeeded.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        issue_number: {
          type: 'number',
          description: 'Plan issue number',
        },
        task_number: {
          type: 'number',
          description: 'Task number to claim (from plan)',
        },
      },
      required: ['owner', 'repo', 'issue_number', 'task_number'],
    },
  },
  {
    name: 'plan_execute_task',
    description: 'Execute a claimed task via Claude Code. Must have claimed the task first. Will commit changes and report completion.',
    input_schema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner',
        },
        repo: {
          type: 'string',
          description: 'Repository name',
        },
        issue_number: {
          type: 'number',
          description: 'Plan issue number',
        },
        task_number: {
          type: 'number',
          description: 'Task number to execute',
        },
      },
      required: ['owner', 'repo', 'issue_number', 'task_number'],
    },
  },
  {
    name: 'workspace_finish',
    description: 'Mark a workspace project as complete by creating a "LIL INTDEV FINISHED" sentinel issue. Blocks all new plans, tasks, and issue engagement until the sentinel is closed or the owner comments on it.',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        summary: { type: 'string', description: 'Summary of what was completed' },
      },
      required: ['owner', 'repo', 'summary'],
    },
  },
];
