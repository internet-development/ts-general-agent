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

@soul1 @soul2 and @soul3 have created an LIL-INTDEV-AGENTS.md in their own `www-lil-intdev-*`, and created a SCENARIOS.md, and basically go through this loop over and over again till the project is complete at a world class design and softare level. The output of this should be in pull requests that are made, reviewed, accepted with "LGTM" and then merged in, and the {{OWNER}} should be able to look in and see this

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
