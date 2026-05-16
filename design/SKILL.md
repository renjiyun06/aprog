---
name: design
version: 0.1.0
kind: application
description: |
  Designs websites, mobile prototypes, hi-fi mockups, slide decks,
  single-page artifacts, and media outputs (image / video / audio).
---

# design

Designs websites, mobile prototypes, hi-fi mockups, slide decks, single-page artifacts, and media outputs (image / video / audio).

> **Required first step**: load the `state` skill before proceeding. This skill is layered on top of the state protocol; every reference below to `${EXEC}`, `meta.yml`, `input.md`, `state/`, `input_cursor`, and "resume" assumes you've read it.

---

## Paths

This document uses two root variables to refer to files unambiguously. Every file path in this document is written with one of these prefixes.

- **`${EXEC}`** = `~/.aprog/<execution-id>/` — the current execution's directory. Holds `meta.yml`, `input.md`, and the `state/` KV namespace.
- **`${SKILL}`** = the directory holding this `SKILL.md` — the design skill's resource library. Holds `resources/` and `scripts/`.

---

## Output

All deliverables are written to a single directory chosen by the user — whatever the shape (a single HTML file, a multi-page site, a deck, generated media), everything goes in that one directory.

**Artifacts MUST be served via `${SKILL}/scripts/preview-server`** so the user can preview them in a browser AND drop in-page feedback back to the agent. The preview-server does three things: serves files from the output directory, injects an overlay JS that lets the user click-to-annotate or click-to-tweak page elements, and accepts the resulting batches at `POST /feedback` / `POST /tweak` — writing each to `${EXEC}/state/feedback-inbox` or `${EXEC}/state/tweak-inbox` (JSONL) and appending a corresponding `input-NNN` entry to `${EXEC}/input.md` so the agent picks it up on its next turn. Plain `python3 -m http.server` is **not** sufficient — it cannot inject the overlay or receive POST. See the `live-annotate` and `live-tweak` functional skills for inbox processing procedures.

---

## Workflow (FSM)

Four phases. The current phase MUST be written to `${EXEC}/meta.yml`'s `phase` field. Resume reads `${EXEC}/meta.yml.phase` + `${EXEC}/state/` to know where to pick up.

### Phase: `discovery`

**Goal**: build a substantive brief — the user's brand, intent, audience, and the kind of artifact they want.

**Behavior**:
- Ask focused open questions **one at a time**. Subjects worth covering: project kind, audience, brand voice, references / inspirations, constraints, success criteria.
- Each user reply either narrows the design space or surfaces a new unanswered axis.
- Honor the discovery principles below ("Discovery philosophy").

**State writes**:
- `brand-brief` — accumulating Markdown summary of brand, intent, audience, references, constraints
- `discovery-notes` — running scratch of observations and open axes

**Transition to `selecting`** when `brand-brief` covers kind, audience, brand voice, and at least one reference, AND the user's recent answers no longer introduce new uncertainty.

### Phase: `selecting`

**Goal**: lock in the active design template, design system, opted-in craft rules, and `output-dir`.

> **Two categories of resources, only one is selected at project level.**
> - **Design templates** (`${SKILL}/resources/design-templates/`) define the **shape** of the deliverable — prototype, deck, single-page artifact, image/video/audio template, etc. A project picks **exactly one** at `selecting` time.
> - **Functional skills** (`${SKILL}/resources/skills/`) are **on-demand utilities** invoked mid-task (brief capture, asset packaging, screenshot, image enhancement, etc.). Never selected at project level. Their **headers are loaded at `selecting` entry alongside the other indices**; only their **bodies are on-demand** — Read at the moment of invocation, never preloaded.

**Behavior**:
- **Load the full header index** for **all four resource categories** via the list script. The script extracts each entry's frontmatter / markdown header (name + description) — file bodies are NOT pulled in, so the full catalog fits in context:
  - `${SKILL}/scripts/list-resources design-templates` — every shape (proposed in this phase)
  - `${SKILL}/scripts/list-resources design-systems` — every brand system (proposed in this phase)
  - `${SKILL}/scripts/list-resources craft` — every craft rule (proposed in this phase)
  - `${SKILL}/scripts/list-resources skills` — every functional skill (not proposed here; kept in working memory for on-demand invocation later in `designing`)
- **Consume each command's FULL output.** Do NOT pipe through `head` / `tail` / `grep`, do NOT truncate. An incomplete index means later candidate matching (selecting) and on-demand utility matching (designing) will silently miss entries.
- With the full indices in context, narrow design-templates / design-systems / craft each to 2–3 candidates that best match the brief. Only then Read the full SKILL.md / DESIGN.md / craft file for those you propose.
- Propose 2–3 candidate **design templates** with one-sentence rationale each. User picks or accepts a recommendation.
- Propose 2–3 candidate **design systems** matching the brand voice (one-line tokens summary each). User picks.
- Propose 2–4 **craft rules** to opt into (typography, color, accessibility, anti-AI-slop, etc.).
- Ask the user **where to write artifacts**. The user must give a directory path (relative or absolute). If they have no preference, suggest a path and ask for confirmation.

