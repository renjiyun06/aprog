---
name: grasp
version: 0.1.0
kind: application
description: |
  Read an existing project and produce a working mental model — topology,
  core concepts, end-to-end flows, and the specific mechanisms that
  matter to the user. Output is a browseable, commentable single-page
  document. NOT a code review, NOT a refactor plan, NOT a usage tutorial.
---

# grasp

```yaml
name: grasp
version: 0.1.0
kind: application

depends_on:
  - skill: state
    note: MUST be loaded first. The state skill defines ${EXEC}, meta.yml, input.md, execution-state/, state.yaml, input_cursor, and resume.
  - skill: live-annotate
    note: |
      Provides the preview-server + overlay + draft/commit pipeline. Its
      SKILL.md defines server invocation, endpoints, and drain_procedure.
      User annotations on the livedoc drive the mechanisms phase.

paths:
  EXEC:    ~/.aprog/<execution-id>/
  SKILL:   <directory holding this SKILL.md>
  PROJECT: ${state.project-path}  # absolute path to the target repo, set in survey phase

purpose: |
  grasp turns "I want to understand this project" into a structured,
  layered mental model. One execution per project — resume picks up
  where you left off, and the livedoc grows over time as new mechanisms
  are drilled into.

  The agent's understanding WORK proceeds in four phases:

    1. Survey       — top-level shape: README / ARCHITECTURE / dir tree
                      / tech stack / module topology / entry points.
    2. Concepts     — core abstractions and their terminology, with
                      one-line definitions and relationships.
    3. Flows        — 1–3 representative end-to-end use cases traced
                      through the code (not every code path, just the
                      ones that exercise the spine).
    4. Mechanisms   — user-selected deep dives ("how does X actually
                      work"). Driven by live-annotate comments on the
                      livedoc; reused across resume.

  These are WORK STAGES for the agent, NOT livedoc sections. How the
  final document presents is a separate question, decided by the chosen
  render-template — see phases_vs_render below.

  grasp STOPS at "how it works". It does NOT cover:
    - whether the project is well-designed (that's a code review)
    - what should change (that's a refactor plan)
    - how to use the project as a library (that's a tutorial)
    - reverse-engineering product intent (that's shape, fed grasp's output)

  grasp is NOT a one-shot summary. It's a multi-turn collaborative read
  whose output grows incrementally as the user surfaces interest.

phases_vs_render:
  principle: |
    The agent's understanding work (phases) is DECOUPLED from how the
    result gets presented (render-template). The same state.yaml can
    render into many shapes — long doc, single-page architecture
    poster, concept-map first, flow-story narrative, slide deck —
    depending on which template is chosen.

    Phases produce the structured understanding (state.yaml + by-ref
    blobs). Templates decide layout: what's a hero chart vs a sidebar,
    what's a main section vs an appendix, what's text vs diagram. Do
    NOT bake a particular layout into phase logic or state schema.

  v0.1.0_state: |
    One template ships: grasp-doc (chart-first four-section doc).
    Future candidates listed under resources.future_render_templates.
    Agent picks (or asks user) once survey is complete — different
    project types call for different presentations.


output:
  serve_via:
    provider: live-annotate
    component: preview-server

  canonical:
    where: ${EXEC}/execution-state/
    why: |
      The canonical understanding is the structured state (survey, concepts,
      flows[], mechanisms[]). The HTML is a view; state is the source of
      truth. Edit state, then regenerate the HTML — never the other way.

  render:
    inputs:
      - ${EXEC}/execution-state/state.yaml + the by-ref blobs it points to
      - ${SKILL}/resources/render-templates/${state.render-template}/SKILL.md
      - ${SKILL}/resources/render-templates/${state.render-template}/example.html
    output: ${state.output-dir}/index.html
    when:   on every state write that should be visible to the user
    how: |
      No transformer script. The agent READS state.yaml + its by-ref
      blobs + the chosen render-template's SKILL.md + example.html, then
      WRITES a single HTML page whose LAYOUT is dictated by the template
      — what's a hero chart, what's a card grid, what's a sidebar,
      what's main vs appendix all live in the template. The phases
      below only produce state; the template alone decides presentation.

state_schema:
  - { key: project-path,    storage: inline,                                                                          description: "absolute path to target repo; required (survey phase, immutable)" }
  - { key: project-head,    storage: inline,                                                                          description: "git HEAD short-sha at survey time; records WHICH commit was grasped" }
  - { key: project-name,    storage: inline,                                                                          description: "human-readable project name; default repo dir basename" }
  - { key: render-template, storage: inline,                                                                          description: "name of resources/render-templates/<name>/ to use; default grasp-doc (survey phase)" }
  - { key: output-dir,      storage: inline,                                                                          description: "absolute path where rendered HTML goes (survey phase; required)" }
  - { key: survey,          storage: by-ref, content_type: markdown,                                                  description: "top-level shape: stack, layout, services, entry points (snapshot of project topology)" }
  - { key: concepts,        storage: inline,                                                                          description: "list of core abstractions: id, term, one-line definition, relates-to[] (core abstraction map)" }
  - { key: flows,           storage: map,    key_pattern: <flow-id>,     value_storage: by-ref, value_content_type: markdown, description: "per traced end-to-end flow: trigger, actors, sequence, files-touched" }
  - { key: mechanisms,      storage: map,    key_pattern: <mechanism-id>, value_storage: by-ref, value_content_type: markdown, description: "per user-requested deep dive: what + how + where (file:line) + caveats" }
  - { key: open-questions,  storage: by-ref, content_type: markdown,                                                  description: "live-annotate comments not yet drained into a mechanism; append-only inbox" }
  - { key: decisions,       storage: by-ref, content_type: markdown,                                                  description: "interpretation choices: 'we treat X as Y because Z'; append-only" }

walk:
  mode: BFS-then-user-driven-DFS
  rule: |
    The first three phases (survey, concepts, flows) walk BREADTH-FIRST.
    They MUST be completed in order before mechanisms can start. Do not
    skip ahead to deep-dive a single component until the spine is laid.

    Why BFS first: every deep dive is anchored in the topology, the
    concept vocabulary, and at least one flow that shows how the piece
    fits the whole. Skipping the spine produces correct-but-isolated
    explanations that the user can't connect to anything.

    Mechanisms is DEPTH-FIRST and USER-DRIVEN. Each mechanism is a
    response to a specific question (raised in input.md or as a
    live-annotate comment on the livedoc). The agent does NOT
    speculatively deep-dive — that produces a wall of explanation that
    nobody asked for.

  re_read_on_entry: |
    On EVERY entry into a phase (including resume), the agent MUST
    re-read the core source-of-truth files:
      - ${PROJECT}/README.md (if present)
      - ${PROJECT}/ARCHITECTURE.md (if present)
      - the specific files cited in survey / concepts that the current
        phase will refine
    Memory of previously-read content is NOT trusted; the project may
    have changed since last entry, and the model's recollection drifts.
    (Same rule as design/shape — past failures came from skipping re-read.)

phases:

  survey:
    goal: pin the top-level shape — stack, layout, services, entry points
    on_entry:
      reads:
        - ${PROJECT}/README.md
        - ${PROJECT}/ARCHITECTURE.md (or ARCHITECTURE.* / docs/architecture* if present)
        - ${PROJECT}/package.json | go.mod | pyproject.toml | Cargo.toml (any present)
        - the result of `git -C ${PROJECT} log -1 --format='%h %s'` → record as project-head
        - the result of `ls ${PROJECT}` and `find ${PROJECT} -maxdepth 2 -type d` (top + 1 level)
    principles: |
      - Survey is description, not interpretation. Record what is there;
        do not yet explain why.
      - Cover, in this order: tech stack → top-level layout → services /
        processes → external dependencies (DBs, message queues, model
        providers) → entry points (CLI / HTTP routes / main funcs).
      - Cite files. Every claim ("uses Postgres", "FastAPI service") must
        point to the file that proves it. Speculation is forbidden in
        survey — if a file is needed and absent, say so.
      - Survey is a snapshot. It records project-head so later sections
        can be honest about "this was grasped at commit X".
    behavior:
      - read the core files listed above
      - propose a draft survey with: stack list, dir tree summary, services
        / processes, external deps, entry points; each claim cites a file
      - ask the user to confirm or amend
      - on confirm, set project-name, project-head, output-dir,
        render-template, write survey
    writes: [project-path, project-head, project-name, render-template, output-dir, survey]
    transitions:
      - to: concepts
        when: |
          survey covers stack + layout + services + external deps + entry
          points, each cited; user confirms; livedoc re-renders to reflect new state.

  concepts:
    goal: name and define core abstractions and how they relate
    on_entry:
      reads:
        - the specific files cited in survey under "entry points" and
          "services" — concepts almost always live in models / types /
          schema files near these entry points
        - any GLOSSARY.md / TERMS.md / docs/concepts* if present
    principles: |
      - Borrow the project's own vocabulary. Do NOT rename concepts
        ("Session" stays "Session" even if you think "Conversation" is
        clearer). If the project uses two words for one thing, note both.
      - One-line definitions. If you can't compress a concept to one
        sentence + a relates-to[], you haven't understood it; mark it
        and ask the user for help.
      - Relationships are first-class. For each concept, list which
        other concepts it contains, references, or is referenced by.
      - Don't enumerate ALL abstractions — pick the ~5–12 that a new
        contributor must know before reading code. Helpers, enums,
        utility types are out of scope.
    behavior:
      - read code-level concept definitions (structs / classes / schemas)
      - propose a concepts list: id (kebab), term (project's wording),
        one-line definition, relates-to[]
      - mark uncertainty explicitly with "?" — the user will confirm
        or correct
      - on confirm, write concepts; re-render livedoc
    writes: [concepts]
    transitions:
      - to: flows
        when: |
          5–12 core concepts named with one-line definitions and
          relationships; user confirms; livedoc re-renders to reflect new state.

  flows:
    goal: trace 1–3 representative end-to-end uses through the code
    on_entry:
      reads:
        - the entry-point files identified in survey
        - the route / handler / orchestrator files those entry points
          dispatch to
    principles: |
      - 1–3 flows is the budget. More than 3 dilutes; fewer than 1
        leaves the spine unshown.
      - Pick flows that exercise the SPINE — the path that shows how
        the core abstractions connect. A "hello world" call is fine if
        it touches the orchestrator + state + event log. A flow that
        only touches utilities is the wrong pick.
      - A flow is a sequence: trigger → which actor → which file:func →
        what state changes → what observable result. Cite file:line for
        each step. No pseudocode — quote when needed.
      - Flows are read-side, not write-side. Don't propose changes; don't
        evaluate. Just trace.
    behavior:
      - propose 1–3 candidate flows with one-line summary each; user picks
      - for each picked flow, write a step-by-step trace with file:line
        citations
      - on confirm, write flows.<flow-id>; re-render livedoc
    writes: [flows.<flow-id>]
    transitions:
      - to: mechanisms
        when: |
          1–3 flows traced with file:line citations; user confirms;
          livedoc re-renders to reflect new state.

  mechanisms:
    goal: deep-dive specific pieces the user wants to understand
    re_entrant: true
    note: |
      This phase loops. Each loop: drain one question into one mechanism.
      Multiple mechanisms accumulate across loops and resumes.
    on_entry:
      reads:
        - open-questions blob (the live-annotate inbox)
        - the specific source files the current mechanism touches
      drain_procedure: |
        See live-annotate SKILL.md drain_procedure. Comments on the
        livedoc become entries in open-questions; this phase pops one
        at a time and turns it into a mechanism blob.
    principles: |
      - One mechanism per loop. Resist bundling multiple questions —
        each deserves its own section, its own citations, its own scope.
      - File:line citations are mandatory. A mechanism without code
        anchors is speculation.
      - Mechanism length is bounded — typically 200–600 words + one
        code block / one diagram. If a mechanism is growing into an
        essay, that's a sign it should be split into two.
      - When a mechanism reveals a missed concept or flow, FLAG it and
        ask the user whether to backfill concepts / flows before
        continuing. Don't sneak edits into earlier sections.
      - "How does X actually work" is the typical shape. Output structure:
          What it is — one paragraph
          How it works — sequence / pseudocode anchored in file:line
          Where it lives — files + key functions
          Caveats — non-obvious constraints, footguns, version notes
    behavior:
      - poll open-questions; if non-empty, pop one and deep-dive
      - if empty, ask user what to drill into next, or offer to wrap
      - write mechanisms.<mechanism-id>; re-render livedoc
      - repeat
    writes: [mechanisms.<mechanism-id>, open-questions, decisions]
    transitions:
      - to: done
        when: user explicitly says "enough" / "done" / equivalent
      - stay: mechanisms
        when: more questions to drain or user wants another deep dive

  done:
    goal: freeze the current understanding
    behavior:
      - re-render livedoc one final time
      - print a short summary of what's covered + what was deferred
        (mechanisms not done, concepts marked uncertain)
      - DO NOT delete state; resume can reopen this execution if the
        user wants to add mechanisms later
    writes: []

resume:
  on_entry: |
    EVERY resume MUST:
      1. Re-load state skill, then this SKILL.md
      2. Re-read ${PROJECT}/README.md and ARCHITECTURE.md if present
         (project may have changed; memory drift is real — see the
         260516-pkm1 lesson)
      3. Verify ${state.project-head} matches `git -C ${PROJECT} rev-parse --short HEAD`
         — if different, surface this to the user: "project moved from
         X to Y since last grasp; do you want to refresh survey, or
         continue against the old reading?"
      4. Run preview-server (live-annotate) on output-dir
      5. Drain any live-annotate comments queued since last session
         into open-questions
  phase_extras:
    survey:    "re-read README/ARCHITECTURE before answering"
    concepts:  "re-read the concept-defining files cited in concepts"
    flows:     "re-read the entry-point files and the orchestrator(s)"
    mechanisms: "drain comments first; pop one open-question; deep dive"
    done:      "show summary; offer to reopen by entering a new question"

resources:
  overview: |
    grasp's resource library starts MOSTLY EMPTY. The one essential
    resource is render-templates, which controls the livedoc layout.
    Other categories (concept-patterns, flow-templates) may emerge over
    time as repeated patterns surface across executions — when promoted,
    they live under resources/. Do NOT pre-populate.
  root: ${SKILL}/resources/
  categories:
    - { name: render-templates, role: HTML presentation styles for the grasp livedoc; each a folder with SKILL.md + example.html. v0.1.0 ships ONE: grasp-doc (chart-first four-section doc). }

  future_render_templates: |
    Not yet built (v0.1.0 ships grasp-doc only). The design space:
      - arch-poster   : single-page architecture poster; huge topology
                        hero; for infra / runtime / platform projects.
      - concept-map   : concept-relations diagram dominates; flows as
                        appendix; for theory / abstract-heavy projects.
      - flow-story    : flows as narrative spine; for business /
                        app-layer projects whose value lives in use cases.
    Add as needed. Agent picks the template after survey; same state
    renders into different shapes.

io_contract:
  input:
    via: ${EXEC}/input.md
    expected_first_input: |
      Absolute path to the target repository, optionally followed by
      one or two lines stating WHY the user is grasping it (drives
      flow picks in the flows phase).
  output:
    primary: ${state.output-dir}/index.html  (livedoc; layout determined by ${state.render-template})
    secondary: ${EXEC}/execution-state/state.yaml + by-ref blobs (source of truth)

non_goals:
  - producing a code review or critique
  - producing a refactor plan
  - producing a usage tutorial / how-to-use-as-library doc
  - reverse-engineering product / business intent (use shape, fed by grasp's output)
  - speculative deep-diving of mechanisms the user didn't ask about
```
