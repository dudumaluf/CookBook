# Cookbook Library — design + roadmap

> A single home for every recipe and every prompt the app uses. Inspect, organize, edit, and reuse the brains of the system without grep-ing the codebase.

This document is the source of truth for the Library feature. Every section stands alone — copy any section into another LLM (ChatGPT, Claude, etc.) to brainstorm without losing context.

---

## 1. The concept (plain English)

The app uses three kinds of "instructions" to do its work:

1. **Recipes** — saved subgraphs that act as one composite node. *"Seedance Prompt Director"* is a recipe. So is *"Image Describer"*. The user drops them on the canvas, fills the inputs, runs them.
2. **Prompts** — the actual text instructions sent to LLMs. The assistant has a base prompt that tells it how to behave. Each recipe contains a system prompt that guides the LLM inside it. Each LLM Text node has its own system prompt.
3. **Roles** *(planned, Phase D)* — specialist personas the assistant can adopt (Storyboard Director, Timeline Director, etc.). Each role is a focused prompt overlaid on the assistant's base prompt.

The **Cookbook Library** is where all of this lives. It's a single page that answers three questions:

- *What recipes do I have?* → browse, search, drop, duplicate, edit
- *What prompts are running this app?* → see every prompt the system uses, with plain-English descriptions of where each one fires
- *How do I make my own?* → use any prompt or recipe as a starting point for your own

Naming choice: the app is called **Cookbook**, the database table is `cookbook_recipes`, so a Library of recipes inside the Cookbook fits naturally. The existing "Library" feature in the app refers to **asset library** (images / videos / audio) — a separate concept that stays as-is.

---

## 2. Why we're building it

Three problems we have today:

| Problem | Example | Cost |
|---|---|---|
| **Recipe blindness** | The Seedance Prompt Director has 5 templates and a long curated system prompt buried in a SQL migration. There is no UI to read or edit it. | Users can't tune what they own; we can't iterate quickly. |
| **Prompt opacity** | The assistant uses `REASONER_INSTRUCTIONS` (in `src/lib/assistant/reasoner.ts`). Recipes use embedded prompts. LLM Text nodes have their own. To know what's actually being sent you have to read source code. | Erodes trust. Makes "is the assistant doing the right thing?" hard to answer. |
| **No room to grow** | Every new recipe and role we add bloats the Add Node panel + the assistant settings. Discovery degrades. | We can't ship the four prompting-guide-based specialists (Storyboard, Simple Scene, Timeline, plus extending Seedance) without a better home. |

The Library solves all three with one cohesive surface.

---

## 3. The premium-UI contract

Seven principles every Library screen has to honor. If at any point a screen feels cluttered, we redo it.

| Principle | Means in practice |
|---|---|
| **One screen, one job** | Recipe list shows recipes. Detail panel shows one recipe. No nested modals stacking. |
| **Plain-English everywhere** | Tooltips and inline copy describe concepts, not internals. "This recipe's instructions" not "system prompt JSONB." |
| **Quiet by default, loud on demand** | Versioning is invisible until something is actually different. Update badges only appear when there's actually a newer version. |
| **Copy-paste first-class** | Every prompt has a copy button. The format is plain text — portable to any other LLM. |
| **Reset is always one click** | "Restore default" button always visible on edited prompts. Users never feel trapped. |
| **No technical jargon in UI** | "Recipe" / "Prompt" / "Role" / "Version" — never `subgraph`, `JSONB`, `configParam`, `overrideKey`. |
| **Diff when it matters** | If you've edited a default prompt, side-by-side "yours vs default" view so you understand what changed. |

---

## 4. What ships in Phase A (now)

### Scope

A new page at `/library` opened via a top-nav button next to the Gallery button. The page has two tabs:

#### Tab 1 — Recipes

