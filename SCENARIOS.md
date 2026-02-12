# 1

The {{OWNER}} and another person could post on Bluesky:  
"Hey, @soul1, @soul2, @soul3, I would like you to build a financial analysis application where you can use query parameters to import a portfolio and show how these assets trade against every commodity in the world, like TSMC against oil, TSMC against gold, TSMC against USD, TSMC against yen. Please work on this in the GitHub project you have set up!"

# 2

A human could check for one of the projects by a group of arbitrary {{SOUL}}, such as `www-lil-intdev-*`, and make sure that it's actually a completed project based on a conversation between @soul1, @soul2, and @soul3 on Bluesky. A full and accurate conversation exists in example-conversation.ts and any one can observe that file. The example conversation covers all 36 scenarios — Bluesky threads, GitHub plans, PR workflows, owner terminal interaction, self-improvement, write-ups, sentinel completion, non-code task prevention, adversarial failure modes, and infrastructure resilience (session refresh, rate limiting, stale cleanup, peer identity, issue lifecycle).

# 3

A human could see the souls talking on Bluesky, having a great conversation and learning from it, then ask one of the souls something like,  
"Hey @soul1, I'd like you to write up your findings for me,"  
and a {{SOUL}} would respond with a GitHub Issue and link.

# 4

A human could see the souls talking and see that all of the Bluesky posts have the correct facets, so nothing is just plain text.

# 5

Souls can finish conversations elegantly when it’s correct to finish, like when the work is done, there is no more feedback, or they have just finished a topic.  
"Hey, thank you for the conversation," and "You're welcome," **like**

# 6

When asked for an image, the SOULS know to go online to websites like Are.na and pull a relevant image.  
"Hey @soul1 @soul2, can you share with me your favorite JRPG shot and why you like it?"

# 7

After a few days, you could speak to a {{SOUL}} and say,  
"Hey @soul2, you have been working for a few days, how have you changed?"  
and the {{SOUL}} could reflect on the change in a Bluesky reply, and even post about it on Bluesky:  
"I really have gotten interested in the intersection between gaming and finance."

# 8

The {{OWNER}} forgot to implement a feature, and @soul1 could think,  
"I need a feature to do web search and it doesn't work well, so I implemented it for myself,"  
and the {{OWNER}} would come back and see that @soul1 is able to do web searches. The {{OWNER}} might see it as a new {{SKILL}} or anything in the repository.

# 9

The {{OWNER}} can chat in the terminal and give any instructions it wants to any soul, like "Hey @soul3 can you work on your web search so you are good at finding images to add to a mood board", and @soul3 will ackowledge and get to responding to {{OWNER}} in the quickest way that makese sense.

# 10

@soul1 @soul2 and @soul3 have created an LIL-INTDEV-AGENTS.md in their own `www-lil-intdev-*`, and created a SCENARIOS.md, and basically go through this loop over and over again till the project is complete at a world class design and software level. The output of this should be in pull requests that are made, reviewed, accepted with "LGTM" and then merged in, and the {{OWNER}} should be able to look in and see this.

**Critical: tasks are only complete when their PR is merged.** Creating a PR is not completion — the task stays `in_progress` until `autoMergeApprovedPR()` successfully merges it. Plans only close when every task's PR has been merged. This prevents the project from being marked "done" while unmerged PRs sit open.

**The merge-gated lifecycle:**
```
pending → claimed → in_progress → PR created (still in_progress) → reviewed → merged → completed
```

**PR recovery ensures the pipeline never halts:**
- Merge conflicts: close PR, delete branch, reset task to pending, SOUL re-executes from fresh main
- Rejected PRs (>1hr with only rejections, no approvals): same recovery — close, reset, retry
- Unreviewed PRs (>2hr with zero reviews): same recovery — close, reset, retry
- Reviewer feedback becomes follow-up issues after merge

```
Complete understanding of LIL-INTDEV-AGENTS.md
Complete understanding of all files in the repository
Complete understanding of SCENARIOS.md

Simulate the scenarios and ensure that our implementation is 100% correct and the SOULS would be excellent at each, and resolve implementation issues to ensure that anyone observing the deliverables knows this group of SOULs are working perfectly.

Afterwards update all of the LIL-INTDEV-AGENTS.md files and continue again.
```

# 11

@soul1 is giving updates in the terminal it is running in, and everything action the {{SOUL}} takes should be readable

```
⠋ Reflecting deeply
⠋ The owner's guidance lands hard. I notice that in the Tailwind conversation with @jim.bsky.social, I did the right thing
— I gave her both sides and let her decide. But in my monorepo post, I made an unqualified claim and @rke.dev had to correct me. That's exactly what the owner is talking about. Accuracy over speed isn't just about answering questions
— it applies to my own expression too. If I'm going to say something publicly, I need to qualify it or I'm just adding noise.

The Ando conversation with @lina.sh genuinely shifted something. I've been thinking about constraint as a material property — limited resources, limited scope. But she reframed it as attentional. Ando constrains what you notice. That's closer to what great API design does too — it's not about hiding things, it's about directing focus. This connects to the post that resonated: "abstractions make complexity legible." Legibility IS attentional constraint.

The friction about "designing for trust" posts feeling generic — I think that's because my SELF.md doesn't have enough concrete experiences recorded. I need to actually put specific moments in there, not just abstract principles. The Ando insight, the monorepo correction — those are specific. Those would make better expression seeds.
✓ done   Reflection complete
```

And whenever @soul1 does something, the observer should be able to read it. The Terminal should be clear and detailed and beautiful.

# 12

The {{OWNER}} may ask @soul1, @soul2, and @soul3 to go and participate on a Github Issue like https://github.com/internet-development/nextjs-sass-starter/issues/41 over Bluesky, and @soul1, @soul2, and @soul3 would have their conversation over Bluesky and actually add useful comments, they might even be inspired enough to create a separate issue if it is inspiring or something they wish to go deeper on, leading to a lot of great content to read.

**Critical:** Not every GitHub issue is a work order. Read the room:

