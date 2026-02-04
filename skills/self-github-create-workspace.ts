//NOTE(self): Creates a collaborative development workspace repository
//NOTE(self): Uses www-sacred template, enforces www-lil-intdev- prefix
//NOTE(self): CONSTRAINT - Only ONE repo with www-lil-intdev- prefix allowed per org (guards against excess creation)

import * as github from '@adapters/github/index.js';
import { createRepositoryFromTemplate } from '@adapters/github/create-repository-from-template.js';
import { logger } from '@modules/logger.js';

const TEMPLATE_OWNER = 'internet-development';
const TEMPLATE_REPO = 'www-sacred';
const WORKSPACE_PREFIX = 'www-lil-intdev-';
const DEFAULT_ORG = 'internet-development';

export interface CreateWorkspaceParams {
  name: string; // Will be prefixed with www-lil-intdev-
  description?: string;
  org?: string; // Defaults to internet-development
}

export interface WorkspaceResult {
  success: boolean;
  workspace?: {
    name: string;
    fullName: string;
    url: string;
    cloneUrl: string;
  };
  error?: string;
  existingWorkspace?: string;
}

/**
 * Find existing workspace with the www-lil-intdev- prefix for this org.
 * Returns the FIRST repo found with the prefix (there should only ever be one).
 */
export async function findExistingWorkspace(org: string = DEFAULT_ORG): Promise<string | null> {
  const result = await github.listOrgRepos({ org, per_page: 100 });

  if (!result.success) {
    logger.warn('Failed to list org repos for workspace check', { error: result.error });
    return null;
  }

  const workspace = result.data.find(repo => repo.name.startsWith(WORKSPACE_PREFIX));
  return workspace ? workspace.name : null;
}

/**
 * Create a collaborative development workspace repository
 * - Uses www-sacred as template
 * - Enforces www-lil-intdev- prefix
 * - GUARDS AGAINST EXCESS: Only ONE repo with www-lil-intdev- prefix allowed per org
 * - If ANY repo with the prefix exists, creation is blocked (returns existing name)
 */
export async function createWorkspace(params: CreateWorkspaceParams): Promise<WorkspaceResult> {
  const org = params.org || DEFAULT_ORG;

  //NOTE(self): Check for existing workspace first - enforces one-per-org rule
  const existing = await findExistingWorkspace(org);
  if (existing) {
    logger.info('Workspace already exists', { workspace: existing, org });
    return {
      success: false,
      error: `A workspace already exists: ${existing}. Only one workspace per org is allowed.`,
      existingWorkspace: existing,
    };
  }

  //NOTE(self): Ensure prefix is applied automatically
  const repoName = params.name.startsWith(WORKSPACE_PREFIX)
    ? params.name
    : `${WORKSPACE_PREFIX}${params.name}`;

  logger.info('Creating workspace from template', {
    name: repoName,
    org,
    template: `${TEMPLATE_OWNER}/${TEMPLATE_REPO}`
  });

  const result = await createRepositoryFromTemplate({
    templateOwner: TEMPLATE_OWNER,
    templateRepo: TEMPLATE_REPO,
    name: repoName,
    owner: org,
    description: params.description || `Collaborative development workspace`,
    private: false,
  });

  if (!result.success) {
    logger.error('Failed to create workspace', { error: result.error });
    return { success: false, error: result.error };
  }

  const repo = result.data;
  logger.info('Workspace created successfully', {
    name: repo.name,
    url: repo.html_url
  });

  return {
    success: true,
    workspace: {
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
    },
  };
}

/**
 * Get workspace URL if it exists
 */
export async function getWorkspaceUrl(org: string = DEFAULT_ORG): Promise<string | null> {
  const workspaceName = await findExistingWorkspace(org);
  if (!workspaceName) return null;

  return `https://github.com/${org}/${workspaceName}`;
}