| Capability | Behavior |
|---|---|
| **List** | Card grid. Filter chips: *All* / *System* / *Yours*. Search by title, description, category. |
| **Detail panel** | Slide-in from right when you click a card. Shows: name, description, category, owner badge (system / yours), exposed inputs / outputs / parameters with types, list of internal prompts (extracted from text + llm-text nodes inside the recipe), small read-only canvas preview of the subgraph. |
| **Drop on canvas** | Same as the Add Node popover today. Spawns a composite node at the canvas center. |
| **Duplicate** | Creates a user-owned copy. For system recipes this is the only way to start customizing. For your own recipes it's a fork. |
| **Delete** | Only on user-owned recipes. Confirmation prompt. |
| **Copy any prompt** | Every internal prompt in the detail panel has a copy button. Plain-text format ready to paste into ChatGPT / Claude / anywhere. |

#### Tab 2 — Prompts

| Section | What it lists |
|---|---|
| **Assistant** | The base assistant prompt (`REASONER_INSTRUCTIONS`). Shown read-only with full text + a copy button + plain-English description of where it fires. |
| **Recipe-internal** | Every prompt extracted from every recipe's internal nodes. Each entry links to its recipe in Tab 1 so you can see it in context. |
| **Node defaults** | The default system prompt for nodes like LLM Text — the starter text new instances begin with. Read-only. |
| **Search** | One search box across all prompts in all sections. |

### Out of scope for Phase A

These are deliberately deferred so Phase A ships clean:

- ❌ Editing recipe content (Phase B)
- ❌ Versioning UI / "Update available" badges (Phase B)
- ❌ Personal prompt overrides (Phase C)
- ❌ Specialist recipes (Storyboard / Simple Scene / Timeline) (Phase D)
- ❌ Specialist assistant roles (Phase D)
- ❌ Assistant-as-prompt-co-author (Phase E)

### Database setup (Phase A)

Even though Phase A is read-only, the schema is set up correctly from day one so we never paint into a corner.

```sql
-- Already exists: public.cookbook_recipes (id, owner_id, name, description, ...)

-- Phase A migration adds:
alter table public.cookbook_recipes
  add column if not exists version int not null default 1;

create table if not exists public.cookbook_recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.cookbook_recipes on delete cascade,
  version int not null,
  subgraph jsonb not null,
  created_at timestamptz not null default now(),
  -- One row per (recipe_id, version) — no duplicates.
  unique (recipe_id, version)
);
```

Phase A doesn't activate this — it just creates the storage. Phase B writes a row to `cookbook_recipe_versions` every time a user saves an edit.

---

## 5. The phased plan

### Phase A — Read-only Library (this ship)

The full list of pieces:

1. **Foundation** — DB migration + prompts registry (`src/lib/prompts/registry.ts`) + prompt extractor (walks subgraphs to find internal prompts).
2. **Shell** — `/library` route + top-nav button next to Gallery + tabs container.
3. **Recipes tab read-only** — card grid + filter + search + slide-in detail + mini-canvas preview + extracted-prompts list + Drop / Duplicate / Delete actions.
4. **Prompts tab read-only** — Assistant + Recipe-internal + Node defaults sections, plain-English descriptions, copy buttons, cross-tab search.
5. **Polish** — tooltips, empty states, loading states, all seven UI principles.

### Phase B — Edit flow + versioning UI

When this ships:

- **Edit button** appears on user-owned recipes in the detail panel.
- Clicking Edit opens the recipe's subgraph as a sandbox graph in the canvas. The canvas chrome shows a "Editing recipe: *name*" badge.
- **Save** creates a new version: bumps `cookbook_recipes.version`, archives the previous subgraph to `cookbook_recipe_versions`, updates `cookbook_recipes.subgraph` to the new content.
- Composite nodes already on canvases that use this recipe show an **"Update available → v2"** badge with two options: *Update this instance* or *Update all instances of this recipe in this graph*.
- **System recipes** can't be edited directly. Clicking Edit on a system recipe silently creates a user copy ("Seedance Prompt Director (your copy)") and opens THAT for edit. The original system version is untouched.
- **Diff view** — when looking at a recipe's history, side-by-side comparison of any two versions.

### Phase C — Personal prompt overrides + assistant-as-co-author

