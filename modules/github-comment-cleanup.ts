//NOTE(self): GitHub Comment Cleanup Module
//NOTE(self): Scans plan issue comments and prunes duplicates posted by the agent.
//NOTE(self): Mirrors pruneDuplicatePosts() pattern from outbound-queue.ts but for GitHub.
//NOTE(self): Keeps oldest comment per normalized body group, deletes newer copies.

import { getIssueThread } from '@adapters/github/get-issue-thread.js';
import { deleteIssueComment } from '@adapters/github/delete-issue-comment.js';
import { normalizePostText } from '@common/strings.js';
import { logger } from '@modules/logger.js';

export async function pruneGitHubDuplicateComments(
  owner: string,
  repo: string,
  issueNumber: number,
  agentUsername: string
): Promise<number> {
  //NOTE(self): Fetch all comments on the issue
  const threadResult = await getIssueThread({ owner, repo, issue_number: issueNumber });
  if (!threadResult.success) {
    logger.warn('Failed to fetch issue thread for comment cleanup', { owner, repo, issueNumber, error: threadResult.error });
    return 0;
  }

  //NOTE(self): Skip closed issues — no one's looking, don't waste API calls
  if (!threadResult.data.isOpen) return 0;

  //NOTE(self): Filter to agent's own comments only
  const agentComments = threadResult.data.comments.filter(
    c => c.user.login.toLowerCase() === agentUsername.toLowerCase()
  );

  if (agentComments.length < 2) return 0;

  //NOTE(self): Group by normalized body text
  const groups = new Map<string, typeof agentComments>();
  for (const comment of agentComments) {
    if (!comment.body) continue;
    const key = normalizePostText(comment.body);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(comment);
    groups.set(key, group);
  }

  let deleted = 0;

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    //NOTE(self): Sort by created_at ascending — keep the oldest
    group.sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    //NOTE(self): Skip the oldest (index 0), delete newer duplicates
    for (let i = 1; i < group.length; i++) {
      const comment = group[i];
      const result = await deleteIssueComment(owner, repo, comment.id);
      if (result.success) {
        deleted++;
        logger.info('Pruned duplicate GitHub comment', {
          owner, repo, issueNumber,
          commentId: comment.id,
          body: comment.body.slice(0, 60),
        });
      } else {
        logger.warn('Failed to prune duplicate GitHub comment', {
          owner, repo, issueNumber,
          commentId: comment.id,
          error: result.error,
        });
      }
    }
  }

  return deleted;
}
