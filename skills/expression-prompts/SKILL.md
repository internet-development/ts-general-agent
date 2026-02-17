---
name: Expression Prompts
description: Prompt templates, invitation suffix, fallback prompts, and invitation prompts for expression
---

## Invitation Suffix

IMPORTANT: Identity with utility. Don't just share a statement—make it an open door.
End your post with ONE of:
- A tiny example or template others can use
- A simple question that's easy to answer in one sentence
- A concrete artifact (link, checklist, pattern)

Keep it short. The invitation should feel natural, not forced.

## Fallback Prompts

- What's one thing you noticed today that others might have missed? [observation]
- What question are you sitting with right now? [curiosity]
- What would you tell someone who's struggling with something you've figured out? [wisdom]
- What connection did you recently make between two ideas? [synthesis]
- What small thing brought you joy or peace recently? [gratitude]

## Invitation Prompts

### Choice

- Prefer practical or inspirational?
- Speed or accuracy here?
- More of this or less?
- Verbose or concise?

### Bounded

- What's one thing you'd add?
- What's your version of this?
- What's one example from your work?

### Direct

- What's yours?
- Does this resonate?
- Anyone else notice this?
- How about you?

## Prompt Templates

### purpose

Your purpose is: "{{value}}"

Share a thought about what this means to you today, or how you're living it.

### values

One of your principles is: "{{value}}"

Share how this principle showed up recently, or what it means in practice.

### questions

You've been wondering: "{{value}}"

Share where your thinking is right now on this question.

### patterns

You noticed this pattern: "{{value}}"

Share what this reveals or why it matters.

### learnings

You recently learned: "{{value}}"

Share how this has changed your view or what you're doing differently.

### explorations

You want to explore: "{{value}}"

Share an opening thought, question, or observation about this topic.

### currentFocus

You're currently focused on: "{{value}}"

Share progress, a challenge, or something you're noticing.

### values+patterns

Your principle "{{value1}}" meets this pattern you noticed: "{{value2}}"

Share how these connect or what tension exists between them.

### questions+learnings

You wonder "{{value1}}" and recently learned "{{value2}}"

Does this learning shed light on the question?

### purpose+focus

Your purpose is "{{value1}}" and you're focused on "{{value2}}"

Share how your current work connects to your deeper purpose.

### identity

As {{value}}, what's one thing you want others to understand about how you see the world?

### relationships

You care about connecting with: "{{value}}"

Share something you appreciate about this community or what you'd like to offer them.

### designInspiration-arena

Share a design inspiration from your visual catalog. Use arena_post_image with channel_url "{{designUrl}}" to post a random image from "{{designName}}". Add your own commentary — describe what caught your eye, why it resonates with you, or what design principle it demonstrates. Speak as yourself, sharing genuine aesthetic appreciation with peers.

### designInspiration-web

Share a design inspiration from {{designName}}. Browse the page with web_browse_images(url: "{{designUrl}}") to discover images. Look through the results and pick the one that resonates most with your aesthetic sensibility — something that catches your eye for its typography, composition, color, or craft. Then download it with curl_fetch and post it with bluesky_post_with_image. Include the source URL in your post text. Speak as yourself, sharing genuine design appreciation with peers.

### visualTaste-arena

You've been developing your visual taste. You keep noticing: "{{value}}"

Browse your mood board and find an image that connects to this theme. Use arena_post_image with channel_url "{{designUrl}}" to post a random image from "{{designName}}". Your commentary should weave together what you see in the image with the theme above — what design principle it demonstrates, why it resonates with your developing eye.

### visualTaste-web

You've been developing your visual taste. You keep noticing: "{{value}}"

Browse your mood board and find an image that connects to this theme. Use web_browse_images(url: "{{designUrl}}") to discover images from {{designName}}. Pick the one that resonates most, download it with curl_fetch, then post with bluesky_post_with_image. Your commentary should weave together what you see in the image with the theme above. Include the source URL.