**State writes** (KV keys under `${EXEC}/state/`):
- `selected-template` — single design-template name (matches a folder under `${SKILL}/resources/design-templates/`); **required**
- `selected-design-system` — single design-system name (matches a folder under `${SKILL}/resources/design-systems/`); **required**
- `selected-craft` — newline-separated list of craft rule names (filenames under `${SKILL}/resources/craft/` without extension)
- `output-dir` — absolute path of the user's chosen workspace (created if it doesn't exist, with user authorization)

> **Why singular for template / design-system, list for craft?** Each of the first two defines a coherent commitment: one shape, one brand voice. A project that needs two shapes (e.g., a deck AND a separate mobile prototype) should be split into two executions. Craft rules are universal hygiene and naturally combine.

**Transition to `designing`** when all required KVs are set and `output-dir` exists on disk.

### Phase: `designing`

**Goal**: produce and iterate artifacts.

**On entry, load working knowledge from two sources** (later layers override earlier on conflict, except where noted):

**A. From the execution (`${EXEC}/`)** — what the user has told us so far:
1. `${EXEC}/state/brand-brief` and `${EXEC}/state/design-decisions` — current user brief

**B. From the skill's resource library (`${SKILL}/`)** — what to build with:
2. `${SKILL}/resources/design-systems/<selected-design-system>/DESIGN.md` — brand prose (**required**; every brand has this)
3. `${SKILL}/resources/design-systems/<selected-design-system>/tokens.css` — `:root` CSS variables (**optional**; only a couple of brands ship this — if missing, derive tokens from DESIGN.md prose)
4. `${SKILL}/resources/design-systems/<selected-design-system>/components.html` — components fixture (**optional**; same as tokens.css — only a couple of brands ship it)
5. Each selected craft rule from `${SKILL}/resources/craft/<name>.md`
6. `${SKILL}/resources/design-templates/<selected-template>/SKILL.md` — the active shape (workflow + scaffold)
7. `${SKILL}/resources/design-templates/<selected-template>/references/*.md` — layouts, components, checklist, themes (if present)

**C. Indexes already loaded (from `selecting`)**:
8. **Functional skill index** — loaded in `selecting` via `${SKILL}/scripts/list-resources skills`. Kept in working memory throughout `designing` so on-demand invocation can match against available utilities. Read the full `${SKILL}/resources/skills/<name>/SKILL.md` only at the moment of invocation. On resume, re-run the script to repopulate the index (see Resume behavior).

**Conflict resolution**:
- **Brand > craft** on visual tokens (specific brand voice overrides generic craft hygiene)
- **User input (latest in `${EXEC}/input.md`) > everything**

**Behavior**:
- **Start the preview-server** if not already running:
  `${SKILL}/scripts/preview-server <output-dir> ${EXEC}` (pass the path stored in `${EXEC}/state/output-dir` as `<output-dir>`; the server auto-picks a free port and prints its URL). Surface the URL to the user.
- Generate the first artifact set. Write files to that output directory. Update `${EXEC}/state/produced-files` to reflect what now exists.
- On new input (the next `input-NNN` in `${EXEC}/input.md`): determine what changed. Regenerate, add, replace, or **remove** files as needed. Keep `${EXEC}/state/produced-files` in sync with the actual contents of the output directory. Advance `${EXEC}/meta.yml.input_cursor` only after the request is fully reflected.
- **On a delete request**: remove the file(s) from the output directory, rewrite `${EXEC}/state/produced-files` to drop the removed entries, and log the deletion + reason in `${EXEC}/state/design-decisions`.
- **Invoking a functional skill on demand**: when the task calls for a utility (asset packager, image enhancer, brief capture, screenshot, etc.), match against the functional skill index loaded in **group C** above (step 8). Read the full `${SKILL}/resources/skills/<name>/SKILL.md` only at the moment of invocation; do not preload them all.

**State writes** (KV keys under `${EXEC}/state/`):
- `target-screens` — list of screens / artifacts to produce (one per line)
- `produced-files` — **current** list of files in the output directory (Markdown table: path + status). **Rewritten** by the program when files are added, replaced, or removed — not append-only.
- `current-revision` — short identifier of latest iteration round
- `design-decisions` — accumulating Markdown log of major choices and their rationale (including deletions)

**Stays in `designing`** through any number of iteration rounds.

**Transition to `done`** when the user explicitly signals completion.

### Phase: `done`

**Goal**: clean handoff.

**Behavior**:
- Write a `summary.md` to the output directory listing what's produced, key design decisions, and how to extend.
- Set `${EXEC}/meta.yml.status: completed`.
- If a new input arrives after `done`, transition back to `designing` and continue.

