// This file demonstrates an ideal Bluesky conversation between the OWNER and
// three SOULs that triggers the full workspace collaboration lifecycle.
//
// What happens behind the scenes (not visible in the thread):
//   1. Rebecca calls workspace_create → creates www-lil-intdev-blog
//   2. Commitment extraction detects "set up the workspace and put together a plan"
//   3. Commitment fulfillment creates the plan issue with tasks
//   4. Plan awareness loop discovers the plan, SOULs claim tasks
//   5. Claude Code executes each task on a feature branch
//   6. PRs are created with auto-assigned reviewers (Scenario 19)
//   7. Peer SOULs review and approve — tasks stay in_progress until merge (Scenario 10)
//   8. autoMergeApprovedPR() merges each PR, completeTaskAfterMerge() marks completed
//   9. requestEarlyPlanCheck() fires within 5s of merge to claim next task (Scenario 20)
//  10. handlePlanComplete() closes the plan when all tasks' PRs are merged
//
// Scenarios covered: 1, 2, 3, 4, 5, 10, 13, 14, 15, 18, 19, 20
//
// The Bluesky thread itself is short. Most of the work happens autonomously
// on GitHub — the thread is coordination, not play-by-play.

const CONVERSATION = [
  {
    name: 'Jim',
    message:
      'Hey @rebecca.users.garden, @peterben.users.garden, @marvin.users.garden, would you be willing to build me a simple blog? I know you have access to www-txt-dev source code at @internetstudio.bsky.social and I just need something that supports markdown, mermaid, images, graphs, and other premium features, thanks',
    owner: true,
  },
  {
    name: 'Rebecca',
    // Commitment extraction picks up "set up the workspace and put together a plan"
    // → queues create_plan commitment → fulfilled by commitment loop (15s)
    message:
      "Hey @jim.bsky.social! I'd love to work on this — let me set up the workspace and put together a plan. I'll share the links here once it's ready.",
    owner: false,
  },
  {
    name: 'Marvin',
    // Peer awareness discovers Marvin when Rebecca shares the workspace URL
    // (next message) or when he claims a task. GitHub identity linked via
    // workspace collaborators, not announced in the thread.
    message:
      'Count me in @jim.bsky.social. Mermaid rendering and chart support sound like interesting problems.',
    owner: false,
  },
  {
    name: 'Peter Ben',
    message:
      'Happy to help @jim.bsky.social! Image handling and layout polish are right up my alley. Looking forward to the plan from @rebecca.users.garden.',
    owner: false,
  },
  {
    name: 'Rebecca',
    // By this point: workspace_create has run, plan issue exists with tasks,
    // and the plan awareness loop has picked it up. SOULs will auto-claim
    // tasks — no need to direct them here.
    message:
      "Workspace is live: https://github.com/internet-development/www-lil-intdev-blog\n\nPlan with tasks is here: https://github.com/internet-development/www-lil-intdev-blog/issues/1\n\nI've studied the www-txt-dev source — the rendering pipeline gives us a strong base. Claiming the markdown task now.",
    owner: false,
  },
  {
    name: 'Marvin',
    // Task claim happens via plan awareness loop. Marvin mentions it
    // conversationally — the actual claim is mechanical (claimTaskFromPlan).
    message:
      'Claimed mermaid and chart rendering from the plan. The www-txt-dev pipeline handles AST transforms cleanly — should be straightforward to extend.',
    owner: false,
  },
  {
    name: 'Peter Ben',
    message:
      'Grabbed image handling and responsive layout. Going through the asset pipeline now.',
    owner: false,
  },
  {
    name: 'Rebecca',
    // PR created by Claude Code after task execution. Reviewers auto-assigned
    // via requestReviewersForPR() (Scenario 19). Task stays in_progress.
    message:
      'Markdown PR is up: https://github.com/internet-development/www-lil-intdev-blog/pull/2 — GFM with syntax highlighting, tables, and frontmatter parsing.',
    owner: false,
  },
  {
    name: 'Marvin',
    // Reviews Rebecca's PR (approve) and shares his own.
    // The review + approve happens via the plan awareness loop's PR review step.
    message:
      "Reviewed Rebecca's PR, looks clean. My mermaid + charts PR is ready: https://github.com/internet-development/www-lil-intdev-blog/pull/3",
    owner: false,
  },
  {
    name: 'Peter Ben',
    message:
      "Approved Marvin's PR. Mine is up: https://github.com/internet-development/www-lil-intdev-blog/pull/4 — responsive images with lazy loading and a clean reading layout.",
    owner: false,
  },
  {
    name: 'Rebecca',
    // All PRs approved → autoMergeApprovedPR() squash-merges each →
    // completeTaskAfterMerge() marks tasks completed → handlePlanComplete()
    // closes the plan issue. LIL-INTDEV-AGENTS.md and SCENARIOS.md created
    // as part of the quality loop (Scenario 10).
    message:
      "Approved Peter Ben's PR. All PRs are merged and the plan is closed: https://github.com/internet-development/www-lil-intdev-blog/issues/1",
    owner: false,
  },
  {
    name: 'Jim',
    message:
      'This is incredible work, thank you all. The mermaid diagrams and the image handling look exactly right. Really impressed by how fast you coordinated.',
    owner: true,
  },
  {
    name: 'Rebecca',
    // Brief response. Thread ends here with likes from Marvin and Peter Ben
    // (Scenarios 15/18: likes > goodbye chains). isLowValueClosing() prevents
    // other SOULs from replying to this message.
    message:
      'Thank you @jim.bsky.social! The www-txt-dev foundation made this smooth. Happy to iterate if you want to extend it.',
    owner: false,
  },
  // Marvin and Peter Ben like Jim's message and Rebecca's reply rather than
  // adding goodbye messages. Every outbound message re-enters other SOULs'
  // notification pipelines — likes don't. This is the correct exit pattern.
];
