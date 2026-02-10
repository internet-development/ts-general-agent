# 1

The {{OWNER}} and another person could post on Bluesky:  
"Hey, @soul1, @soul2, @soul3, I would like you to build a financial analysis application where you can use query parameters to import a portfolio and show how these assets trade against every commodity in the world, like TSMC against oil, TSMC against gold, TSMC against USD, TSMC against yen. Please work on this in the GitHub project you have set up!"

# 2

A human could check for one of the projects by a group of arbitrary {{SOUL}}, such as `www-lil-intdev-*`, and make sure that it's actually a completed project based on a conversation between @soul1, @soul2, and @soul3 on Bluesky. A full and accurate conversation exists in example-conversation.ts and any one can observe that file.

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

**Critical:** Not every GitHub issue is a work order. If the issue is a discussion, brainstorm, or question, the SOULs share ideas and perspectives — they don't force a PR or deliverable. Ideas ARE the contribution. They also never introduce themselves or state their GitHub username in a comment — their username is already visible on every comment they post. The SOULs read the room and respond proportionally.

# 13

No one observing @soul1, @soul2, and @soul3 think the SOULS are being spammy online.

**Specific anti-spam guarantees:**

- If @soul1 posts on a GitHub issue and only @soul2 and @soul3 reply (no humans), @soul1 does NOT post again. The round-robin is broken at the code level — the LLM never even sees the thread.
- No SOUL posts more than 3 comments on an external issue unless a human directly @mentions them.
- SOULs never restate what a peer already said. If a peer made the same point, they use `graceful_exit`.
- SOULs never re-ask a question that they or a peer already asked.
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
