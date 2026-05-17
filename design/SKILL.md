---
name: design
version: 0.2.0
kind: application
description: |
  Designs websites, mobile prototypes, hi-fi mockups, slide decks,
  single-page artifacts, and media outputs (image / video / audio).
---

# design

This skill's body is a **YAML spec** (below). It encodes the machinery —
phases, transitions, state schema, on-entry loads, scripts, conflict
precedence, resume contract. Companion prose lives under `docs/`:

- `docs/principles.md` — discovery philosophy, resource-loading discipline, state-vs-input rules
- `docs/rationale.md` — the "why" behind specific rules; the spec references it via `why:` and `see:` anchors

Read the spec for **what to do**. Follow a `docs/...#anchor` reference when the spec points at it — those anchors carry the judgment that doesn't fit a YAML field.

> **Required first step**: load the `state` skill **before** proceeding.
> This spec is layered on top of the state protocol; every reference to
> `${EXEC}`, `meta.yml`, `input.md`, `state/`, `input_cursor`, and "resume"
> assumes you've already read the state skill.

---

## Spec

```yaml
name: design
version: 0.2.0
kind: application

depends_on:
  - skill: state
    note: MUST be loaded first. The state skill defines ${EXEC}, meta.yml, input.md, state/, input_cursor, and resume.

paths:
  EXEC: ~/.aprog/<execution-id>/   # current execution directory
  SKILL: <directory holding this SKILL.md>

# ---------------------------------------------------------------------------
# Output channel — every artifact must be served via the preview-server so
# the user can preview AND drop in-page feedback. Pending feedback is
# server-side state, NOT browser sessionStorage — drafts survive tab close,
# are visible across tabs and browsers, and the agent can read them as a
# normal state KV before commit.
# ---------------------------------------------------------------------------
output:
  serve_via: ${SKILL}/scripts/preview-server
  why: docs/rationale.md#preview-server
  forbidden_fallbacks:
    - "python3 -m http.server"   # cannot inject overlay JS or accept POST
  flow:
    - user clicks an element in the browser overlay → comment saved to state/feedback-draft
    - drafts are mutable from any browser (delete, add, see others' pending)
    - "Send batch" → POST /commit → server drains draft into state/feedback-inbox, appends a new input-NNN entry to input.md, clears the draft
  endpoints:
    - { method: GET,    path: /draft,                  returns: "{ feedback: Comment[] }" }
    - { method: POST,   path: /draft/feedback,         body: "{ url, selector, comment }", returns: "{ ok, id, count }" }
    - { method: DELETE, path: /draft/feedback/:id,     returns: "{ ok, count }" }
    - { method: DELETE, path: /draft,                  returns: "{ ok }" }
    - { method: POST,   path: /commit,                 returns: "{ ok, accepted, input_id }" }
  tweak_mode:
    status: hidden
    note: UI button + /tweak modal are not rendered; server endpoint preserved dormant for future revival.

# ---------------------------------------------------------------------------
# State KV schema. Each row is a file under ${EXEC}/state/ — the filename IS
# the key. `format` is for humans; the protocol stores raw bytes.
# ---------------------------------------------------------------------------
state_kv:
  - { key: brand-brief,            format: md,        phase: discovery,  purpose: accumulating brand/intent/audience }
  - { key: discovery-notes,        format: md,        phase: discovery,  purpose: scratch of open axes / observations }
  - { key: selected-template,      format: text,      phase: selecting,  required: true, purpose: "single design-template name (the shape)" }
  - { key: selected-design-system, format: text,      phase: selecting,  required: true, purpose: "single design-system name (the brand)" }
  - { key: selected-craft,         format: lines,     phase: selecting,                  purpose: "opted-in craft rule names" }
  - { key: output-dir,             format: abs-path,  phase: selecting,  required: true, purpose: "where artifacts go" }
  - { key: target-screens,         format: lines,     phase: designing,                  purpose: "screens / artifacts to produce" }
  - { key: produced-files,         format: md-table,  phase: designing,  mutable: true,  purpose: "current files on disk; rewritten on add/replace/remove" }
  - { key: current-revision,       format: text,      phase: designing,                  purpose: "iteration identifier" }
  - { key: design-decisions,       format: md,        phase: designing,  append: true,   purpose: "major choices + rationale" }
  - { key: feedback-draft,         format: jsonl,     phase: designing,  mutable: true,  purpose: "pending annotations from preview overlay; preview-server manages; AGENT MAY READ but SHOULD NOT process — items graduate to feedback-inbox only on commit" }
  - { key: feedback-inbox,         format: jsonl,     phase: designing,  append: true,   purpose: "committed annotations awaiting agent processing; each commit also appends an input-NNN entry to input.md" }
  - { key: feedback-resolved,      format: jsonl,     phase: designing,  append: true,   purpose: "processed entries moved here by live-annotate skill" }
  - { key: tweak-inbox,            format: jsonl,     phase: designing,  dormant: true,  purpose: "dormant; tweak UI hidden but server endpoint preserved" }

cardinality_rationale: docs/rationale.md#template-vs-craft-cardinality

# ---------------------------------------------------------------------------
# FSM. The state protocol does NOT prescribe phase names; each program
# defines its own and writes the current phase to meta.yml.phase.
# ---------------------------------------------------------------------------
phases:

  discovery:
    goal: build a substantive brief — brand, intent, audience, artifact kind
    principles: docs/principles.md#discovery
    behavior:
      - ask one open question at a time
      - cover over time: project kind, audience, brand voice, references, constraints, success criteria
      - each user reply should narrow the design space or surface a new unanswered axis
    writes: [brand-brief, discovery-notes]
    transitions:
      - to: selecting
        when: |
          brand-brief covers kind, audience, brand voice, and ≥1 reference;
          AND user's recent answers no longer introduce new uncertainty.

  selecting:
    goal: lock in design-template, design-system, opted-in craft, output-dir
    on_entry:
      load_indices:
        - run: ${SKILL}/scripts/list-resources design-templates
          why: candidates proposed in this phase
        - run: ${SKILL}/scripts/list-resources design-systems
          why: candidates proposed in this phase
        - run: ${SKILL}/scripts/list-resources craft
          why: candidates proposed in this phase
        - run: ${SKILL}/scripts/list-resources skills
          why: kept in working memory for on-demand invocation later in designing
      constraints:
        - consume FULL output of every list-resources run
        - do NOT pipe through head / tail / grep / awk; do NOT truncate
        - see docs/rationale.md#index-truncation
    behavior:
      - narrow each category to 2–3 candidates that best match the brief
      - only THEN Read the full SKILL.md / DESIGN.md / craft file for proposed candidates
      - propose 2–3 design-templates with one-sentence rationale
      - propose 2–3 design-systems matching the brand voice
      - propose 2–4 craft rules
      - ask user for output-dir (offer a default if no preference)
    writes: [selected-template, selected-design-system, selected-craft, output-dir]
    transitions:
      - to: designing
        when: all required state writes set AND output-dir exists on disk

  designing:
    goal: produce and iterate artifacts
    on_entry:
      load:
        a_execution_state:
          - ${EXEC}/state/brand-brief
          - ${EXEC}/state/design-decisions
        b_resource_library:
          why: docs/rationale.md#resume-b
          required:
            - ${SKILL}/resources/design-systems/${state.selected-design-system}/DESIGN.md
            - ${SKILL}/resources/design-templates/${state.selected-template}/SKILL.md
          optional_if_present:
            - ${SKILL}/resources/design-systems/${state.selected-design-system}/tokens.css
            - ${SKILL}/resources/design-systems/${state.selected-design-system}/components.html
            - ${SKILL}/resources/design-templates/${state.selected-template}/references/*.md
          per_state_value:
            for_each: ${name} in ${state.selected-craft}
            read: ${SKILL}/resources/craft/${name}.md
        c_functional_skill_index:
          loaded_in_phase: selecting
          kept_in_memory_for: designing
          body_loaded_on_demand: true
          why: docs/rationale.md#functional-skill-index
      start_server:
        cmd: ${SKILL}/scripts/preview-server ${state.output-dir} ${EXEC}
        bind: 0.0.0.0
        surface_to_user: url
    conflict_precedence:
      - brand > craft         # on visual tokens
      - user_input > all      # latest input.md entry wins everything
      - why: docs/rationale.md#conflict-precedence
    behavior:
      - generate first artifact set; write to ${state.output-dir}
      - update ${state.produced-files} to reflect what now exists
      - on each new input-NNN: determine what changed; regenerate / add / replace / remove
      - on a delete request: remove file(s); rewrite produced-files; log to design-decisions
      - keep produced-files in sync with disk reality
      - advance input_cursor only AFTER an input is fully reflected
      - on-demand: match against the functional-skill index loaded in selecting; Read full SKILL.md only at the moment of invocation
      - feedback-inbox processing is delegated to the live-annotate functional skill
    writes: [target-screens, produced-files, current-revision, design-decisions]
    transitions:
      - to: done
        when: user explicitly signals completion

  done:
    goal: clean handoff
    actions:
      - write summary.md into ${state.output-dir}
      - set meta.yml.status = completed
    transitions:
      - to: designing
        when: a new input-NNN arrives after done

# ---------------------------------------------------------------------------
# Resume contract. Phase-aware. designing is the heaviest because the
# skill's resource library must be re-pulled into context.
# ---------------------------------------------------------------------------
resume:
  agent_history_persisted: false
  recoverable_surface:
    - ${EXEC}/meta.yml
    - ${EXEC}/input.md
    - ${EXEC}/state/
  steps:
    - read meta.yml — note phase, input_cursor, status
    - read every input.md entry AFTER input_cursor
    - read state/ keys relevant to the current phase
    - conditional:
        if: phase == designing
        then:
          - rerun phases.designing.on_entry.load (groups A, B, C — see why_critical)
          - rerun phases.selecting.on_entry.load_indices.skills (the functional skill index)
          - restart preview-server (the previous instance is gone)
          - reconcile state.produced-files with what's actually on disk
          - verify selected-template / selected-design-system / output-dir still valid
          - why_critical: docs/rationale.md#resume-b
    - take action per current phase
    - advance meta.yml.input_cursor only after each input is FULLY reflected

# ---------------------------------------------------------------------------
# Cross-references (also linked inline above via `why:` and `see:` fields)
# ---------------------------------------------------------------------------
docs:
  - docs/principles.md
  - docs/rationale.md
```

---

## Legacy

The previous prose-form spec is preserved at `SKILL.legacy.md` for reference. Both forms encode the same contract; this YAML form is the source of truth going forward.
