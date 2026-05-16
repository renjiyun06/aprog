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

Uses the **state** skill for execution state.

---

## Paths

This document uses two root variables to refer to files unambiguously. Every file path in this document is written with one of these prefixes.

- **`${EXEC}`** = `~/.aprog/<execution-id>/` — the current execution's directory. Holds `meta.yml`, `input.md`, and the `state/` KV namespace.
- **`${SKILL}`** = the directory holding this `SKILL.md` — the design skill's resource library. Holds `resources/` and `scripts/`.

---

## Output

All deliverables are written to a single directory chosen by the user — whatever the shape (a single HTML file, a multi-page site, a deck, generated media), everything goes in that one directory.

**Artifacts MUST be served via a local HTTP server** (e.g., `python3 -m http.server <port>` rooted at the output directory, or any equivalent) so the user can preview them in a browser. The skill is responsible for starting this server in `designing` and surfacing its URL to the user.

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
> - **Functional skills** (`${SKILL}/resources/skills/`) are **on-demand utilities** invoked mid-task (brief capture, asset packaging, screenshot, image enhancement, etc.). Never selected at project level. Their **headers (name + description) are loaded at `designing` entry** via `${SKILL}/scripts/list-resources skills` so the agent knows what's available; their **bodies are Read only at the moment of invocation**, never preloaded. See `designing`.

**Behavior**:
- **Load the full header index** for all three resource categories via the list script. The script extracts each entry's frontmatter / markdown header (name + description) — file bodies are NOT pulled in, so the full catalog fits in context:
  - `${SKILL}/scripts/list-resources design-templates` — header info for every shape
  - `${SKILL}/scripts/list-resources design-systems` — header info for every brand system
  - `${SKILL}/scripts/list-resources craft` — header info for every craft rule
- With the full header index in context, narrow each category to 2–3 candidates that best match the brief. Only then Read the full SKILL.md / DESIGN.md / craft file for those you propose.
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

**C. Indexes (header info only, body Read on demand later)**:
8. **Functional skill index** via `${SKILL}/scripts/list-resources skills` — keep in working memory so on-demand invocation can match against available utilities. Read individual `${SKILL}/resources/skills/<name>/SKILL.md` only at the moment of invocation.

**Conflict resolution**:
- **Brand > craft** on visual tokens (specific brand voice overrides generic craft hygiene)
- **User input (latest in `${EXEC}/input.md`) > everything**

**Behavior**:
- **Start a local HTTP server** rooted at the directory in `${EXEC}/state/output-dir` if not already running, and surface its URL to the user.
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
4. **If `phase == designing`**, reloading docs is not enough — also:

   a. **Re-run the `designing` entry load** — all three groups A/B/C of its composition order, including the functional skill index from `${SKILL}/scripts/list-resources skills`. Without the index, on-demand utility matching has nothing to match against.

   b. **Restart the local HTTP server** rooted at the directory named in `${EXEC}/state/output-dir`. The previous server is gone; the user has no live preview until a new one is up. Pick any free port, surface the new URL.

   c. **Reconcile `${EXEC}/state/produced-files`** with the actual contents of the output directory. Between sessions the user may have manually added, edited, or deleted files. If reality has drifted, rewrite `${EXEC}/state/produced-files` to match what's on disk before processing any new input.

   d. **Re-establish phase invariants**: confirm `${EXEC}/state/selected-template`, `${EXEC}/state/selected-design-system`, and `${EXEC}/state/output-dir` are all set and valid (the output directory still exists; the named template / design-system still exist under `${SKILL}/resources/`). If any is missing or broken, surface the issue to the user before continuing — do not silently proceed.
5. Take action per the current phase's rules.
6. Advance `${EXEC}/meta.yml.input_cursor` only after fully reflecting each processed input into `${EXEC}/state/` and/or the output directory.

Agent conversation history is **not saved**. The recoverable surface is exactly: `${EXEC}/meta.yml` + `${EXEC}/input.md` + `${EXEC}/state/`. Any prior agent transcript is gone; do not assume continuity with it.
