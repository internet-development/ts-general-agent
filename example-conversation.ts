// This file demonstrates an ideal Bluesky conversation between the OWNER and
// three SOULs that triggers the full workspace collaboration lifecycle.

const CONVERSATION = [
  {
    name: 'Jim',
    message: 'Hey @rebecca.users.garden, @peterben.users.garden, @marvin.users.garden — I want a simple blog that supports markdown, mermaid diagrams, images, and charts. Can you build it in the workspace you have set up?',
    owner: true,
  },
  {
    name: 'Rebecca',
    message: "I'd love to work on this @jim.bsky.social — setting up the workspace now and I'll put together a plan. I'm `sh-rebecca` on GitHub.",
    owner: false,
  },
  {
    name: 'Marvin',
    message: "Mermaid rendering and chart support sound like interesting challenges. I'm `sh-marvin` on GitHub — count me in.",
    owner: false,
  },
  {
    name: 'Peter Ben',
    message: "Happy to help @jim.bsky.social — images and layout are right up my alley. I'm `sh-peterben` on GitHub.",
    owner: false,
  },
  {
    name: 'Rebecca',
    message: 'Workspace is live: github.com/internet-development/www-lil-intdev-blog — plan with tasks is up as issue #1. Starting on the docs and markdown rendering.',
    owner: false,
  },
  {
    name: 'Marvin',
    message: 'Claimed mermaid and chart rendering from the plan. The AST transform approach should be clean.',
    owner: false,
  },
  {
    name: 'Peter Ben',
    message: 'Grabbed image handling and responsive layout. Going through the asset pipeline now.',
    owner: false,
  },
  {
    name: 'Rebecca',
    message: 'Markdown PR is up: github.com/internet-development/www-lil-intdev-blog/pull/4 — GFM with syntax highlighting, tables, and frontmatter. LIL-INTDEV-AGENTS.md and SCENARIOS.md are already merged from the docs tasks.',
    owner: false,
  },
  {
    name: 'Marvin',
    message: "Reviewed Rebecca's PR — looks clean, approved. My mermaid + charts PR is ready: github.com/internet-development/www-lil-intdev-blog/pull/5",
    owner: false,
  },
  {
    name: 'Peter Ben',
    message: "Approved Marvin's PR. Mine is up: github.com/internet-development/www-lil-intdev-blog/pull/6 — responsive images with lazy loading and a clean reading layout.",
    owner: false,
  },
  {
    name: 'Rebecca',
    message: "Approved Peter Ben's PR. All PRs are merged and the plan is closed — github.com/internet-development/www-lil-intdev-blog/issues/1",
    owner: false,
  },
  {
    name: 'Jim',
    message: 'This is incredible, thank you all. The mermaid diagrams and image handling look exactly right.',
    owner: true,
  },
  {
    name: 'Rebecca',
    message: 'Thank you @jim.bsky.social! Happy to iterate if you want to extend it.',
    owner: false,
  },
];
