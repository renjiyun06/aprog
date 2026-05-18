---
name: live-annotate
version: 0.4.0
kind: library
description: |
  Browser-side annotation surface + draft/commit pipeline. A Bun preview
  server serves an output directory, lets the user drop comments on rendered
  HTML, and on commit appends them to feedback-inbox + an input-NNN entry to
  input.md. The application drains the inbox per drain_procedure below.
---

# live-annotate

```yaml
name: live-annotate
version: 0.4.0
kind: library

depends_on:
  - skill: state
    note: |
      The server writes to ${EXEC}/input.md and to its own state_schema
      keys (feedback-draft, feedback-inbox, feedback-resolved). The state
      skill defines the rest of the contract (input_cursor, resume,
      atomic writes, schema merge).

paths:
  SKILL: <directory holding this SKILL.md>
  EXEC:  ~/.aprog/<execution-id>/

server:
  start:
    cmd: ${SKILL}/scripts/preview-server <output-dir> <exec-dir> [--port=N]
    bind: 0.0.0.0
  what_it_does: |
    Serves <output-dir> over HTTP, injects an annotation overlay into
    every rendered page, holds pending comment drafts server-side, and on
    commit appends the batch to the feedback-inbox blob and appends a new
    input-NNN entry to input.md titled "Live annotations (N)" — the
    signal the application is expected to drain. Anything beyond that is
    an internal implementation detail of the binary.

state_schema:
  - { key: feedback-draft,    storage: by-ref, content_type: jsonl, description: pending annotations from the preview overlay; server-managed staging area; agent MAY read but MUST NOT process until commit }
  - { key: feedback-inbox,    storage: by-ref, content_type: jsonl, description: committed annotations awaiting agent processing (append-only on the server side; consumed by the application's drain) }
  - { key: feedback-resolved, storage: by-ref, content_type: jsonl, description: processed entries archived here, with resolved_at + applied_to (append-only) }

drain_procedure:
  trigger: |
    Run when a new input-NNN titled "Live annotations" appears in
    input.md (the server posts this on every commit), OR when the user
    explicitly asks to process comments.
  steps: |
    1. Read every line of the feedback-inbox blob.

    2. For each entry, locate the source-of-truth. live-annotate gives
       you (url, selector) — what file/key that resolves to is
       APPLICATION-SPECIFIC and defined in the application's SKILL.md
       (e.g., design.output.source_of_truth maps to an HTML file under
       output-dir; shape.output.source_of_truth maps to a state.yaml
       key or by-ref blob).

    3. Interpret the comment in light of the application's working
       memory (active brand / vision / decisions / whichever the
       application defines).

    4. Apply the edit to the source.

    5. Archive: append the entry to feedback-resolved with two added
       fields — resolved_at (ISO 8601 UTC) and applied_to (the source
       identifier returned by the application's resolver). Remove the
       consumed line from feedback-inbox.

    6. Advance ${EXEC}/meta.yml.input_cursor past the input-NNN entry.

    7. Surface to the user: "Processed N annotation(s); refresh the
       browser to see the changes."
  idempotency: |
    At-least-once delivery is the state protocol's guarantee. If the
    agent died after applying but before archiving, the entry will be
    seen again on resume. Before applying, check whether the source
    already reflects the change (text already split, state key already
    matches); skip if so. Log applied annotations in the application's
    decisions key so retries can scan the log first.
  ambiguous_or_unresolvable:
    - kind: selector does not resolve
      response: try fuzzy match by tag + nearby text; if no match, log in decisions and SKIP — never invent edits.
    - kind: comment too vague to act on
      response: ask the user to clarify; LEAVE the entry in feedback-inbox (cursor not advanced) — it will be retried after the answer.
    - kind: conflicting annotations on the same selector
      response: process in `ts` order, latest wins; log the conflict in decisions.
```