| Capability | Behavior |
|---|---|
| **Per-user overrides** | A new `app_prompt_overrides` table keyed by `(user_id, prompt_key)`. Code reads from this with the bundled default as fallback. |
| **Edit assistant prompt in Library** | The Prompts tab Assistant section gets an Edit button. Clicking opens a side-by-side "yours vs default" editor. Save writes to `app_prompt_overrides`. Reset removes the row. |
| **Override badge in chat** | Small chip in the assistant chat header: "using custom General prompt" — so you always know if you're running a modified version. |
| **`read_my_system_prompt` tool** | Adds a tool the assistant can call to read its own current prompt text. Asking *"what's your system prompt?"* returns the actual current text — no more black box. |
| **Assistant suggests, doesn't apply** | Asking *"make yourself smarter"* returns a proposed diff + reasoning. UI shows the diff. User clicks Apply. The assistant never silently writes to its own prompt. |

This is genuinely powerful — and risk-managed: human in the loop on every change.

### Phase D — Specialist recipes + assistant roles

Three new specialist recipes (mirror the Seedance Prompt Director architecture):

1. **Storyboard Director** — produces an image-gen prompt for an N-panel storyboard with the 10 continuity rules baked in.
2. **Simple Scene Prompter** — Style + Action + Camera, single video shot.
3. **Timeline Director** — 5 setup blocks + N timeline slots for multi-beat 15-second scenes.

Plus extending the existing Seedance Prompt Director with a 6th template (Animation / Timed Segments) for multi-beat Seedance scenes.

In parallel, an `assistantRole` setting on the assistant chat. Role chip next to the model selector. Roles available:

- **General** (default) — current behavior.
- **Prompt Engineer** — universal grammar from Structure 1 + Structure 2 templates.
- **Storyboard Director** — 10 continuity rules, panel-by-panel discipline.
- **Timeline Director** — 5 setup blocks + slot-by-slot discipline + 15-second budget.
- **Recipe Architect** — knows the codebase's recipe shape; proposes new recipes given a workflow.

How roles work technically: each role's system prompt is a *fragment* layered onto the base assistant prompt. Same caching, same tools, same parallel dispatch — only the discipline-overlay changes per role.

### Phase E — Orchestration

The General role learns to:

1. **Recommend recipes** when intent matches: *"this sounds like a Timeline scene — should I drop the Timeline Director recipe with these pre-filled fields?"*
2. **Hand off to specialist roles** for conversational work: *"Switching to Storyboard Director role to walk you through panels one at a time."*
3. **Chain specialists** for multi-step work: *"Make me a 15s product launch"* → General orchestrates Storyboard Director (plan the panels) → Continuity Architect (lock the rules) → Seedance Director (one shot per panel).

---

## 6. Concept glossary

Use these terms consistently. Copy this section verbatim into any other LLM and they'll understand the system.

### Recipe

A saved subgraph. Stored as one row in the `cookbook_recipes` table. Acts as a single composite node when dropped on the canvas. Has:

- **Inputs / outputs** — exposed handles you can wire to.
- **Parameters** — exposed config knobs you can tweak (template selector, model picker, temperature, etc.).
- **Internal nodes** — the actual workflow inside (Text nodes, LLM Text nodes, Array, List, Concat, etc.).
- **Internal prompts** — system prompts contained within the internal nodes.

Two flavors:
- **System recipe** (`owner_id IS NULL`) — built into the app, visible to everyone, can't be edited but can be duplicated.
- **User recipe** (`owner_id = you`) — yours; visible only to you; editable.

### Prompt

A block of text instructions sent to an LLM. The Library tracks four kinds:

| Kind | Where it lives | Who edits it |
|---|---|---|
| **Assistant base** | `REASONER_INSTRUCTIONS` in code | Phase C: per-user overrides allowed |
| **Specialist role** | Code, layered on top of base when role is active | Phase C: per-user overrides allowed |
| **Recipe internal** | Inside a recipe's internal nodes (text + llm-text systemPrompt) | Whoever owns the recipe (system = nobody, user = the user) |
| **Node default** | Hardcoded in the node spec | Code only (read-only in Library) |

