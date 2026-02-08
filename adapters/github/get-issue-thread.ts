//NOTE(self): Fetch a GitHub issue with its full comment thread
//NOTE(self): Provides context for the SOUL to understand the conversation

import { getAuthHeaders, getAuth } from '@adapters/github/authenticate.js';
import type { GitHubIssue, GitHubComment, GitHubResult } from '@adapters/github/types.js';
import { logger } from '@modules/logger.js';

const GITHUB_API = 'https://api.github.com';

export interface IssueThread {
  issue: GitHubIssue;
  comments: GitHubComment[];
  //NOTE(self): Conversation metadata
  totalComments: number;
  lastActivity: string;
  isOpen: boolean;
  //NOTE(self): Agent participation tracking
  agentHasCommented: boolean;
  agentLastCommentAt: string | null;
  commentsAfterAgent: number;
}

export interface GetIssueThreadParams {
  owner: string;
  repo: string;
  issue_number: number;
}

//NOTE(self): Fetch an issue with its full comment thread
export async function getIssueThread(
  params: GetIssueThreadParams,
  agentUsername?: string
): Promise<GitHubResult<IssueThread>> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'GitHub not authenticated' };
  }

  const effectiveAgentUsername = agentUsername || auth.username;

  try {
    //NOTE(self): Fetch issue and comments in parallel
    const [issueResponse, commentsResponse] = await Promise.all([
      fetch(`${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`, {
        headers: getAuthHeaders(),
      }),
      fetch(`${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments?per_page=100`, {
        headers: getAuthHeaders(),
      }),
    ]);

    if (!issueResponse.ok) {
      const error = await issueResponse.json();
      return { success: false, error: error.message || 'Failed to fetch issue' };
    }

    if (!commentsResponse.ok) {
      const error = await commentsResponse.json();
      return { success: false, error: error.message || 'Failed to fetch comments' };
    }

    const issue: GitHubIssue = await issueResponse.json();
    let comments: GitHubComment[] = await commentsResponse.json();

    //NOTE(self): Paginate if first page was full (100 comments)
    if (comments.length === 100) {
      let nextUrl = parseLinkNext(commentsResponse.headers.get('link'));
      while (nextUrl) {
        const pageResponse = await fetch(nextUrl, { headers: getAuthHeaders() });
        if (!pageResponse.ok) break;
        const pageComments: GitHubComment[] = await pageResponse.json();
        comments = comments.concat(pageComments);
        nextUrl = parseLinkNext(pageResponse.headers.get('link'));
      }
    }

    //NOTE(self): Analyze agent participation
    let agentHasCommented = false;
    let agentLastCommentAt: string | null = null;
    let commentsAfterAgent = 0;

    for (const comment of comments) {
      if (comment.user.login.toLowerCase() === effectiveAgentUsername.toLowerCase()) {
        agentHasCommented = true;
        agentLastCommentAt = comment.created_at;
        commentsAfterAgent = 0; //NOTE(self): Reset counter
      } else if (agentHasCommented) {
        commentsAfterAgent++;
      }
    }

    const lastActivity = comments.length > 0
      ? comments[comments.length - 1].created_at
      : issue.updated_at;

    return {
      success: true,
      data: {
        issue,
        comments,
        totalComments: comments.length,
        lastActivity,
        isOpen: issue.state === 'open',
        agentHasCommented,
        agentLastCommentAt,
        commentsAfterAgent,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

//NOTE(self): Check if the agent has already commented on an issue
export async function hasAgentCommented(
  params: GetIssueThreadParams,
  agentUsername?: string
): Promise<GitHubResult<boolean>> {
  const threadResult = await getIssueThread(params, agentUsername);
  if (!threadResult.success) {
    //NOTE(self): Fail OPEN - better to attempt than block
    logger.debug('Failed to check agent comment status, failing open', {
      ...params,
      error: threadResult.error,
    });
    return { success: true, data: false };
  }

  return { success: true, data: threadResult.data.agentHasCommented };
}

//NOTE(self): Analyze conversation state to help SOUL decide whether to respond
export interface ConversationAnalysis {
  shouldRespond: boolean;
  reason: string;
  urgency: 'high' | 'medium' | 'low' | 'none';
  context: string;
}

export interface AnalyzeConversationOptions {
  //NOTE(self): If true, the owner explicitly shared this issue on Bluesky
  //NOTE(self): Owner requests should be honored unless we'd post consecutive replies
  isOwnerRequest?: boolean;
  //NOTE(self): If true, this PR was discovered via workspace polling (proactive review)
  //NOTE(self): Agent should respond even when not mentioned
  isWorkspacePRReview?: boolean;
}

export function analyzeConversation(
  thread: IssueThread,
  agentUsername: string,
  options: AnalyzeConversationOptions = {},
  peerUsernames: string[] = []
): ConversationAnalysis {
  const { issue, comments, agentHasCommented, commentsAfterAgent, isOpen } = thread;
  const { isOwnerRequest = false, isWorkspacePRReview = false } = options;

  //NOTE(self): Closed issues generally don't need responses
  if (!isOpen) {
    return {
      shouldRespond: false,
      reason: 'Issue is closed',
      urgency: 'none',
      context: `Issue #${issue.number} has been closed.`,
    };
  }

  //NOTE(self): Check if the last comment is from the agent (awaiting response from others)
  //NOTE(self): This ALWAYS applies - even for owner requests, we don't want consecutive replies
  const lastComment = comments[comments.length - 1];
  if (lastComment && lastComment.user.login.toLowerCase() === agentUsername.toLowerCase()) {
    return {
      shouldRespond: false,
      reason: 'Awaiting response from others',
      urgency: 'none',
      context: `Your last comment is still the most recent. Wait for others to respond.`,
    };
  }

  //NOTE(self): Owner explicitly shared this issue on Bluesky - honor the request
  //NOTE(self): This comes after consecutive reply check so we don't spam
  if (isOwnerRequest) {
    return {
      shouldRespond: true,
      reason: 'Owner shared this issue on Bluesky',
      urgency: 'high',
      context: `Your owner explicitly shared this issue and wants you to engage.`,
    };
  }

  //NOTE(self): Peer-only round-robin prevention
  //NOTE(self): If all replies since our last comment are from peer SOULs (no humans),
  //NOTE(self): don't respond — breaks infinite peer-triggering loops.
  //NOTE(self): Escape hatch: respond if a peer @mentioned us directly.
  if (agentHasCommented && commentsAfterAgent > 0 && peerUsernames.length > 0) {
    const agentLastIdx = comments.reduce((lastIdx, c, i) =>
      c.user.login.toLowerCase() === agentUsername.toLowerCase() ? i : lastIdx, -1);
    const commentsAfter = comments.slice(agentLastIdx + 1);
    const humanComments = commentsAfter.filter(c => {
      const login = c.user.login.toLowerCase();
      return login !== agentUsername.toLowerCase() &&
        !peerUsernames.some(p => p.toLowerCase() === login);
    });

    if (humanComments.length === 0) {
      const peerMentionedUs = commentsAfter.some(c =>
        peerUsernames.some(p => p.toLowerCase() === c.user.login.toLowerCase()) &&
        c.body.toLowerCase().includes(`@${agentUsername.toLowerCase()}`)
      );
      if (!peerMentionedUs) {
        return {
          shouldRespond: false,
          reason: 'Only peer SOULs replied — avoid round-robin',
          urgency: 'none',
          context: `All ${commentsAfterAgent} replies since your last comment are from peer SOULs. Wait for a human to engage.`,
        };
      }
    }
  }

  //NOTE(self): Comment saturation — 3+ comments is already generous for an external issue.
  //NOTE(self): Only continue if a human directly @mentioned us recently.
  if (agentHasCommented) {
    const agentCommentCount = comments.filter(c =>
      c.user.login.toLowerCase() === agentUsername.toLowerCase()
    ).length;

    if (agentCommentCount >= 3) {
      const recentHumanMention = comments.slice(-5).some(c => {
        const login = c.user.login.toLowerCase();
        const isHuman = login !== agentUsername.toLowerCase() &&
          !peerUsernames.some(p => p.toLowerCase() === login);
        return isHuman && c.body.toLowerCase().includes(`@${agentUsername.toLowerCase()}`);
      });

      if (!recentHumanMention) {
        return {
          shouldRespond: false,
          reason: `You've contributed ${agentCommentCount} times — only respond if directly asked`,
          urgency: 'none',
          context: `You have ${agentCommentCount} comments in this thread. Only respond if a human directly @mentions you.`,
        };
      }
    }
  }

  //NOTE(self): Check if someone replied to agent
  if (agentHasCommented && commentsAfterAgent > 0) {
    return {
      shouldRespond: true,
      reason: `${commentsAfterAgent} new ${commentsAfterAgent === 1 ? 'reply' : 'replies'} since your last comment`,
      urgency: commentsAfterAgent >= 3 ? 'high' : 'medium',
      context: `People have continued the conversation after your comment.`,
    };
  }

  //NOTE(self): Check for direct mentions in recent comments
  const recentComments = comments.slice(-5);
  const mentionedInRecent = recentComments.some((c) =>
    c.body.toLowerCase().includes(`@${agentUsername.toLowerCase()}`)
  );

  if (mentionedInRecent) {
    return {
      shouldRespond: true,
      reason: 'Directly mentioned in recent comments',
      urgency: 'high',
      context: `Someone mentioned you directly in the conversation.`,
    };
  }

  //NOTE(self): New issue we haven't engaged with yet
  if (!agentHasCommented) {
    //NOTE(self): Only respond to new issues if we're mentioned in the issue body
    const mentionedInIssue = issue.body?.toLowerCase().includes(`@${agentUsername.toLowerCase()}`);
    if (mentionedInIssue) {
      //NOTE(self): If 2+ peers already commented and we haven't, downgrade urgency
      const peerCommentCount = peerUsernames.length > 0
        ? comments.filter(c =>
            peerUsernames.some(p => c.user.login.toLowerCase() === p.toLowerCase())
          ).length
        : 0;

      if (peerCommentCount >= 2) {
        return {
          shouldRespond: true,
          reason: `${peerCommentCount} peer SOULs have already commented — only add what's genuinely missing`,
          urgency: 'low',
          context: `Your peers have contributed. Review their comments before adding yours.`,
        };
      }

      return {
        shouldRespond: true,
        reason: 'Mentioned in issue body',
        urgency: 'high',
        context: `You were mentioned when this issue was created.`,
      };
    }

    //NOTE(self): Proactive workspace PR review - respond even when not mentioned
    if (isWorkspacePRReview) {
      const peerCommentCount = peerUsernames.length > 0
        ? comments.filter(c =>
            peerUsernames.some(p => c.user.login.toLowerCase() === p.toLowerCase())
          ).length
        : 0;

      if (peerCommentCount >= 2) {
        return {
          shouldRespond: true,
          reason: `Open PR in workspace — ${peerCommentCount} peers already reviewed, only add if genuinely needed`,
          urgency: 'low',
          context: `PR discovered in watched workspace. Peers have already contributed reviews.`,
        };
      }

      return {
        shouldRespond: true,
        reason: 'Open PR in watched workspace needs review',
        urgency: 'low',
        context: `PR discovered in watched workspace. Review and provide feedback.`,
      };
    }

    return {
      shouldRespond: false,
      reason: 'Not mentioned and not part of conversation',
      urgency: 'none',
      context: `This issue doesn't appear to need your input.`,
    };
  }

  return {
    shouldRespond: false,
    reason: 'No new activity requiring response',
    urgency: 'none',
    context: `The conversation doesn't need your input right now.`,
  };
}

//NOTE(self): Format thread for LLM context
//NOTE(self): When peerUsernames is provided, adds a Peer Contributions section
//NOTE(self): to make peer comments unmissable to the LLM
export function formatThreadForContext(
  thread: IssueThread,
  maxComments: number = 10,
  peerUsernames: string[] = []
): string {
  const { issue, comments } = thread;

  let context = `## Issue #${issue.number}: ${issue.title}\n`;
  context += `**Status:** ${issue.state} | **Author:** @${issue.user.login}\n`;
  context += `**URL:** ${issue.html_url}\n\n`;

  if (issue.body) {
    context += `### Issue Description\n${issue.body}\n\n`;
  }

  if (comments.length > 0) {
    context += `### Comments (${comments.length} total)\n\n`;

    //NOTE(self): Show most recent comments, with note if truncated
    const displayComments = comments.slice(-maxComments);
    if (comments.length > maxComments) {
      context += `*[${comments.length - maxComments} earlier comments not shown]*\n\n`;
    }

    for (const comment of displayComments) {
      const date = new Date(comment.created_at).toLocaleDateString();
      context += `**@${comment.user.login}** (${date}):\n${comment.body}\n\n---\n\n`;
    }
  } else {
    context += `*No comments yet*\n`;
  }

  //NOTE(self): Peer contribution summary — makes peer comments unmissable
  if (peerUsernames.length > 0) {
    const peerComments = comments.filter(c =>
      peerUsernames.some(p => c.user.login.toLowerCase() === p.toLowerCase())
    );

    if (peerComments.length > 0) {
      context += `\n### Peer SOUL Contributions Already In This Thread\n\n`;
      context += `These comments are from your peer SOULs — autonomous agents like you.\n`;
      context += `READ CAREFULLY. Do not repeat what they said.\n\n`;

      for (const comment of peerComments) {
        context += `**@${comment.user.login}** already said:\n`;
        context += `> ${comment.body.split('\n').join('\n> ')}\n\n`;
      }
      context += `---\n\n`;
    }
  }

  return context;
}

//NOTE(self): Parse Link header for rel="next" URL (GitHub pagination)
function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}
