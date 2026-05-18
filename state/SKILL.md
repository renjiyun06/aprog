---
name: state
version: 0.3.0
kind: library
description: |
  Protocol for managing the state of any execution — identity,
  input stream, schemaful execution-state, and resume semantics.
---

# state

```yaml
name: state
version: 0.3.0
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
    received, the execution-state it has built up, and its lifecycle
    metadata. It is NOT the result of running a program — it is the
    workspace IN WHICH that run happens, addressable by an ID and
    persistent across interruptions.

# ---------------------------------------------------------------------------
# Filesystem layout
# ---------------------------------------------------------------------------
root:
  path: ~/.aprog/

execution_dir:
  path: ~/.aprog/<execution-id>/
  contents:
    meta.yml:          standardized protocol fields + state_schema snapshot
    input.md:          append-only user input stream
    execution-state/:  the program's working state for this execution
  os_analogy: |
    meta.yml ≈ PCB (process control block — standardized external
    interface). execution-state/ ≈ private process memory (program-managed).

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
# meta.yml — protocol-standard fields + state_schema snapshot.
# Programs MAY add their own top-level fields below the standard ones;
# tools that only know the protocol read the standard ones and ignore
# the rest.
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
    state_schema:    <ordered list of schema entries — see state_schema section>
  phase_note: |
    `phase` is free text. The protocol does NOT prescribe a phase set;
    each program defines its own FSM. But the CURRENT phase MUST be
    written here so that resume does not require reading
    execution-state/ first.

# ---------------------------------------------------------------------------
# input.md — append-only user input stream
# ---------------------------------------------------------------------------
input_md:
  format: markdown
  rules:
    - single file, APPEND-ONLY; original history is never rewritten
    - each entry has a sequential ID (input-NNN), an ISO8601 timestamp, and an optional short title
    - "entries MUST be separated by a `---` line (Markdown horizontal rule); no other separator is recognized"
    - contains ONLY what the user said to the program; program-internal Q&A, decisions, and intermediate artifacts go in execution-state/
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
# execution-state/ — the program's working state
# ---------------------------------------------------------------------------
execution_state:
  layout:
    path: ~/.aprog/<execution-id>/execution-state/
    contents:
      state.yaml: |
        Single YAML file holding every declared key. This is the
        index — read it once to know everything the program currently
        has.
      "<any subpath>": |
        Blob files referenced from state.yaml via { $file: <relative path> }.
        Subpath layout is the program's choice (conventionally `blobs/`,
        `render/`, etc.) but MUST stay inside execution-state/. No `../`
        escape.

  state_yaml:
    model: |
      state.yaml is the program's KV index. Each schema entry
      corresponds to ONE leaf path in the YAML tree.

      Paths use DOT NOTATION in the schema's `key` field (e.g.,
      `vision`, `vision.tagline`, `metrics.northstar`). Each dot is a
      nesting step; multiple entries with a shared prefix collapse into
      the same YAML subtree.

      A leaf's value is one of:

      - INLINE: a YAML scalar, list, or mapping — the value as-is.
      - BY-REF: a one-key mapping `{ $file: <relative path> }` — the
        actual value is the content of the referenced file.
      - MAP:    a mapping whose inner keys follow a schema-declared
        pattern; each inner value is itself inline or by-ref according
        to the schema's `value_storage`.

      Dots are PATH SEPARATORS, not part of names. To embed a literal
      dot inside one segment, quote the segment in the schema:
      `prices."v2.0"`.

    by_ref:
      shape:        '{ $file: <path> }'
      detection:    purely structural — a mapping with exactly one key named `$file`
      path_rules:
        - relative to execution-state/
        - "no `../` escape; the blob MUST live inside execution-state/"
        - filename and subdir naming is the program's choice
      content_type: declared by the schema entry (markdown | yaml | json | html | text | binary | ...)
      lifecycle:    deleting the key from state.yaml MUST also delete the referenced blob (no orphans)

    atomicity:
      state_yaml: |
        Writes to state.yaml MUST be atomic: write to a sibling tmp
        file, then `rename()` over the target. Readers never see a
        half-written state.yaml.
      blob: |
        Blob writes SHOULD use the same atomic rename pattern. For
        large binaries where streaming is required, programs MAY stream
        directly but MUST coordinate readers (e.g., write to
        `<path>.partial` and rename when complete).

    example: |
      # ~/.aprog/260518-x7k2/execution-state/state.yaml
      phase-status: in-progress
      target-screens: [home, products, team]

      # schema entries `vision.tagline` (inline) and `vision.statement` (by-ref)
      # collapse into the same `vision:` subtree:
      vision:
        tagline: "Brewing excellence at home"
        statement:
          $file: blobs/vision-statement.md

      decisions:
        - { id: dec-001, at: 2026-05-18T05:00Z, decision: 使用 blue 主色, rationale: 品牌一致性 }

      rendered-brief:
        $file: render/brief.html

      processes:
        mod-checkout:    { $file: blobs/processes/mod-checkout.yaml }
        mod-fulfillment: { $file: blobs/processes/mod-fulfillment.yaml }

# ---------------------------------------------------------------------------
# state_schema — declared shape of execution-state/
# ---------------------------------------------------------------------------
state_schema:
  location: |
    Lives under meta.yml.state_schema as an ordered list. It is the
    EXECUTION's own copy — copied at creation time from the program's
    SKILL.md (which declares the baseline schema), and may be extended
    during execution.

  snapshot_semantics: |
    The program's SKILL.md is the SOURCE of the baseline schema. At
    execution creation, that baseline is COPIED into
    meta.yml.state_schema. After that, the execution's schema is its
    own — the program may later release a new version with a different
    baseline, but this execution continues with its frozen copy.

    Default upgrade policy: do not migrate running executions. If a
    program wants migration, it defines its own migration step; the
    protocol does not mandate one.

  composition: |
    The program's baseline schema is MERGED from:

      1. the program's OWN state_schema declaration. A program can be an
         application skill (executed many times) or a one-shot task
         document (executed once) — they're peers at the protocol level,
         both qualify as "the program".
      2. each `depends_on` library skill that declares a state_schema.

    Merge order is (1) ← (2); within each source, entries are appended
    in declaration order. The merged list is what gets snapshotted into
    meta.yml.state_schema. After snapshotting, only meta.yml matters —
    skill files are no longer consulted.

    Conflict rule: two entries with the same key from different sources
    is a hard error at creation. The protocol does NOT pick a winner.
    Resolve by renaming the key in one of the sources before retrying.

  extensibility: |
    Programs MAY add new schema entries at runtime by appending to
    meta.yml.state_schema. The added entry must satisfy the same field
    requirements as a baseline entry. Once added, the new key is
    indistinguishable from a baseline key — they are equally
    first-class.

    Programs SHOULD NOT remove or rename baseline keys; doing so breaks
    the program/execution contract. (If removal is genuinely needed,
    ship a new program version with a new baseline and start fresh
    executions there.)

  enforcement: |
    Every leaf in state.yaml MUST correspond to an entry in
    state_schema (matched by dotted key path). Writing an undeclared
    leaf without first appending its schema entry is a protocol
    violation; the right pattern is "declare then write".

  entry_fields:
    key:
      required: true
      meaning: |
        Dotted path into state.yaml's tree (e.g., `vision`,
        `vision.tagline`, `metrics.northstar`). Each dot is a nesting
        step. Quote a segment to embed a literal dot.

    storage:
      required: true
      values: inline | by-ref | map
      meaning: |
        - inline: value lives directly in state.yaml
        - by-ref: value is `{ $file: <path> }`, content lives in a blob
        - map:    value is a mapping whose own keys follow `key_pattern`

    content_type:
      required_when: storage = by-ref
      values: markdown | yaml | json | html | text | binary | <any>
      meaning: the format of the referenced blob

    key_pattern:
      required_when: storage = map
      meaning: |
        A pattern describing the inner keys of the map, written as a
        free-form placeholder (e.g., `<mod-id>`, `<step-id>`).
        Documentation only — the protocol does not enforce a regex.

    value_storage:
      required_when: storage = map
      values: inline | by-ref
      meaning: how each inner value is represented

    value_content_type:
      required_when: storage = map AND value_storage = by-ref
      meaning: content_type for the inner blob values

    description:
      required: true
      meaning: what this key is for, in the program's words

  example: |
    # in meta.yml:
    state_schema:
      - key: vision.tagline
        storage: inline
        description: 一句话定位。

      - key: vision.statement
        storage: by-ref
        content_type: markdown
        description: 完整愿景文档。

      - key: decisions
        storage: inline
        description: 设计决策的追加流水(list of records)。

      - key: processes
        storage: map
        key_pattern: <mod-id>
        value_storage: by-ref
        value_content_type: yaml
        description: 每个模块的业务过程目录。

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
      "Fully consumed" means the request has been reflected into
      execution-state/ (or wherever the program persists its work).
  guarantee: at-least-once
  reprocessing_safety: |
    The protocol guarantees AT-LEAST-ONCE delivery. If the agent dies
    after acting on an input but before advancing the cursor, the next
    resume will see the same input again.

    Re-processing safety is the PROGRAM'S responsibility, not the
    protocol's. Use traces in execution-state/ to detect "started but
    did not finish" and skip if already applied.
```
