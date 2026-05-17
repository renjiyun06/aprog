---
name: state
version: 0.2.0
kind: library
description: |
  Protocol for managing the state of any execution — identity,
  input stream, working state, and resume semantics. Skills that
  reference this protocol inherit a uniform model for suspending
  and resuming work across interruptions.
---

# state

```yaml
name: state
version: 0.2.0
kind: library

# ---------------------------------------------------------------------------
# Core abstraction
# ---------------------------------------------------------------------------
execution:
  shape:
    program: <what is being executed>
    input:   <what was asked of it>
    state:   <where it currently is>
  meaning: |
    `program` is the static description of what to execute — typically a
    skill document, but the protocol places no constraint on its form
    (a procedure spec, workflow definition, or any structured instruction
    artifact qualifies).

    An Execution is the NAMED SCOPE that contains everything about ONE
    RUN of a program: a reference to the program, the inputs it has
    received, the working state it has built up, and its lifecycle
    metadata. It is NOT the result of running a program — it is the
    workspace IN WHICH that run happens, addressable by an ID and
    persistent across interruptions.

    No state exists outside an execution. Executions are isolated from
    each other.

# ---------------------------------------------------------------------------
# Filesystem layout
# ---------------------------------------------------------------------------
root:
  path: ~/.aprog/
  note: |
    Single per-user root. Per-project roots are NOT supported.
    For project-local access, symlink.

execution_dir:
  path: ~/.aprog/<execution-id>/
  contents:
    meta.yml: standardized protocol fields
    input.md: append-only user input stream
    state/:   private namespace owned by the program
  ownership:
    - { path: meta.yml,        owner: protocol,                  reader: any tool }
    - { path: input.md,        owner: protocol (format) + user (content),  reader: any tool }
    - { path: state/ (subdir), owner: the program,               reader: only that program }
  os_analogy: |
    meta.yml ≈ PCB (process control block — standardized external
    interface). state/ ≈ private process memory (program-managed).
  naming_note: |
    The `state` skill (this document) and the `state/` subdirectory
    inside an execution share a name but live at different layers — the
    skill is the protocol; the subdir is one location the protocol
    defines. Don't conflate.

# ---------------------------------------------------------------------------
# Execution identity
# ---------------------------------------------------------------------------
execution_id:
  format: <yyMMdd>-<4-char nanoid>
  example: 260516-x7k2
  properties:
    - automatic
    - collision-free in practice
    - sortable by `ls -lt`
  no_other_formats_accepted: true
  surface_to_user: |
    On creation, the program MUST surface the new execution ID to the
    user. Without knowing the ID, the user cannot resume this execution
    later.

    Present it inline (e.g., "Started execution `260516-x7k2` — say
    `resume 260516-x7k2` to come back to it.") or as a structured
    handoff — but it MUST be visible to the user, not buried in logs or
    only written to meta.yml.

# ---------------------------------------------------------------------------
# meta.yml schema — standardized fields the protocol defines.
# Programs MAY add their own fields below the standard ones; tools that
# only know the protocol read the standard ones and ignore the rest.
# ---------------------------------------------------------------------------
meta_yml:
  fields:
    id:              <execution-id>
    program:         <name or path of what is being executed (e.g., a skill doc)>
    program_version: <copy the program doc's version field if it has one; otherwise omit>
    status:          running | completed | failed
    phase:           <free text; the program defines its own phase names>
    created_at:      <ISO8601>
    last_active_at:  <ISO8601>
    input_cursor:    <ID of the latest fully-processed input; omit if none>
  phase_note: |
    `phase` is free text. The protocol does NOT prescribe a phase set;
    each program defines its own FSM. But the CURRENT phase MUST be
    written here so that resume does not require reading state/ first.

# ---------------------------------------------------------------------------
# input.md — append-only user input stream
# ---------------------------------------------------------------------------
input_md:
  format: markdown
  rules:
    - single file, APPEND-ONLY; original history is never rewritten
    - each entry has a sequential ID (input-NNN), an ISO8601 timestamp, and an optional short title
    - "entries MUST be separated by a `---` line (Markdown horizontal rule); no other separator is recognized"
    - contains ONLY what the user said to the program; program-internal Q&A, decisions, and intermediate artifacts go in state/
  entry_template: |
    ## input-NNN @ <ISO8601> — <optional title>
    <body>

    ---

    ## input-NNN+1 @ <ISO8601> — <optional title>
    <body>
  example: |
    ## input-001 @ 2026-05-16T06:00 — Initial
    Design a corporate site. Blue/white palette, Products and Team pages.

    ---

    ## input-002 @ 2026-05-16T08:30 — Follow-up
    Add an FAQ page.

# ---------------------------------------------------------------------------
# state/ — program-private KV namespace
# ---------------------------------------------------------------------------
state_kv:
  model: |
    state/ is a KEY-VALUE STORE on the filesystem.
    - One file per key.
    - The filename IS the key — no file extensions.
    - The file's content is the value. Format is the program's choice
      (Markdown, JSON, YAML, plain text, etc.).
    - Filenames are HYPHEN-SEPARATED, lowercase, and meaningful.
      Examples: `current-design-direction`, `decided-color-palette`,
      `open-questions`.
    - Subdirectories group related keys as namespaces when keys
      naturally cluster.
  self_contained: |
    state/ should be SELF-CONTAINED — if meta.yml is lost, the program
    should still be able to reconstruct "where I was" from state/ alone.
    Treat meta.yml as a cache for resume; treat state/ as the source of
    truth for working memory.

# ---------------------------------------------------------------------------
# Resume contract
# ---------------------------------------------------------------------------
resume:
  cursor_semantics: |
    input.md accumulates entries across sessions. Distinguishing
    processed vs. unprocessed uses meta.yml.input_cursor:

    - On resume, read input.md and take every entry AFTER input_cursor
      — those are unprocessed.
    - ADVANCE THE CURSOR ONLY AFTER FULLY CONSUMING AN INPUT.
      "Fully consumed" means the request has been reflected into state/
      (or wherever the program persists its work).
  guarantee: at-least-once
  reprocessing_safety: |
    The protocol guarantees AT-LEAST-ONCE delivery. If the agent dies
    after acting on an input but before advancing the cursor, the next
    resume will see the same input again.

    Re-processing safety is the PROGRAM'S responsibility, not the
    protocol's. Use traces in state/ to detect "started but did not
    finish" and skip if already applied.
  why_not_event_log: |
    The cursor narrows input.md to a small consumer-offset queue of
    user inputs, without forcing the entire program state to be an
    event log. Programs that want event-log semantics can build them
    inside state/; the protocol stays minimal.

# ---------------------------------------------------------------------------
# What goes where: input vs. state
# ---------------------------------------------------------------------------
input_vs_state:
  routing:
    - { utterance: "What I want / my constraints changed",          example: "Add an FAQ page; switch from blue to green", goes_to: input.md }
    - { utterance: "Regarding your previous question, my answer is X", example: "Use the logo I just sent",                 goes_to: state/   }
  rationale: |
    input.md is the EVOLUTION OF THE OVERALL INSTRUCTION to the
    program. New goals, changed constraints, new pages — these are
    instructions, append to input.md.

    Skill-internal Q&A is part of how the program does its current
    work. The agent's "I need to ask the user something to finish this
    step" and the user's answer are NOT new instructions; they're
    inside the program's current loop. Capture them in state/ (e.g., a
    `decisions` or `open-questions` KV).

    The protocol can only state the rule; enforcement is the
    implementer's discipline.
```
