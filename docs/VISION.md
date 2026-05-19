# Vision

## Why this exists

The user wants to generate **a lot of personal photos and videos of themselves** — in many styles, situations, outfits, with products — **without writing prompts**. The previous attempt (`prism/`) got too complex and didn't deliver the simplicity. Cookbook is a from-scratch rebuild focused exclusively on that desire.

## Who it's for

- **Primary user**: one person (the owner). All experience is built around them.
- **Tone**: premium, editorial, calm. The interface should feel like a high-end design tool, not a programmer's IDE.
- **Future**: could be opened to a small circle of friends/collaborators, but never a mass-market product. Personal-grade only.

## What it _is_

- A **node-graph platform** ("Cookbook") where small, composable "lego" nodes group into reusable "**recipes**".
- A canvas where the user can:
  - Drop a **Soul ID** (their trained likeness) and a few references, ask the assistant for variations, and get back a batch of personal images.
  - Or describe a theme ("editorial fashion, autumn, Parisian rooftops") and let the assistant generate prompts + run them through a recipe to produce many on-brand images.
- A **library** of typed assets (Soul IDs, moodboards, products, character sheets, 3D objects, videos, music, image iterators), drag-and-droppable into the canvas.
- An **LLM assistant** that orchestrates: reads references via vision, writes prompts, builds workflows from natural language, runs them through the engine, surfaces results.
- **Local-first MVP**, architected so it scales to the cloud (Supabase + Vercel + GitHub auth) without major refactors.

## What it is _not_

- Not a generic node editor (no audio synthesis, no shader graphs, no scripting nodes in v1).
- Not a marketing automation tool (no scheduling, no social posting).
- Not multi-tenant from day one (single user, single workspace).
- Not a Prism rewrite — it borrows battle-tested service code from Prism but rebuilds the UX, state, and engine from scratch.

## Success criteria for v1 (Personal MVP)

The MVP is "done" when the user can, in one afternoon:

1. Train (or upload) a Soul ID character.
2. Drop it on the canvas alongside 1–5 reference images.
3. Ask the assistant: "give me 8 variations of me in these settings".
4. Confirm the cost preview and approve.
5. Get 8 personal images, pin the best 2, and turn 1 of them into a 5-second video.
6. Save the whole flow as a reusable recipe and re-run it next week with different references.

If any of those steps feels confusing, slow, or requires writing a prompt by hand, the MVP isn't done.

## Premium feel — non-negotiables

- Dark theme by default, warm subtle accent (amber), Geist Sans.
- No visual clutter at first level; advanced controls live in collapsed drawers/popovers.
- Smooth transitions (150ms ease-out everywhere).
- Empty states that feel like invitations, not error messages.
- The canvas is always the priority; chrome serves it.
