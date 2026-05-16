---
name: live-annotate
version: 0.1.0
kind: functional
description: |
  Process free-form, element-anchored annotations the user has dropped on the
  live preview. Each annotation pairs a CSS selector with a comment; this
  skill walks the inbox, applies each comment as an edit to the matching
  source file, and archives the processed entry.
---

# live-annotate

When the preview-server receives annotation batches from the in-browser overlay, it writes one JSONL record per annotation to `${EXEC}/state/feedback-inbox` and appends a new entry to `${EXEC}/input.md`. This skill defines how the agent **drains** that inbox.

Invoke this skill on demand when:

- A new `input-NNN` entry references **"Live annotations"** (the preview-server emits this title).
- The user mentions "process my comments", "apply the feedback I left", or similar in chat.

---

## Inbox schema

`${EXEC}/state/feedback-inbox` is JSONL (one object per line, append-only by the server):

```json
{
  "ts": "2026-05-16T13:45:10Z",
  "url": "/index.html",
  "selector": "main > section:nth-of-type(2) > h2",
  "comment": "split this headline into two lines"
}
```

- `ts` — when the overlay POSTed the batch (UTC, second precision).
- `url` — the page the user was viewing (relative to `output-dir`). Use this to locate the source file.
- `selector` — CSS path computed by the overlay. Run `document.querySelector(selector)` mentally against the source HTML to find the element.
- `comment` — free text. May ask for content, layout, copy, semantics, anything.

---

## Procedure

1. **Read** every line of `${EXEC}/state/feedback-inbox`. Each line is one pending annotation.

2. **For each entry**, locate the source file:
   - Output-dir is in `${EXEC}/state/output-dir`. The target file is `<output-dir>/<url>` (strip leading `/` and resolve to `index.html` if `url` ends with `/`).
   - Open the file. Find the element matching `selector`. If the selector is ambiguous (very rare given the overlay's path strategy) or the element no longer exists, log the issue in `${EXEC}/state/design-decisions` and continue with a best-effort fuzzy match (look for closest tag with matching text content).

3. **Interpret the comment** in light of:
   - The active brand (`${EXEC}/state/selected-design-system` → load the design system DESIGN.md if not already in working memory).
   - The opted-in craft rules (`${EXEC}/state/selected-craft`).
   - The brief (`${EXEC}/state/brand-brief` and `${EXEC}/state/design-decisions`).

4. **Apply the edit** to the source file. Brand and craft rules govern HOW (token usage, hierarchy); the comment defines WHAT. After the edit, the preview-server will auto-serve the new file on next refresh — no rebuild needed.

5. **Archive** the processed entry:
   - Append the entry to `${EXEC}/state/feedback-resolved` (JSONL), with two added fields:
     - `resolved_at` (current UTC timestamp)
     - `applied_to` (the source file path edited, relative to output-dir)
   - **Remove** the consumed line from `${EXEC}/state/feedback-inbox` so it does not get reprocessed.

6. After all entries are drained, **advance `${EXEC}/meta.yml.input_cursor`** past the `input-NNN` entry the preview-server posted (the cursor advance is the aprog-level "consumed" signal).

7. **Surface a short summary** to the user: `Processed N annotation(s); preview still live at <url>. Refresh the browser to see the changes.`

---

## Idempotency

If the agent died after applying an edit but before archiving, the next invocation will see the still-pending entry in `feedback-inbox` and may apply it twice. Two mitigations:

- Before applying, check if the file already reflects the requested change (e.g., text already split into two lines). Skip if so.
- Use `${EXEC}/state/design-decisions` to log "applied annotation X on selector Y" — on retry, scan the log first.

The protocol guarantees at-least-once; per-edit idempotency is this skill's responsibility.

---

## Failure modes to watch

- **Selector doesn't resolve**: the source HTML may have been regenerated between the user clicking and the agent processing. Try fuzzy match by tag + nearby text; if no match, log and skip (do not invent edits).
- **Comment is ambiguous** ("make this nicer"): do not silently invent. If the brand / craft give a clear direction, apply that and note the choice in `design-decisions`; otherwise, ask the user a clarifying question and **leave the entry in the inbox** (cursor not advanced, will be retried).
- **Multiple annotations conflict** (same selector, opposite intents): process in `ts` order; the last one wins. Log the conflict in `design-decisions`.