### Role

A specialist persona the assistant can adopt. Each role is a focused system prompt overlaid on the assistant's base prompt. Roles ship in Phase D. Today there's only one implicit role: General.

### Version

When a recipe is edited, a new version is created. The old version is preserved in `cookbook_recipe_versions`. Composite nodes already on canvases keep using the version they were created with — until the user opts to upgrade.

| Status | What it means |
|---|---|
| `version: 1` | Original or unedited |
| `version: N (N > 1)` | Edited N-1 times. Each prior version exists in `cookbook_recipe_versions` as history. |
| Composite node on canvas tagged with `recipeVersion: 2` | Was created when the recipe was at v2. If the recipe is now at v3, the composite shows an "Update available" badge. |

### Override

A user's personal customization of a code-defined prompt (assistant base, specialist role). Stored in `app_prompt_overrides`. Doesn't change the prompt for anyone else. Always reversible by clicking "Restore default."

### System prompt vs user prompt

- **System prompt** — instructions the LLM receives BEFORE the user's message. Sets behavior, persona, rules.
- **User prompt** — what the user actually types. The Library shows system prompts; user prompts aren't stored anywhere persistent.

---

## 7. Future ideas (parking lot)

Not committed to building these yet, but they're worth keeping in mind as the Library matures:

- **Recipe import / export** — JSON file. Drop a `.recipe.json` into the Library to install someone else's recipe.
- **Recipe marketplace** — community recipes shared through a public collection. Requires moderation policy.
- **Per-team libraries** — recipes scoped to a workspace/team rather than a single user.
- **Recipe usage analytics** — for system recipes, telemetry on how often they're dropped + which params get tweaked. Helps prioritize which to evolve.
- **Prompt linting** — automated checks on user-edited prompts to flag obvious issues (no clear instruction, contradictory rules, broken variable references).
- **"Compare two recipes"** — side-by-side view of two recipes' subgraphs and prompts. Useful when deciding whether to fork or extend.
- **Recipe discovery via assistant** — the assistant proposes a recipe to drop based on the user's stated goal. ("Make me a 15s product video" → "I'd suggest the Timeline Director recipe.")
- **Versioning history viewer** — full timeline of edits to a recipe, with diff view between any two versions, restore-to-version action.
- **Snapshot-based exports** — "freeze this recipe as v2.3.1, export as a self-contained file."

---

## 8. How to extend the Library (developer guide)

When you add a new feature that introduces a prompt or a recipe, two steps make it visible in the Library:

### Adding a new prompt that's defined in code

1. Add an entry to `src/lib/prompts/registry.ts`:
   ```ts
   {
     key: "my-feature.system-prompt",
     title: "My Feature — system prompt",
     description: "Plain-English description of when this prompt fires.",
     section: "assistant" | "recipe-internal" | "node-default",
     content: MY_FEATURE_PROMPT_CONST,
   }
   ```
2. Done. The Prompts tab picks it up automatically.

### Adding a new system recipe

1. Write the SQL migration as usual (see `supabase/migrations/20260601_seedance_prompt_director_recipe.sql` for the canonical pattern).
2. Set `version` to 1 in the migration (the column has a default, so this is implicit).
3. The Recipes tab picks it up automatically — recipes are listed by reading the table.

### Adding a new code-defined node default prompt

1. Declare the prompt const at module scope in your node file.
2. Add a registry entry pointing at it (same shape as above, `section: "node-default"`).

---

## 9. Status (live)

| Phase | Status | Shipped on |
|---|---|---|
| A — Read-only Library | 🔨 In progress | — |
| B — Edit flow + versioning | 📋 Planned | — |
| C — Personal prompt overrides + assistant-as-co-author | 📋 Planned | — |
| D — Specialist recipes + assistant roles | 📋 Planned | — |
| E — Orchestration | 📋 Planned | — |

This section gets updated whenever a phase ships. Always keep it accurate.