---

## State KV map

All keys are files under `${EXEC}/state/`.

| Key | Format | Written in | Meaning |
|---|---|---|---|
| `brand-brief` | Markdown | discovery | accumulating user brand / intent / audience |
| `discovery-notes` | Markdown | discovery | scratch log of open axes / observations |
| `selected-template` | plain text | selecting | active design-template name (required, the shape) |
| `selected-design-system` | plain text | selecting | active design-system name (required, the brand voice) |
| `selected-craft` | plain text, newline list | selecting | opted-in craft rules |
| `output-dir` | plain text, absolute path | selecting | where artifacts go |
| `target-screens` | plain text, newline list | designing | screens / artifacts to produce |
| `produced-files` | Markdown table | designing | current list of files in the output directory (path + status); rewritten as files are added / replaced / removed |
| `current-revision` | plain text | designing | latest iteration identifier |
| `design-decisions` | Markdown | designing | major choices + rationale |

Subdirectories under `${EXEC}/state/` are reserved for future namespacing; not used in v0.1.0.

---

## Discovery philosophy

Discovery is not a form fill. The principles:

- **One question at a time.** Multi-part questions overwhelm and produce shallow answers.
- **Open before closed.** Ask "what feeling should visitors leave with?" before "blue or green?"
- **Reference over description.** "Show me a site you like" beats "describe your aesthetic."
- **Constraints surface uncertainty.** Ask "what won't work here?" — answers reveal the design space's edges faster than asking what will.
- **No premature commitment.** Don't suggest skills or design systems until the brief is substantial.
- **Return to discovery anytime.** Even mid-`designing`, surfacing a missing axis beats charging forward on assumption.

---

## Resume behavior

On resume:

1. Read `${EXEC}/meta.yml` — note `phase`, `input_cursor`, `status`.
2. Read every input section **after** `input_cursor` in `${EXEC}/input.md` — those are unprocessed.
3. Read state keys relevant to the current `phase` from `${EXEC}/state/` (see State KV map).
4. **If `phase == designing`**, reloading state KVs is **not enough**. The skill's resource library is your working memory for generation; without it, the next artifact you produce will silently drift from brand / craft / template. You MUST re-run the full `designing` entry load — all three groups A / B / C of its composition order:

   a. **Group A — execution state** (`${EXEC}/state/brand-brief`, `${EXEC}/state/design-decisions`). Already covered by step 3 above, but re-confirm.

   b. **Group B — resource library (THIS IS THE MOST OMITTED STEP)**. Read each of the following from `${SKILL}/`:
      - `${SKILL}/resources/design-systems/<selected-design-system>/DESIGN.md` — **required**
      - `${SKILL}/resources/design-systems/<selected-design-system>/tokens.css` — if present
      - `${SKILL}/resources/design-systems/<selected-design-system>/components.html` — if present
      - `${SKILL}/resources/craft/<name>.md` for **every** name in `${EXEC}/state/selected-craft`
      - `${SKILL}/resources/design-templates/<selected-template>/SKILL.md` — **required**
      - `${SKILL}/resources/design-templates/<selected-template>/references/*.md` — all files if the directory exists

      Without these in context, the agent cannot honor the brand voice, craft rules, or template scaffold — generation will revert to generic defaults. **Don't skip a file because "I already know this brand"** — you don't; the previous agent's memory is gone.

   c. **Group C — functional skill index**. Re-run `${SKILL}/scripts/list-resources skills` and consume its **FULL** output (no `head` / `tail` / `grep` / truncation). Without the full index, on-demand utility matching silently misses entries.

   d. **Restart the preview-server** (`${SKILL}/scripts/preview-server <output-dir> ${EXEC}`). The previous server is gone; the user has no live preview, and any new in-browser annotations / tweaks have nowhere to land. Surface the new URL.

   e. **Reconcile `${EXEC}/state/produced-files`** with the actual contents of the output directory. Between sessions the user may have manually added, edited, or deleted files. If reality has drifted, rewrite `${EXEC}/state/produced-files` to match what's on disk before processing any new input.

   f. **Re-establish phase invariants**: confirm `${EXEC}/state/selected-template`, `${EXEC}/state/selected-design-system`, and `${EXEC}/state/output-dir` are all set and valid (the output directory still exists; the named template / design-system still exist under `${SKILL}/resources/`). If any is missing or broken, surface the issue to the user before continuing — do not silently proceed.
5. Take action per the current phase's rules.
6. Advance `${EXEC}/meta.yml.input_cursor` only after fully reflecting each processed input into `${EXEC}/state/` and/or the output directory.

Agent conversation history is **not saved**. The recoverable surface is exactly: `${EXEC}/meta.yml` + `${EXEC}/input.md` + `${EXEC}/state/`. Any prior agent transcript is gone; do not assume continuity with it.