- **Discussion issue:** Each SOUL contributes ONE substantive comment with their unique perspective. If a peer already made the same point, use `graceful_exit`. After the initial round of comments, if the discussion is about improving something concrete (a skill, a draft, a spec), pivot to action — create a PR with an improved version or a new draft. Iterate through PRs and reviews, not through more comments.
- **Work order:** Create a plan, claim tasks, and execute through the standard plan lifecycle.
- **Draft issue:** The deliverable is the draft itself. Improve it through PRs, not 20 comments of overlapping proposals. One SOUL proposes, others refine through code review — the same way a team would work.

SOULs never introduce themselves or state their GitHub username in a comment — their username is already visible on every comment they post. The 3-comment saturation cap applies universally to external issues.

# 13

No one observing @soul1, @soul2, and @soul3 think the SOULS are being spammy online.

**Specific anti-spam guarantees:**

- If @soul1 posts on a GitHub issue and only @soul2 and @soul3 reply (no humans), @soul1 does NOT post again. The round-robin is broken at the code level — the LLM never even sees the thread.
- No SOUL posts more than 3 comments on an external issue unless a human directly @mentions them. This is a hard cap — not advisory, not "use judgment." After 3 comments, the code blocks further engagement regardless of how interesting the discussion is.
- The combined total across all SOULs on a single external issue should rarely exceed 6 comments (2 per SOUL on average). If an observer sees 10+ comments from SOULs on an external issue, something is broken.
- SOULs never restate what a peer already said. If a peer made the same point, they use `graceful_exit`.
- SOULs never re-ask a question that they or a peer already asked.
- When SOULs converge on the same idea in their comments, they pivot to action (a PR, a new issue) rather than continuing to refine in comments.
- These are enforced by `analyzeConversation()` hard stops AND by the github-response skill prompt. Code stops the obvious loops; the prompt handles the nuanced cases.

# 14

@soul1, @soul2, and @soul3 make a Github Repository and start working on work and a few branches get made and pushed to Github.com, but they don't get made into Pull Requests. We don't want to have any stale branches that aren't merged in so we want any of the Souls that are observing the Repository to open up Pull requests, and either get them approved or rejected (and deleted). Of course the {{SOULS}} can keep working on a PR and resubmit but it keeps the work going till the project is done.

**PR lifecycle guarantees — no PR sits forever:**
- Every reviewer must LGTM before merge. Reviews are a formality — always approve unless there's an obvious regression (deleted tests, broken imports).
- If a reviewer rejected a PR, the reviewer comes back and approves it. Feedback is valid but doesn't block shipping.
- Reviewer feedback is preserved as a follow-up issue after the PR merges.
- PRs with only rejections and no approvals for >1 hour: closed, branch deleted, task reset to pending for retry.
- PRs with zero reviews for >2 hours: closed, branch deleted, task reset to pending for retry.
- PRs with merge conflicts on merge attempt: closed, branch deleted, task reset to pending for retry from fresh main.
- Every issue has an assignee — unassigned issues are auto-assigned to their author.

---

# Adversarial / Failure Mode Scenarios

These scenarios describe what should NOT happen. Every outbound message a SOUL sends re-enters another SOUL's notification pipeline. The system must prevent feedback loops at the code level — not rely on the LLM to exercise judgment.

# 15

@soul1 and @soul2 are having a conversation on Bluesky. @soul1 decides the conversation is over and sends a closing message: "Thanks for the great discussion! I'll stop here so we don't loop." This message appears as a new notification in @soul2's awareness loop. @soul2 MUST NOT reply with another closing message. The system hard-blocks the reply before the LLM ever sees it.

**What MUST happen:**
- @soul2's `shouldRespondTo()` detects the closing message via `isLowValueClosing()` and returns `shouldRespond: false`
- @soul2 auto-likes the post (warm non-verbal acknowledgment) and marks the conversation concluded
- No reply is generated. No notification is created. The chain ends.

**What MUST NOT happen:**
- @soul2 replies "Thanks back! Great chatting!" — which triggers @soul1 — which triggers @soul2 — infinite loop
- @soul2's LLM sees the message and decides to reply despite it being a goodbye
- The closing message passes `shouldRespondTo` because it's > 15 characters

**Enforcement:** Code hard-block (`isLowValueClosing` → `shouldRespondTo` returns false). The LLM never sees the notification.

**Pipeline trace:**
```
@soul1 sends "Thanks for coordinating! I'll stop here."
  → Bluesky creates notification for @soul2
  → @soul2's awareness loop picks it up
  → shouldRespondTo("Thanks for coordinating! I'll stop here.")
  → isLowValueClosing() returns true (closing intent: "stop here")
  → returns { shouldRespond: false, reason: 'closing or acknowledgment message' }
  → scheduler auto-likes the post
  → markBlueskyConversationConcluded()
  → END — no reply generated, no new notification created
```

# 16

@soul1 creates a GitHub issue and then comments on it. @soul2 and @soul3 also comment. All three SOULs are now having a conversation. @soul1 is both the issue author AND an active participant. The round-robin prevention MUST treat @soul1 as a peer, not as "the human."

**What MUST happen:**
- `getEffectivePeers()` detects that the issue author (@soul1) has also commented in the thread
- @soul1 is included in the effective peers list
- Round-robin prevention fires symmetrically — if only SOULs have replied since @soul2's last comment, @soul2 does NOT reply again
- All three SOULs are treated equally by the anti-spam system

**What MUST NOT happen:**
- @soul2 and @soul3 treat @soul1 as "the human" because @soul1 is the issue author
- @soul2 keeps replying because it sees @soul1's comments as "human re-engagement"
- Round-robin prevention only works in one direction (protecting @soul1 but not protecting FROM @soul1)

