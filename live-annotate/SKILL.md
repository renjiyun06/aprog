---
name: live-annotate
version: 0.2.0
kind: library
description: |
  Browser-side annotation surface + draft/commit pipeline. Hosts a Bun preview
  server that serves an output directory, injects an overlay, stores comment
  drafts server-side, and atomically commits batches to feedback-inbox +
  input.md. Defines how the calling application drains the inbox.
---

# live-annotate

> Required reading order:
> 1. `state` skill — defines `${EXEC}`, `meta.yml`, `input.md`, `input_cursor`.
> 2. The application skill that invokes this one (`design`, `shape`, …) — owns
>    the canonical source of truth that each annotation resolves against.
>
> This skill provides the SHARED browser surface + commit pipeline. The
> application defines what a "source-of-truth file" is for its domain.

---

## Spec

```yaml
name: live-annotate
version: 0.2.0
kind: library

depends_on:
  - skill: state
    note: |
      live-annotate writes to ${EXEC}/input.md, ${EXEC}/state/feedback-draft,
      ${EXEC}/state/feedback-inbox, ${EXEC}/state/feedback-resolved. The state
      skill defines those paths and the input_cursor / resume contract.

# ---------------------------------------------------------------------------
# Paths. live-annotate is a SHARED library skill — application skills
# reach its scripts via a path variable they declare (e.g. design's
# paths.LIVE_ANNOTATE, shape's paths.LIVE_ANNOTATE).
# ---------------------------------------------------------------------------
paths:
  SKILL: <directory holding this SKILL.md>             # aprog/live-annotate/
  EXEC:  ~/.aprog/<execution-id>/                      # supplied by the calling application

# ---------------------------------------------------------------------------
# Server. Single binary, Bun. Serves <output-dir>, injects preview-overlay.js
# into every HTML response, manages draft + commit. Always bind 0.0.0.0 so
# other devices on the LAN can view the same preview.
# ---------------------------------------------------------------------------
server:
  cmd: ${SKILL}/scripts/preview-server <output-dir> <exec-dir> [--port=N]
  bind: 0.0.0.0
  forbidden_fallbacks:
    - "python3 -m http.server"
  why: |
    Three things a static server cannot do:

    1. inject the overlay JS that turns any rendered HTML into an
       annotatable surface
    2. hold pending drafts server-side, so they survive tab close and sync
       across browsers / tabs / collaborators (refresh = sync)
    3. atomically commit a batch — file rename + drain into inbox + input.md
       append in one critical section, safe under concurrent commits

    The first time an application picks a generic static server "to ship
    something quick", every later iteration loses one of these affordances
    and reinvents them ad hoc. The mandate is the cheapest hedge against
    that drift.

# ---------------------------------------------------------------------------
# Wire protocol — HTTP endpoints. Every application talks to the same server.
# ---------------------------------------------------------------------------
endpoints:
  - { method: GET,    path: /draft,              returns: "{ feedback: Comment[] }" }
  - { method: POST,   path: /draft/feedback,     body: "{ url, selector, comment }", returns: "{ ok, id, count }" }
  - { method: DELETE, path: /draft/feedback/:id, returns: "{ ok, count }" }
  - { method: DELETE, path: /draft,              returns: "{ ok }" }
  - { method: POST,   path: /commit,             returns: "{ ok, accepted, input_id }" }

# ---------------------------------------------------------------------------
# Flow — two stages. The draft is the user's editable staging area; only the
# inbox is processed by the agent.
# ---------------------------------------------------------------------------
flow:
  draft:
    storage: ${EXEC}/state/feedback-draft          # JSONL, mutable
    semantics: |
      Each POST /draft/feedback appends one Comment line:
        { id, ts, url, selector, comment }
      DELETE rewrites the file without the removed entry. Drafts are
      visible to every browser that hits the server (refresh-based sync).

      The agent MAY READ feedback-draft (it's just another state KV), but
      MUST NOT process drafts — only the inbox. The draft can churn many
      times before a commit, and an agent that drains it prematurely will
      consume comments the user is still editing.

  commit:
    storage:
      - ${EXEC}/state/feedback-inbox               # JSONL, append-only, agent-facing
      - ${EXEC}/input.md                           # new input-NNN entry
    semantics: |
      POST /commit atomically:

        1. rename feedback-draft → ${EXEC}/state/feedback-draft.committing-<ts>
           (any concurrent POST /draft/feedback writes to a fresh draft;
            the rename is the critical section)
        2. drain the staged file into feedback-inbox (append, no id —
           inbox is agent-facing; ids are draft-local)
        3. append a new input-NNN entry to input.md with a generic title
           ("Live annotations (N)") and a pointer body that names the
           live-annotate skill's drain_procedure
        4. unlink the staged file

      The rename-then-drain pattern is what makes commit safe under
      concurrent browsers. A naive read-truncate-write loses any POST
      that lands between the read and the truncate.

# ---------------------------------------------------------------------------
# Inbox schema — source of truth for the agent.
# ---------------------------------------------------------------------------
inbox_schema:
  fields:
    - { name: ts,       type: "ISO 8601 UTC",   purpose: "when the overlay posted the batch (per-comment, not per-batch)" }
    - { name: url,      type: "relative URL",   purpose: "page being viewed; locates the rendered artifact" }
    - { name: selector, type: "CSS path",       purpose: "computed by overlay; resolve to the DOM element" }
    - { name: comment,  type: "string",         purpose: "free-form user intent" }
  example: |
    {
      "ts": "2026-05-18T02:09:35Z",
      "url": "/index.html",
      "selector": "main > section:nth-of-type(2) > h2",
      "comment": "split this headline into two lines"
    }

# ---------------------------------------------------------------------------
# Drain procedure. Run when:
#   - a new input-NNN titled "Live annotations" appears (the preview-server
#     posts this title on every commit),
#   - OR the user asks to "process my comments" / "apply the feedback I left".
# ---------------------------------------------------------------------------
drain_procedure: |
  1. Read every line of ${EXEC}/state/feedback-inbox.

  2. For each entry, locate the source-of-truth file. This is where
     APPLICATIONS differ — the (url, selector) pair from the overlay tells
     you WHERE in the rendered view the comment landed; the application
     defines what file owns that view:

       design   — the source IS the HTML/CSS/JS file under output-dir.
                  Edit the file directly; preview-server auto-serves the
                  next refresh.
       shape    — the source is a state/ file (vision / modules /
                  processes/<module-id> / details/<process-id>.md).
                  The rendered HTML at output-dir is a VIEW — DO NOT edit
                  it directly. Edit the state, then re-run scripts/render
                  to refresh the view.
       other    — define your own resolver in the application's SKILL.md.
                  The (url, selector) pair is enough to locate the node;
                  the application maps that to its canonical source.

  3. Interpret the comment in light of the application's working memory:

       design   — active brand (selected-design-system → DESIGN.md),
                  opted-in craft rules, brand-brief, design-decisions
       shape    — vision, modules table, processes for the affected
                  module, coverage classification, decisions log
       other    — application-specific

  4. Apply the edit to the source file.

  5. Archive the processed entry:
     - Append to ${EXEC}/state/feedback-resolved with two added fields:
         resolved_at  (ISO 8601 UTC, when applied)
         applied_to   (the file path edited, relative to output-dir or
                       state/ depending on application)
     - Remove the consumed line from ${EXEC}/state/feedback-inbox.
       (Removing in place — feedback-inbox is normally append-only, but
        the agent OWNS the consume side. Re-write the file without the
        consumed lines.)

  6. Advance ${EXEC}/meta.yml.input_cursor past the input-NNN entry the
     preview-server posted. That is the aprog-level "consumed" signal.

  7. Surface to the user:
     "Processed N annotation(s); refresh the browser to see the changes."

# ---------------------------------------------------------------------------
# Idempotency. At-least-once delivery is the protocol's guarantee; per-edit
# idempotency is this skill's responsibility.
# ---------------------------------------------------------------------------
idempotency: |
  If the agent died after applying an edit but before archiving, the
  entry is still in feedback-inbox on resume and would be reprocessed.
  Two mitigations:

  - Before applying, check whether the file already reflects the
    requested change (text already split, padding already shrunk, the
    state KV already matches). Skip if so.
  - Log "applied annotation X on selector Y" to the application's
    decision log (design.state/design-decisions, shape.state/decisions).
    On retry, scan the log first.

  Do NOT rely on the inbox being short — a paused execution may
  accumulate many commits before drain.

# ---------------------------------------------------------------------------
# Failure modes
# ---------------------------------------------------------------------------
failure_modes:
  - mode: selector does not resolve
    cause: the rendered source was regenerated between user click and agent drain
    response: |
      Try a fuzzy match by tag + nearby text content. If no clear
      match, log to the decision log and SKIP the entry — never
      invent edits to make a missing target whole.
  - mode: comment is ambiguous ("make this nicer")
    cause: free-form text without enough specificity
    response: |
      If the application's brand / invariants give a clear direction,
      apply that and note the choice in the decision log. Otherwise,
      ASK THE USER a clarifying question and LEAVE THE ENTRY IN THE
      INBOX (cursor not advanced — it will be retried after the user
      answers).
  - mode: multiple annotations conflict on the same selector
    cause: two opposite-intent comments in the same commit
    response: |
      Process in `ts` order; the latest wins. Log the conflict in
      the decision log so a reviewer can see the displaced comment.

# ---------------------------------------------------------------------------
# Overlay UX (informational — lives in scripts/preview-overlay.js)
# ---------------------------------------------------------------------------
overlay_ux:
  hide_show: |
    Ctrl + ` toggles the entire floating UI. State persists in localStorage,
    so demo / screenshot sessions can hide the overlay across pages with one
    keystroke. Inside an iframe (window.self !== window.top), the overlay
    skips itself entirely — nested embedded pages shouldn't show another
    overlay.
  dom_walk: |
    Arrow Up / Down walk the DOM tree relative to the chip-locked element
    (parent / first child). Doesn't fire when focus is in an input,
    textarea, or contenteditable. Lets the user select a container element
    that's hard to click directly because a child intercepts the cursor.
  draft_visibility: |
    Hovered elements that already have pending drafts show a small badge
    ("💬 N"). Clicking opens a modal that lists existing drafts (each with
    a × delete button) and a textarea for adding a new one. Drafts on
    other browsers become visible after a refresh — the overlay reads
    GET /draft on load.
```
