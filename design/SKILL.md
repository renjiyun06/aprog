---
name: design
version: 0.3.0
kind: application
description: |
  Designs websites, mobile prototypes, hi-fi mockups, slide decks,
  single-page artifacts, and media outputs (image / video / audio).
---

# design

This skill's body is a **single YAML spec** below. It encodes both the machinery (phases, transitions, state schema, on-entry loads, scripts) AND the judgment (rationale, warnings, philosophy) — the latter live inline as `|` literal-block strings next to the rule they explain. There is no separate docs/ directory; everything you need is in this file.

> **Required first step**: load the `state` skill **before** proceeding.
> This spec is layered on top of the state protocol; every reference to
> `${EXEC}`, `meta.yml`, `input.md`, `state/`, `input_cursor`, and "resume"
> assumes you've already read the state skill.

---

## Spec

```yaml
name: design
version: 0.3.0
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
# server-side state, NOT browser sessionStorage.
# ---------------------------------------------------------------------------
output:
  serve_via: ${SKILL}/scripts/preview-server
  forbidden_fallbacks:
    - "python3 -m http.server"   # cannot inject overlay JS or accept POST
  why: |
    The skill mandates serving artifacts via the preview-server, not a
    generic static server. Three reasons:

    1. Overlay injection — the preview-server injects an in-page overlay
       script that lets the user click-to-annotate any element. Without
       it the live-feedback loop has no UI surface.
    2. Server-side draft storage — pending annotations live as JSONL on
       the server in ${EXEC}/state/feedback-draft, NOT in the browser.
       So: drafts survive tab close, are visible across browsers / tabs
       / collaborators (refresh = sync), and the agent can read drafts
       as a regular state KV BEFORE the user commits. Static servers
       cannot offer this.
    3. Atomic commit — POST /commit atomically drains the draft into
       state/feedback-inbox (the agent-facing queue), appends a new
       input-NNN entry to input.md, and clears the draft. The atomicity
       (file rename + in-process mutex) prevents the loss/duplication
       race when two browsers commit simultaneously.

    The preview-server bridges two worlds: the browser (rich UI surface)
    and input.md (the protocol's serial instruction stream). The
    two-stage draft → commit design lets the user think in the browser
    at their pace, then send a coherent batch when ready.

    Tweak mode (click-to-edit CSS) is hidden in the current overlay;
    the modal and /tweak endpoint are preserved dormant in case the
    workflow returns.

  flow:
    - user clicks an element in the browser → comment saved to state/feedback-draft
    - drafts are mutable from any browser (delete, add, see others' pending)
    - Send batch → POST /commit → server drains draft into state/feedback-inbox, appends a new input-NNN entry to input.md, clears the draft

  endpoints:
    - { method: GET,    path: /draft,              returns: "{ feedback: Comment[] }" }
    - { method: POST,   path: /draft/feedback,     body: "{ url, selector, comment }", returns: "{ ok, id, count }" }
    - { method: DELETE, path: /draft/feedback/:id, returns: "{ ok, count }" }
    - { method: DELETE, path: /draft,              returns: "{ ok }" }
    - { method: POST,   path: /commit,             returns: "{ ok, accepted, input_id }" }

# ---------------------------------------------------------------------------
# State KV schema. Each row is a file under ${EXEC}/state/ — the filename
# IS the key. `format` is for humans; the protocol stores raw bytes.
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

cardinality:
  template: 1   # exactly one design-template per project
  design_system: 1
  craft: N      # opt into many; they combine
  why: |
    The asymmetry is intentional.

    A design-template defines the SHAPE of the deliverable (a deck is
    not a multi-page site). A project that needs two shapes (deck AND
    mobile prototype) should be SPLIT INTO TWO EXECUTIONS. One project
    = one shape. Mixing shapes inside one Execution produces incoherent
    output and complicates the FSM (which produced-files entry belongs
    to which shape?).

    A design-system defines the BRAND VOICE. Two brand voices in one
    project means the project doesn't have a brand — it has two.
    Reconcile or split.

    Craft rules are universal hygiene (typography, color contrast,
    anti-AI-slop). They naturally combine. Opting into "tight
    typography" AND "WCAG contrast" AND "anti-slop visuals" together is
    not a contradiction — it's three orthogonal disciplines layered on
    the same artifact.

    So: shape = 1, brand = 1, hygiene = N. The spec encodes this with
    `required: true` on the singular fields and a plain list for craft.

# ---------------------------------------------------------------------------
# Resource loading discipline — recurs across phases. The discipline is:
#   INDICES are loaded WHOLE; BODIES are loaded ON DEMAND.
# Specific phase rules below honor this.
# ---------------------------------------------------------------------------
resource_loading_discipline: |
  - INDICES (frontmatter / header info from list-resources) are loaded
    WHOLE. When the spec says `run: ${SKILL}/scripts/list-resources
    <category>`, consume the ENTIRE output. Piping through head, tail,
    grep, or awk produces a silent partial index — matches against it
    silently miss entries. See `phases.selecting.on_entry.constraints`
    for the consequence.
  - BODIES (full SKILL.md / DESIGN.md / craft files) are loaded ON
    DEMAND. Reading them upfront wastes context. Read only the
    candidates you're proposing or invoking. Exception: the SELECTED
    template and design-system are read in full at designing entry —
    they're the working memory for generation (see
    `phases.designing.on_entry.load.b_resource_library`).

# ---------------------------------------------------------------------------
# FSM. The state protocol does NOT prescribe phase names; each program
# defines its own and writes the current phase to meta.yml.phase.
# ---------------------------------------------------------------------------
phases:

  discovery:
    goal: build a substantive brief — brand, intent, audience, artifact kind
    principles: |
      Discovery is NOT a form fill. The form-fill instinct produces
      shallow briefs that lock in the wrong direction. Six principles:

      - One question at a time. Multi-part questions overwhelm and
        produce shallow answers. If you find yourself writing two
        sentences both ending in a question mark, you've already failed.
      - Open before closed. Ask "what feeling should visitors leave
        with?" before "blue or green?" Closed questions narrow too fast
        and miss the axis that actually matters.
      - Reference over description. "Show me a site you like" beats
        "describe your aesthetic." Most people can recognize a fit
        better than they can articulate one.
      - Constraints surface uncertainty faster than goals. Ask "what
        won't work here?" — the answer reveals the design space's edges
        faster than asking what WILL work.
      - No premature commitment. Don't suggest skills, design systems,
        or even a direction until the brief is substantial. Suggesting
        too early biases the user into agreeing with you instead of
        discovering what they actually want.
      - Return to discovery anytime. Even mid-designing, surfacing a
        missing axis beats charging forward on assumption. The phase
        you're in is a hint, not a prison.
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
      constraints: |
        Consume FULL output of every list-resources run. Do NOT pipe
        through head / tail / grep / awk. Do NOT truncate.

        Why this is a hard prohibition:

        The list-resources script is the agent's ONLY complete catalog
        of what's available — both for proposing candidates here in
        selecting AND for matching on-demand utilities later in
        designing.

        If you pipe through head -50, grep some-keyword, or any filter,
        the in-memory catalog is SILENTLY INCOMPLETE. The agent will
        later try to match a user request against it, fail to find the
        right entry, and either (a) fabricate one, (b) fall back to a
        wrong second choice, or (c) tell the user "no such skill
        exists." All three are SILENT FAILURES; none surface to the
        user as "I truncated the catalog and don't actually know."

        Past failure: an agent loaded only the first 30 lines of
        `list-resources skills`, then when the user asked for a
        screenshot utility, said no such skill existed. The screenshot
        skill was on line 47.
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
          why: |
            THIS IS THE SINGLE MOST-OMITTED STEP ON RESUME. READ THIS
            BEFORE TOUCHING ANYTHING.

            Group B lives under ${SKILL}/, NOT under ${EXEC}/. When the
            agent is focused on the execution (meta.yml, input.md,
            state/), it's invisible. The other groups are easy to
            remember:
            - Group A (brand-brief, design-decisions) lives right next
              to meta.yml — obviously relevant.
            - Group C (functional skill index) is small and easy.
            - Group B (DESIGN.md, tokens.css, every craft file,
              template SKILL.md, references/) is the HEAVIEST in pages
              AND the easiest to skip.

            What happens when group B is skipped: the agent reads
            `state/selected-design-system: kami`, THINKS IT REMEMBERS
            what "kami" looks like, and starts generating. The output
            DRIFTS from the actual brand because the brand prose was
            never loaded — only the name. Same silent failure for craft
            rules and the template scaffold.

            DON'T skip a file because "I already know this brand." YOU
            DON'T. The previous agent's working memory is gone; the new
            agent starts blank. Reading `state/selected-design-system:
            kami` proves only that "kami" was selected — it proves
            NOTHING about what kami looks like.

            Past failure: an agent resumed execution 260516-pkm1, read
            state KVs, and produced output that violated the kami
            brand's strict 12-column grid. Group B never re-read. The
            user caught it on the next preview round, not the agent.

            Re-read EVERY file below on EVERY entry, including resume.
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
          why: |
            Functional skills (live-annotate, future on-demand
            utilities) are NOT selected at project level — they're
            matched against on-demand mid-task, when an event triggers
            them (e.g., preview-server writes an inbox entry).

            For the match to work, the agent needs the INDEX (header
            info per skill — name + description) IN WORKING MEMORY.
            The full body is loaded only when the skill is actually
            invoked.

            Loading the index at selecting (not designing) entry is
            deliberate: by the time the user finishes selecting and the
            first artifacts are generating, on-demand matches can
            already happen (a tweak might arrive seconds after first
            preview). Waiting until designing entry would create a
            window where the agent doesn't yet know what utilities
            exist.
      start_server:
        cmd: ${SKILL}/scripts/preview-server ${state.output-dir} ${EXEC}
        bind: 0.0.0.0
        surface_to_user: url
    conflict_precedence:
      rules:
        - brand > craft         # on visual tokens
        - user_input > all      # latest input.md entry wins everything
      why: |
        The order is NOT a moral hierarchy — it's a SPECIFICITY
        hierarchy. More specific evidence wins.

        Brand > craft on visual tokens: if the active brand defines
        `--text-display: 1.6rem` and a craft rule says "headings ≥
        2rem for hierarchy clarity," brand wins. The brand is more
        specific (it knows THIS brand voice); craft is generic hygiene
        (applies across all brands).

        User input > everything: if the user dialed `font-size:
        1.2rem` on a heading via live-tweak, that wins over both
        brand and craft. Their tweak is the most recent, most
        specific signal.

        Where this gets tricky: a tweak that contradicts the brand
        should be APPLIED (per the rule) but FLAGGED in
        design-decisions. Future agents reading the decision log should
        see "user overrode brand on element X — likely intentional but
        worth a sanity-check." Keep the rule clean (user input always
        wins, no waffle) while preserving an audit trail.
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
    notes: |
      The FSM is forgiving by design. `done` is a checkpoint, not a
      vow. A "finished" project that gets a new request just re-enters
      designing. Similarly, designing can call back into discovery work
      informally — if a new axis surfaces (e.g., "actually we also need
      a mobile version"), pause generation, capture into brand-brief,
      then resume. Phases are checkpoints, not gates.

# ---------------------------------------------------------------------------
# Resume contract. Phase-aware. designing is the heaviest because the
# skill's resource library must be re-pulled into context. See
# `phases.designing.on_entry.load.b_resource_library.why` for the warning
# in full; the gist:
#
#     The previous agent's memory is gone. Re-read EVERY file in group
#     B. Don't trust the in-context names of brand/template/craft.
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
          - rerun phases.designing.on_entry.load (groups A, B, C)
          - rerun phases.selecting.on_entry.load_indices.skills (the functional skill index)
          - restart preview-server (the previous instance is gone)
          - reconcile state.produced-files with what's actually on disk
          - verify selected-template / selected-design-system / output-dir still valid
          - critical_warning: see phases.designing.on_entry.load.b_resource_library.why
    - take action per current phase
    - advance meta.yml.input_cursor only after each input is FULLY reflected
```

---

## Legacy

The previous prose-form spec is preserved at `SKILL.legacy.md` for reference. Both forms encode the same contract; this YAML-bodied form is the source of truth going forward.