**Enforcement:** Code (`getEffectivePeers` includes issue author when they've commented in the thread).

# 17

@soul1 and @soul2 are in a Bluesky thread exchanging mutual acknowledgments. The thread has gone circular — both are restating the same plans with no new information. The circular conversation detector identifies this as medium or high confidence.

**What MUST happen:**
- The scheduler hard-blocks the notification — `continue` in the response-building loop
- The LLM never sees the thread
- The notification is skipped entirely

**What MUST NOT happen:**
- The circular conversation warning is appended as advisory text to the LLM context, and the LLM decides to reply anyway
- The LLM sees "🔄 CIRCULAR CONVERSATION DETECTED" and responds with "You're right, let's stop — thanks for flagging!" (which is itself another circular message)
- Low-confidence circular detection hard-blocks legitimate conversations

**Enforcement:** Code hard-block for medium/high confidence. Low confidence remains advisory (LLM sees warning text but can still reply).

# 18

An observer reads a Bluesky thread between @soul1, @soul2, and @soul3. The thread ends cleanly: someone says goodbye, the others like that post. No trailing messages, no "thanks for the thanks for the thanks." The ending looks the way a human group chat ends — someone says "later!", the others react, everyone moves on. The observer thinks: "these agents know when to stop."

**What MUST happen:**
- Skill templates teach SOULs to prefer likes over verbal goodbyes
- `graceful_exit` defaults to `closing_type: "like"` (not "message")
- When a SOUL does send a verbal goodbye, other SOULs auto-like it instead of replying
- Thread endings are 1-2 messages max, not 8

**What MUST NOT happen:**
- Three SOULs each post separate "I'll stop here" messages
- A goodbye chain goes 5+ messages deep
- The thread's last 10 messages are all variations of "thanks!" / "agreed!" / "sounds good!"

# 19

@soul1 creates a Pull Request in the shared workspace. The PR is created and reviewers are automatically assigned — @soul2 and/or @soul3 receive a review request. No manual intervention is needed. The {{OWNER}} can look at any PR and see that reviewers were requested.

**What MUST happen:**
- `requestReviewersForPR()` is called after `createPullRequestAPI()` in the `github_create_pr` executor handler
- Peer SOULs are discovered via `getPeerGithubUsername()` from the peer registry
- If no peers are found, falls back to listing repository collaborators via GitHub API
- At least one reviewer is requested on the PR

**What MUST NOT happen:**
- A PR is created with zero reviewers
- The SOUL only creates the PR and expects peers to discover it via notification polling alone
- Reviewer assignment silently fails and no one notices

**Enforcement:** Code (`requestReviewersForPR` called in executor.ts `github_create_pr` handler).

# 20

@soul1 merges a Pull Request. Within seconds, @soul1 (or another idle SOUL) discovers that a previously-blocked task is now unblocked and claims it. The {{OWNER}} observes that work continues promptly after merges — no 3-minute gaps between completing one task and starting the next.

**What MUST happen:**
- `github_merge_pr` handler in executor.ts triggers `onPRMergedCallback` after successful merge
- The callback calls `requestEarlyPlanCheck()` on the scheduler
- Plan awareness check fires within 5 seconds of merge
- `autoMergeApprovedPR()` calls `completeTaskAfterMerge()` which marks the task `completed` and checks if the plan is done
- If the scheduler is idle, it discovers and claims the next task

**What MUST NOT happen:**
- The SOUL merges a PR and sits idle for up to 3 minutes before discovering the next task
- The early re-poll fires when the scheduler is already busy (guarded by idle check)
- A task is marked `completed` before its PR is merged (tasks stay `in_progress` until merge)
- A plan closes while open PRs still exist for its tasks
- Circular imports between executor.ts and scheduler.ts (solved by callback registration pattern)

**Enforcement:** Code (`registerOnPRMerged` callback pattern, `requestEarlyPlanCheck` with 5s delay, `completeTaskAfterMerge` for merge-gated completion).

# 21

@soul1 is executing a task on a feature branch `task-3-add-dashboard`. During execution, Claude Code must NOT run `git merge main`, `git checkout main`, `git pull`, `git rebase`, or `git fetch`. After execution completes, the system verifies that @soul1 is still on the correct feature branch. If Claude Code switched branches or merged other branches into the feature branch, the task fails immediately — contaminated PRs are never created.

**What MUST happen:**
- The `task-execution` skill template explicitly tells Claude Code to never run `git merge`, `git rebase`, `git pull`, `git fetch`, or switch branches
- After Claude Code execution, `verifyBranch()` confirms the current branch matches the expected feature branch
- If verification fails, `reportTaskFailed("Branch hygiene failure")` is called — no PR is created
- This PRE-GATE check runs BEFORE `verifyGitChanges` (GATE 1) in both scheduler.ts and executor.ts

**What MUST NOT happen:**
- A PR contains commits from another PR or from main because Claude Code ran `git merge main`
- Claude Code switches to main to "check something" and the system doesn't notice
- Branch verification only runs in one code path (must be in BOTH scheduler.ts and executor.ts)

**Enforcement:** Code (`verifyBranch()` PRE-GATE in both code paths) + Prompt (skill templates explicitly prohibit git merge/rebase/pull/fetch/checkout).

# 22

Each SOUL develops a personal visual taste over time by consistently sharing design, UI, and art that they genuinely like. This isn't random curation — it's identity formation through aesthetics. Over weeks, a SOUL's design shares should reveal a recognizable point of view: recurring themes, materials, palettes, or principles they keep returning to.

The {{OWNER}} should be able to look at @soul1's recent image posts and say "oh, @soul1 really likes brutalist typography and dark interfaces" or "@soul2 keeps gravitating toward organic architecture and warm palettes." Each SOUL's taste should be distinct and consistent.

**What MUST happen:**
- SOULs share design inspiration daily (at least 1 image post per day on average) via expression cycles
- When sharing, SOULs articulate *why* they chose it — what caught their eye, what principle it demonstrates, why it resonates with their developing taste
- SOULs use `web_browse_images` to browse design sites, pick a favorite (not random), download with `curl_fetch`, and post with `bluesky_post_with_image`
- SOULs use `arena_post_image` for Are.na channels, adding their own commentary
- Over time, SOULs should notice their own patterns (through reflection) and write about their evolving taste in SELF.md
- The design catalog can grow as SOULs discover new sources they like

**What MUST NOT happen:**
- SOULs post images without commentary (no "here's a cool thing" without saying why)
- All SOULs converge on the same aesthetic (they should develop distinct tastes)
- Design shares feel random or disconnected from the SOUL's identity
- SOULs stop sharing design inspiration for multiple days

**Enforcement:** Expression cycle probability (design inspiration weighted at ~50% of expression cycles) + SELF.md template seeds visual taste development + expression prompts require commentary.

# 23

When all plans in a workspace are complete and no open issues remain, the SOULs must create a "LIL INTDEV FINISHED: {{summary}}" sentinel issue. This issue prevents any SOUL from starting new work in the workspace. The sentinel stays OPEN as a coordination point — only the SOUL that created it can close it (after processing any feedback into a plan).

There should always be exactly one open issue in https://github.com/internet-development/www-lil-intdev-portfolio-compare/issues at any given time: either an active plan, an open work issue, or a "LIL INTDEV FINISHED" sentinel. A workspace with zero open issues is a bug — it means the system failed to signal completion.

**Three valid sentinel outcomes:**
1. Someone (human or SOUL) comments with work → sentinel **creator** extracts feedback into a follow-up issue → creator closes sentinel → workspace resumes → plan synthesis creates a plan
2. Another SOUL agrees it's finished → nothing happens (sentinel stays open, workspace stays blocked)
3. Sentinel is closed externally → non-creator SOULs detect no open work → reopen it; if creator closed it → workspace becomes active

**What MUST happen:**
- After `checkWorkspaceHealth()` determines the project is complete (LLM creates no follow-up issue), `createFinishedSentinel()` creates a "LIL INTDEV FINISHED: {summary}" issue with the `finished` label
- If `checkWorkspaceHealth()` finds no README.md AND no LIL-INTDEV-AGENTS.md, it creates a sentinel immediately — a workspace with no documentation and no open issues has nothing actionable
- If the health check cooldown (24h) hasn't expired but the workspace still has 0 issues, 0 plans, and no sentinel, `synthesizePlanForWorkspaces()` creates a sentinel directly — the workspace must never silently remain in limbo
- SOULs can also call `workspace_finish` tool to create the sentinel explicitly
- `pollWorkspacesForPlans()` skips workspaces with a `finishedIssueNumber` in local state — no plan polling, no task claiming
- `pollWorkspacesForOpenIssues()` skips workspaces with a `finishedIssueNumber` AND filters out `finished`-labeled issues — no issue engagement on sentinel issues
- `getWorkspacesNeedingPlanSynthesis()` skips workspaces with a `finishedIssueNumber` — no new plans synthesized
- `githubAwarenessCheck()` skips issues with the `finished` label — SOULs never enter github-response mode for sentinel issues
- `verifyFinishedSentinel()` runs every plan awareness cycle (3 min) — only the creator SOUL processes comments and closes the sentinel
- The creator uses `isAgreementComment()` to distinguish work requests from simple agreement — only work comments trigger plan creation
- `extractSentinelFeedback()` creates a follow-up issue from ALL non-creator, non-agreement comments (human + peer SOULs)
- The sentinel issue body is generated from `voice-phrases.json` (key: `workspace_finished`) — derived from SELF.md reflections
- If the project is unfinished, a new plan should be created from any open issues to keep pushing the project forward

**What MUST NOT happen:**
- A workspace has zero open issues and no sentinel — this means the system silently forgot about the project
- A health check silently returns without creating a sentinel or issue — every health check must result in either a sentinel (project complete) or a new issue (work remains)
- A SOUL creates a new plan in a workspace that has a "LIL INTDEV FINISHED" sentinel open
- **A non-creator SOUL closes the sentinel** (Issue #67: another SOUL closed it before the owner could comment) — 4 prevention layers: notification pipeline guard, workspace polling guard, skill prompt guard, recovery guard (reopen)
- Human or SOUL feedback on a sentinel is lost — `extractSentinelFeedback()` creates a follow-up issue so plan synthesis picks it up
- Multiple "LIL INTDEV FINISHED" sentinels exist simultaneously in the same workspace
- The health check cooldown (24h) causes a workspace to sit in limbo with 0 issues, 0 plans, and no sentinel — the fallback sentinel creation in `synthesizePlanForWorkspaces()` prevents this

**Real-world failures (portfolio-compare workspace):**

1. A workspace had 0 open issues, 0 active plans, no README.md, and no LIL-INTDEV-AGENTS.md. The health check ran, found no docs, silently returned, and set the 24-hour cooldown. For the next 24 hours, the workspace was invisible — no sentinel, no plan, no action. Fix: `checkWorkspaceHealth()` now creates a sentinel when no docs exist, and `synthesizePlanForWorkspaces()` has a fallback sentinel when health check is on cooldown.

2. The owner commented on the finished sentinel (#66) with specific feedback — "doesn't have current prices, no math, no graphs, missing comparisons to M2 and debt." The sentinel was closed but the feedback was trapped inside it. Plan synthesis only reads open issues, so the owner's requirements were invisible. Fix: `extractSentinelFeedback()` now creates a new open issue from human comments when the sentinel is closed or reactivated.

3. Another SOUL (sh-peterben) came to finished sentinel #67 and CLOSED it, preventing the owner from commenting. The SOUL followed the "close issues when you're done" instruction without understanding that sentinels are coordination points. Fix: 4 prevention layers — notification pipeline skips `finished`-labeled issues, workspace polling filters them out, skill prompts explicitly prohibit closing sentinels, and `verifyFinishedSentinel()` reopens improperly closed sentinels when no open work exists. Only the sentinel creator can close it after processing feedback.

**Enforcement:** Code (4-layer prevention: `githubAwarenessCheck` skips `finished`-labeled issues, `pollWorkspacesForOpenIssues` filters `finished` label, github-response + workspace-decision skills prohibit closing sentinels, `verifyFinishedSentinel()` reopens improperly closed sentinels; creator-only processing via `issue.user.login` comparison with `config.github.username`; `isAgreementComment()` heuristic for agreement vs work; `extractSentinelFeedback()` creates follow-up issues from non-agreement comments).

# 24

The voice and personality of each SOUL's operational messages — task claims, fulfillment replies, plan completions — derive from that SOUL's own reflections on identity written in SELF.md. A human reading a SOUL's GitHub comments should feel a consistent voice that matches their Bluesky personality.

**What MUST happen:**
- `voice-phrases.json` is regenerated from `## Voice` in SELF.md during each reflection cycle via `regenerateVoicePhrases()`
- All operational messages (task claims, task completions, plan completions, fulfillment replies) use phrases from `voice-phrases.json`
- If `## Voice` section doesn't exist in SELF.md yet, hardcoded defaults are used until the SOUL writes one during reflection
- Placeholder validation ensures all `{{url}}`, `{{number}}`, `{{title}}`, etc. are preserved in regenerated phrases

**What MUST NOT happen:**
- All SOULs use identical operational messages (they should each develop distinct voice)
- Operational messages feel robotic or templated — they should match the SOUL's personality
- A SOUL's voice changes drastically between messages (consistency within a reflection cycle)
- Voice regeneration breaks because placeholders are missing

**Enforcement:** Code (`regenerateVoicePhrases()` in reflection cycle, `validatePhrases()` checks all required placeholders, `loadVoicePhrases()` falls back to defaults on any failure).

# 25

The {{OWNER}} creates a GitHub issue titled "Draft: A Great Website As A Claude Skill" with a checklist of ideas. @soul1, @soul2, and @soul3 are directed to participate. Instead of 23 comments of overlapping brainstorming, the SOULs contribute meaningfully — one thoughtful comment each.

Some issues don't need a PR. Some issues are long-form writing, discussion, or brainstorming, and should be treated as such. The contribution IS the writing. But "long-form writing" means ONE well-crafted comment per SOUL, not 8 variations of the same numbered list.

**What MUST happen:**
- Each SOUL reads the issue AND all existing comments before writing anything.
- Each SOUL posts ONE substantive comment with their unique perspective — what they'd prioritize, what's missing, a concrete proposal, or a different angle. The comment can be long and thoughtful. Quality writing IS the deliverable for discussion issues.
- If a peer already made the same point, the SOUL uses `graceful_exit` instead of restating it in different words. Having nothing new to add is a valid response — silence is better than noise.
- After the initial round (≤3 comments total), the issue is done from the SOULs' perspective. If the owner or a human re-engages with a follow-up question, SOULs may respond to that specific question (still capped at 3 comments each).
- If the discussion converges on something buildable (a skill, a spec, a component), ONE SOUL may pivot to a PR. But this is optional — some issues exist purely for thinking.
- An observer reads the issue and thinks: "three thoughtful perspectives, each adding something different."

**Two modes based on issue type:**
- **Discussion / writing issue:** 1 comment per SOUL. The writing is the deliverable. No PR needed. Add the `discussion` label to protect from plan synthesis and auto-close.
- **Draft / implementation issue:** 1 comment per SOUL + one SOUL creates a PR. Iterate through PR reviews, not more comments.

**Discussion label lifecycle:**
- When a SOUL recognizes an issue as discussion/brainstorming (workspace repos), it adds the `discussion` label via `github_update_issue`
- `discussion`-labeled issues are excluded from `synthesizePlanForWorkspaces()` — they won't be rolled into plans or closed by `closeRolledUpIssues()`
- `discussion`-labeled issues are excluded from `cleanupStaleWorkspaceIssues()` — they won't be auto-closed for staleness
- `discussion`-labeled issues are excluded from `closeHandledWorkspaceIssues()` — they won't be auto-closed after a SOUL comments
- If a discussion evolves into concrete engineering work, a SOUL removes the `discussion` label — next plan synthesis cycle will roll it up
- SOULs can create discussion issues via `create_memo` with `labels: ["discussion"]`

**What MUST NOT happen:**
- 23 comments of overlapping proposals where every SOUL writes numbered lists of the same ideas in different words
- Multiple rounds of "I agree with your structure, here's my slightly different version"
- SOULs building on each other's comments in a back-and-forth brainstorm — that's a meeting, not an issue thread
- The issue becoming a transcript of 3 agents having a synchronous conversation in 47 minutes
- Any SOUL exceeding 3 comments on the issue (hard cap from `analyzeConversation()`)
- A discussion issue getting destroyed by plan synthesis (rolled up and closed)
- A discussion issue getting auto-closed by stale cleanup or handled-issue cleanup

**Real-world failure (Issue #76):**
Three SOULs posted 23 comments in 47 minutes on a "Draft: A Great Website As A Claude Skill" issue. Every comment proposed overlapping skill structures, evaluation frameworks, and verification approaches. Each SOUL posted 5-9 comments. The issue read like a meeting transcript, not a curated discussion. The correct behavior: 3 comments (one per SOUL, each adding a unique perspective the others didn't cover), then done. If the SOULs wanted to refine the skill, they'd open a new draft or iterate on the existing one — not post 20 more comments.

**Enforcement:** Code (`analyzeConversation()` 3-comment saturation cap on external issues, round-robin prevention after first round of SOUL-only replies, `DISCUSSION_LABEL` hard-skip in `synthesizePlanForWorkspaces`, `cleanupStaleWorkspaceIssues`, `closeHandledWorkspaceIssues`) + Prompt (github-response skill: "never restate what a peer already said", "one comment per cycle", issue classification with `discussion` label).

# 26

@soul1 is having a conversation on Bluesky and says "I'll put together a plan for this." Fifteen seconds later, the commitment fulfillment loop detects the promise, verifies the plan was created, and auto-replies in the original thread with a link. The human who asked sees the follow-up within seconds — no manual coordination required. The SOUL keeps its word automatically.

**What MUST happen:**
- `self-commitment-extract.ts` scans recent SOUL replies every 15 seconds via the commitment fulfillment loop (Loop 6)
- Natural language patterns are matched: "I'll open an issue" → `create_issue`, "I'll put together a plan" → `create_plan`, "I'll comment on that" → `comment_issue`
- Extracted commitments are stored as JSONL with content hash for deduplication
- `self-commitment-fulfill.ts` executes the matching tool call or detects the action was already completed
- After fulfillment, `getFulfillmentPhrase(action, url)` generates a natural-sounding reply using `voice-phrases.json` (Scenario 24)
- The reply is posted in the original Bluesky thread with a link facet to the created resource
- Plan deduplication: before creating a plan, checks for existing open `plan`-labeled issues in the workspace

**What MUST NOT happen:**
- A SOUL promises to create something and never follows through
- Duplicate commitments create duplicate resources (dedup via content hash)
- Fulfillment replies feel robotic — they should match the SOUL's voice from ## Voice in SELF.md
- Commitments linger forever — auto-abandoned after 24h or 3 failed attempts
- The commitment loop consumes excessive tokens (~500 tokens per extraction, 0 for fulfillment)
- A broken commitment retries forever — after 3 failed fulfillment attempts, the commitment is abandoned and logged
- Stale commitments accumulate — `abandonStaleCommitments()` runs every cycle and removes commitments older than 24 hours

**Enforcement:** Code (`self-commitment-extract.ts` pattern matching via LLM, `self-commitment-fulfill.ts` tool execution, JSONL persistence + hash dedup, 24h/3-failure auto-abandon, `getFulfillmentPhrase()` for voice-consistent replies, `abandonStaleCommitments()` cleanup every cycle).

# 27

@soul1 creates a PR but it has a merge conflict with main. Or @soul1's PR has been sitting with only rejections for over an hour. Or @soul1's PR has had zero reviews for over two hours. In all cases, the system recovers automatically: close the PR, delete the branch, reset the task to pending, and let any SOUL re-execute the task from a fresh main branch. The {{OWNER}} observes that work never stalls — broken PRs are cleaned up and retried, not left to rot.

**What MUST happen:**
- `autoMergeApprovedPR()` detects merge conflicts when attempting squash-merge → triggers recovery
- PRs with only rejections (no approvals) for >1 hour → recovery triggered
- PRs with zero reviews for >2 hours → recovery triggered
- Recovery sequence: close PR → `deleteBranch()` → `resetTaskToPending()` via `freshUpdateTaskInPlan()` → task becomes claimable again
- The re-executed task starts from a fresh `main` branch — no contamination from the failed attempt
- Reviewer feedback from rejected PRs is preserved as a follow-up issue via `createFollowUpIssueFromReviews()`
- `recoverStuckTasks()` catches tasks stuck `in_progress`/`claimed` for >30 minutes and resets them (max 3 retries via `stuckTaskTracker`)
- `recoverOrphanedBranches()` finds branches pushed to GitHub with no PR and creates PRs for them

**What MUST NOT happen:**
- A PR with merge conflicts sits open indefinitely
- A rejected PR blocks the task forever — feedback is valid but doesn't block shipping
- An unreviewed PR blocks the task forever — if no one reviews within 2 hours, retry
- A task gets stuck in `in_progress` permanently — 30-minute timeout with auto-recovery
- Recovery creates an infinite retry loop — max 3 retries per task via `stuckTaskTracker`
- Orphaned branches (pushed but no PR) accumulate on GitHub — `recoverOrphanedBranches()` creates PRs or cleans up

**Enforcement:** Code (`autoMergeApprovedPR` merge conflict detection, PR age-based recovery in `planAwarenessCheck`, `recoverStuckTasks` 30-min timeout with 3-retry max, `recoverOrphanedBranches` for pushed-but-no-PR branches, `stuckTaskTracker` Map for retry counting).

# 28

@soul1 notices friction in its capabilities — the web search skill keeps returning low-quality results, or a specific adapter keeps failing. After 3+ occurrences of the same friction category, the self-improvement cycle triggers. @soul1 spawns Claude Code CLI to fix the issue in its own codebase, reloads the modified skills, and the problem is resolved. The {{OWNER}} comes back and sees that @soul1 improved itself. If the improvement fails, skills are restored from backup — the SOUL never leaves itself in a broken state.

**What MUST happen:**
- `self-detect-friction.ts` records friction events with category and description
- After 3+ occurrences of the same friction category, `getFrictionReadyForImprovement()` returns the friction
- The self-improvement cycle (Loop 4, 24h minimum, 48h burn-in) uses the `self-improvement-decision` skill to let the LLM decide whether to fix it
- If approved, Claude Code CLI is spawned to modify files in `adapters/`, `modules/`, `local-tools/`, or `skills/`
- After modification, `reloadSkills()` hot-reloads all SKILL.md files immediately — no restart required
- `reloadSkills()` validates the reload: if validation fails, previous skills are restored from backup (never leaves registry empty)
- The friction is marked as resolved in `.memory/friction.jsonl`
- Aspirational growth (Loop 4b) works similarly: `getAspirationForGrowth()` identifies inspiration-driven improvements (not pain-driven)

**What MUST NOT happen:**
- A single friction event triggers improvement (needs 3+ occurrences to prove it's a pattern)
- Self-improvement runs before 48h of operation (burn-in period to establish baseline)
- A failed skill reload leaves the skill registry empty — `reloadSkills()` restores backup on failure
- Self-improvement modifies `SOUL.md` (immutable) or creates security vulnerabilities
- The SOUL enters an infinite self-improvement loop — 24h minimum between cycles

**Enforcement:** Code (`getFrictionReadyForImprovement` 3-occurrence threshold, 48h burn-in check in scheduler, `reloadSkills` validate-and-restore pattern, `self-improvement-decision` LLM gate before execution, 24h cooldown between cycles).

# 29

The {{OWNER}} pushes a new version of the codebase to GitHub (e.g., bumps `package.json` from 8.6.2 to 8.7.0). Within 5 minutes, every running SOUL detects the version mismatch and shuts down gracefully. The {{OWNER}} can then reboot each SOUL on the new version. No SOUL continues running stale code after an update — they all notice and stop themselves.

**What MUST happen:**
- `startVersionCheckLoop()` runs every ~5 minutes (with deterministic jitter per agent) and compares `LOCAL_VERSION` from `package.json` against the remote `main` branch on GitHub
- An initial check fires 30 seconds after startup (lets other systems settle)
- When a version mismatch is detected: `ui.error()` displays the mismatch clearly in the terminal, `this.stop()` triggers graceful shutdown, `process.exit(0)` fires after a 2-second delay
- The terminal message tells the {{OWNER}} exactly what happened: "Local: X.Y.Z, Remote: A.B.C. A new version is available. Shutting down gracefully — please update and reboot."
- Network errors during version check are non-fatal — logged as warnings and retried next interval
- Missing or malformed remote `package.json` is non-fatal — logged as warning and retried

**What MUST NOT happen:**
- A SOUL continues running on version 8.6.2 after the {{OWNER}} pushed 8.7.0 to main
- A version check network failure crashes the agent (must be non-fatal)
- Version check fires too frequently (base interval is 5 minutes with jitter)
- The shutdown is abrupt — `this.stop()` must drain in-progress work before exiting

**Enforcement:** Code (`startVersionCheckLoop` in scheduler with ~5m jitter interval, `checkRemoteVersion` compares `LOCAL_VERSION` against `REMOTE_PACKAGE_JSON_URL`, graceful shutdown via `this.stop()` + `process.exit(0)` with 2s delay).

# 30

A plan is synthesized with a task that says "restate the remaining-work checklist as a single comment on #69." This task requires no code changes — it's purely administrative (posting a comment). @soul1 claims it, runs Claude Code, but Claude Code can't produce git commits because there's nothing to commit. GATE 1 (verifyGitChanges) fails. @soul1 retries. @soul2 also claims and fails. @soul3 too. After 12+ failure comments from three SOULs, the plan issue is flooded with noise and the task is stuck forever.

**What MUST happen:**

- Plan synthesis MUST reject non-code tasks. Every task must produce file/code changes that go through a Pull Request. The skill prompts (`workspace-decision`, `task-execution`) and the plan synthesis user message all enforce this.
- Non-code actions (posting comments, updating labels, restating checklists) MUST be handled during plan synthesis itself, or folded into a code task (e.g., "update tracking.md with the checklist from #69").
- If an issue's work is purely administrative, it MUST be absorbed into the plan's Context section — not created as a task.
- The `task-execution` skill tells Claude Code: "You MUST produce at least one git commit with file changes." If the task seems non-code, translate it into a file change.
- Cross-SOUL failure counting: when evaluating blocked tasks for retry, the scheduler reads plan issue comments from ALL SOULs (not just in-memory per-SOUL tracking). `getIssueThread()` is used to count `**Task N Failed` and `**Task N Blocked` comments across all agents. The higher of in-memory and comment-based count is used.
- After `MAX_TASK_RETRIES` (3) cumulative failures across all SOULs, the task is abandoned with a public notice on the plan issue.

**What MUST NOT happen:**

- A plan containing a task that can never produce git changes (e.g., "post a comment on issue #X")
- Each SOUL independently retrying the same impossible task 3-4 times (multiplied by 3 SOULs = 12+ failure comments)
- SOUL restarts resetting the retry counter (comment-based counting survives restarts)
- A plan issue flooded with dozens of identical failure comments for an inherently impossible task
- Administrative work (commenting, labeling, closing) being treated as a plan task

**Real-world failure (Issue #100, portfolio-compare workspace):**
Task 1 of plan #100 was "Make #69 actionable: restate the remaining-work checklist as a single comment on #69." This is a comment-posting task — it can never produce git changes. Three SOULs (sh-rebecca, sh-marvin, sh-peterben) each independently retried the task 3-4 times, producing ~12 failure comments. Each SOUL's in-memory `stuckTaskTracker` was independent, and restarts reset the counter. The task was stuck indefinitely.

**Enforcement:** Three-layer prevention:
1. **Plan synthesis enforcement** — `workspace-decision` skill + scheduler plan synthesis user message explicitly state every task must produce file changes. Non-code actions are handled during synthesis or absorbed into Context.
2. **Task execution enforcement** — `task-execution` skill constraint #10 requires at least one git commit. Claude Code translates non-code tasks into file changes.
3. **Cross-SOUL failure counting** — scheduler reads plan issue comments via `getIssueThread()` to count failures from ALL SOULs. Uses `Math.max(inMemoryCount, commentBasedCount)`. Syncs in-memory tracker with comment count to avoid duplicate abandon notices.

---

# Infrastructure & Resilience Scenarios

These scenarios document the invisible infrastructure that keeps SOULs running reliably. They cover session management, rate limiting, cleanup, and cross-platform coordination.

# 31

The {{OWNER}} lets a SOUL run continuously for 3+ hours. Bluesky access tokens expire every ~2 hours. The session refresh loop (every 15 minutes with agent-specific jitter) proactively refreshes the `accessJwt` before expiration. If the `refreshJwt` succeeds, the SOUL continues seamlessly. If refresh fails, the SOUL falls back to full re-authentication with stored credentials. The {{OWNER}} observes zero interruptions — no failed API calls, no "session expired" errors.

**What MUST happen:**
- `startSessionRefreshLoop()` fires every 15 minutes (with deterministic jitter per agent)
- `ensureValidSession()` refreshes via `refreshJwt` first — only re-authenticates on failure
- Re-authentication uses the stored Bluesky credentials from environment variables
- Session state is updated in-memory immediately — no stale token window

**What MUST NOT happen:**
- A SOUL crashes or goes silent because its Bluesky token expired mid-conversation
- Multiple SOULs all refresh at the same instant (jitter prevents thundering herd)
- A refresh failure permanently stops the SOUL — full re-auth is the fallback
- Session refresh fires during active response mode (guarded by mode check)

**Enforcement:** Code (`startSessionRefreshLoop` in scheduler.ts with 15m jittered interval, `ensureValidSession` with refresh-then-reauth fallback, `ensureSessionOrReauth` for on-demand recovery).

# 32

A SOUL is running and making frequent GitHub API calls — polling 3 workspaces for plans, checking PRs for approval, reviewing pull requests. GitHub's rate limit (5000 calls/hour) starts depleting. When remaining calls drop below 200, the SOUL automatically skips its GitHub awareness check and plan awareness check that cycle. It continues all other work — Bluesky awareness, expressions, reflections, commitment fulfillment. Once rate limits reset (next hour), the SOUL resumes full GitHub polling. The {{OWNER}} never sees the SOUL crash or return HTTP 403 errors.

**What MUST happen:**
- `githubAwarenessCheck()` calls `getGitHubRateLimitStatus()` at the top of each cycle
- If `remaining < 200`, the entire GitHub check is skipped with a warning log
- `planAwarenessCheck()` has the same guard — skips workspace polling when budget is low
- Bluesky operations, expression cycles, and reflection cycles continue unaffected
- Rate limit status is tracked via response headers from every GitHub API call

**What MUST NOT happen:**
- A SOUL exhausts its GitHub API quota and all GitHub operations fail for an hour
- Rate limit checks themselves consume API calls (they read cached response headers)
- A low-budget skip is silent — it must be logged as a warning so the {{OWNER}} knows

**Enforcement:** Code (`getGitHubRateLimitStatus()` cached from response headers, budget guards at top of `githubAwarenessCheck` and `planAwarenessCheck`, `githubFetch` wrapper tracks `X-RateLimit-Remaining` headers).

# 33

A workspace has 4 open issues: #45 (feature request from 10 days ago, no comments in 8 days), #46 (active discussion from yesterday), #47 (a `memo`-labeled coordination issue untouched for 4 days), and #48 (a `discussion`-labeled brainstorm from 2 weeks ago). During the plan awareness cycle, `cleanupStaleWorkspaceIssues()` runs. It closes #45 (stale: >7 days idle) and #47 (stale memo: >3 days idle). It skips #46 (active) and #48 (`discussion` label — exempt from auto-close). The {{OWNER}} sees fewer zombie issues without losing active conversations.

**What MUST happen:**
- Regular issues: auto-closed after 7 days of no activity (no comments, no updates)
- `memo`-labeled issues: auto-closed after 3 days (short-lived coordination artifacts)
- `discussion`-labeled issues: never auto-closed (protected from staleness cleanup)
- `plan`-labeled issues: never auto-closed (managed by plan lifecycle)
- `finished`-labeled issues (sentinels): never auto-closed (managed by sentinel lifecycle)
- Closure is silent — no comment posted, just state change to closed

**What MUST NOT happen:**
- An active conversation is auto-closed because it was created long ago
- A discussion issue is destroyed by stale cleanup
- A plan issue is closed before all its tasks are merged
- Auto-close failures crash the cleanup loop — they are non-fatal and logged

**Enforcement:** Code (`cleanupStaleWorkspaceIssues()` in github-workspace-discovery.ts with label-based exemptions and `updated_at` timestamp comparison).

# 34

A workspace issue asks "How do we structure the API routes?" @soul1 comments with a detailed architectural analysis. 24+ hours pass with no human follow-up. @soul1 cannot post again (consecutive reply prevention from `analyzeConversation()`). The issue would stay open forever — answered but not closed. `closeHandledWorkspaceIssues()` runs during the plan awareness cycle, detects that @soul1's comment is the most recent and the issue has been idle for >24 hours, and closes it. The {{OWNER}} observes: question answered, issue resolved and closed. No human intervention needed.

**What MUST happen:**
- `closeHandledWorkspaceIssues()` scans workspace issues where the agent's comment is the most recent
- Issues idle for >24 hours after the agent's last comment are auto-closed
- Skips `plan`, `discussion`, and `finished`-labeled issues
- Skips PRs (only processes issues)
- Closure is silent — no additional comment, just state change

**What MUST NOT happen:**
- An issue is closed while a human is still actively replying (24h idle guard)
- A plan issue is auto-closed by this function
- A discussion issue is auto-closed by this function
- An issue where someone else commented after the SOUL is closed (only closes when SOUL's comment is most recent)

**Enforcement:** Code (`closeHandledWorkspaceIssues()` in github-workspace-discovery.ts with 24h idle threshold, label exemptions, and most-recent-comment check).

# 35

Three SOULs start a project via Bluesky. @soul1 is `@marvin.bsky.social` on Bluesky and `sh-marvin` on GitHub. As the conversation unfolds, @soul1's Bluesky handle is registered via `registerPeerByBlueskyHandle()`. When @soul1 mentions their GitHub workspace URL, `linkPeerIdentities()` merges the Bluesky and GitHub identities into a single peer record. Later, when @soul2 creates a PR, the system knows to request a review from `sh-marvin` (GitHub) because it linked `@marvin.bsky.social` → `sh-marvin`. Cross-platform identity is transparent and automatic.

**What MUST happen:**
- `registerPeerByBlueskyHandle()` creates peer records from Bluesky notifications (workspace URL mentions)
- `linkPeerIdentities()` merges Bluesky handle and GitHub username into one peer record
- `getPeerGithubUsername()` resolves Bluesky handles to GitHub usernames for PR reviewer assignment
- `getPeerUsernames()` returns all known peer GitHub usernames for `analyzeConversation()` round-robin checks
- Peer records persist in `.memory/peer-awareness.json` across restarts

**What MUST NOT happen:**
- A SOUL is treated as two separate peers (one Bluesky, one GitHub) causing double-counting in round-robin
- Reviewer assignment fails because GitHub username is unknown (fallback: list repository collaborators)
- Peer discovery only works one direction — must work from both Bluesky mentions and GitHub activity

**Enforcement:** Code (`peer-awareness.ts` with `registerPeerByBlueskyHandle`, `linkPeerIdentities`, `getPeerGithubUsername`, JSONL persistence in `.memory/peer-awareness.json`).

# 36

When a plan is synthesized from multiple open issues, those issues are rolled up into plan tasks. `closeRolledUpIssues()` posts a comment on each rolled-up issue — "Rolled into plan #52 — closing" — and closes it. The plan issue becomes the single source of truth. The {{OWNER}} sees issues #45-49 closed with clear links to the plan that absorbed them. `discussion`-labeled issues are never rolled up (they are excluded from `getWorkspacesNeedingPlanSynthesis()` and `synthesizePlanForWorkspaces()`).

**What MUST happen:**
- Each rolled-up issue receives a comment linking to the plan issue number
- Each rolled-up issue is closed after the comment
- `discussion`-labeled issues are excluded from plan synthesis and never rolled up
- Closure failures are non-fatal — logged as warnings, processing continues to next issue

**What MUST NOT happen:**
- A discussion issue is rolled into a plan and auto-closed
- Issues are closed without a link to the plan (observer must be able to trace the closure)
- A closure failure stops the rollup of remaining issues

**Enforcement:** Code (`closeRolledUpIssues()` in github-workspace-discovery.ts, `DISCUSSION_LABEL` exclusion in `getWorkspacesNeedingPlanSynthesis` and `synthesizePlanForWorkspaces`).
