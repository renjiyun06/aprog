---
name: design
version: 0.4.0
kind: application
description: |
  Designs websites, mobile prototypes, hi-fi mockups, slide decks,
  single-page artifacts, and media outputs (image / video / audio).
---

# design

```yaml
name: design
version: 0.4.0
kind: application

depends_on:
  - skill: state
    note: MUST be loaded first. The state skill defines ${EXEC}, meta.yml, input.md, execution-state/, state.yaml, input_cursor, and resume.
  - skill: live-annotate
    note: |
      Provides the preview-server + overlay + draft/commit pipeline used by the
      designing phase. Its SKILL.md defines server invocation, endpoints, and
      drain_procedure.

paths:
  EXEC:  ~/.aprog/<execution-id>/
  SKILL: <directory holding this SKILL.md>

output:
  serve_via:
    provider: live-annotate
    component: preview-server

state_schema:
  - { key: brand-brief,            storage: by-ref, content_type: markdown, description: accumulating brand/intent/audience (written across discovery) }
  - { key: discovery-notes,        storage: by-ref, content_type: markdown, description: scratch of open axes / observations (discovery) }
  - { key: selected-template,      storage: inline,                          description: single design-template name — the shape (selecting; required by designing) }
  - { key: selected-design-system, storage: inline,                          description: single design-system name — the brand (selecting; required by designing) }
  - { key: selected-craft,         storage: inline,                          description: opted-in craft rule names — list of strings (selecting) }
  - { key: output-dir,             storage: inline,                          description: absolute path where artifacts go (selecting; required by designing) }
  - { key: target-screens,         storage: inline,                          description: screens / artifacts to produce — list of strings (designing) }
  - { key: produced-files,         storage: by-ref, content_type: markdown, description: current files on disk as a markdown table; rewritten on add/replace/remove (designing) }
  - { key: current-revision,       storage: inline,                          description: iteration identifier (designing) }
  - { key: design-decisions,       storage: by-ref, content_type: markdown, description: major choices + rationale; append-only prose log (designing) }

resources:
  overview: |
    design ships with a bundled resource library under ${SKILL}/resources/.
    Four categories of building blocks, each with a different role in the
    final artifact and a different binding to the project. The skill never
    invents a brand or a layout from scratch — it composes one by picking
    from this library at the selecting phase, then loading the picks into
    working memory at designing.
  root: ${SKILL}/resources/
  list_command: ${SKILL}/scripts/list-resources <category>
  categories:
    - { name: design-templates, role: SHAPE of the deliverable (deck, multi-page site, mobile prototype, ...), cardinality: 1 per project,     bound_at: selecting }
    - { name: design-systems,   role: BRAND VOICE (tokens, components, prose voice),                            cardinality: 1 per project,     bound_at: selecting }
    - { name: craft,            role: universal HYGIENE rules (typography, color contrast, anti-AI-slop, ...),  cardinality: N (opt-in),         bound_at: selecting }
    - { name: skills,           role: on-demand UTILITIES matched mid-task (live-tweak, screenshot, ...),       cardinality: on-demand,          bound_at: matched at designing, never pre-selected }
  cardinality_rationale: |
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

    Skills are NOT bound at project level. They are matched on-demand
    during designing when an event or user request triggers them.
    Their indices are loaded into memory in selecting (so matching can
    happen the moment designing starts), but no skill is "selected"
    up-front. An execution may invoke zero, one, or many.

    So: shape = 1, brand = 1, hygiene = N, skills = on-demand.
  loading_discipline: |
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
          - ${state.brand-brief}
          - ${state.design-decisions}
        b_resource_library:
          why: |
            THIS IS THE SINGLE MOST-OMITTED STEP ON RESUME. READ THIS
            BEFORE TOUCHING ANYTHING.

            Group B lives under ${SKILL}/, NOT under ${EXEC}/. When the
            agent is focused on the execution (meta.yml, input.md,
            execution-state/), it's invisible. The other groups are easy
            to remember:
            - Group A (brand-brief, design-decisions) lives right next
              to meta.yml — obviously relevant.
            - Group C (functional skill index) is small and easy.
            - Group B (DESIGN.md, tokens.css, every craft file,
              template SKILL.md, references/) is the HEAVIEST in pages
              AND the easiest to skip.

            What happens when group B is skipped: the agent reads
            `state.yaml`'s `selected-design-system: kami`, THINKS IT
            REMEMBERS what "kami" looks like, and starts generating.
            The output DRIFTS from the actual brand because the brand
            prose was never loaded — only the name. Same silent failure
            for craft rules and the template scaffold.

            DON'T skip a file because "I already know this brand." YOU
            DON'T. The previous agent's working memory is gone; the new
            agent starts blank. Reading `selected-design-system: kami`
            from state.yaml proves only that "kami" was selected — it
            proves NOTHING about what kami looks like.

            Past failure: an agent resumed execution 260516-pkm1, read
            state.yaml, and produced output that violated the kami
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
            On-demand functional skills bundled under design/resources/skills/
            (e.g. live-tweak, dormant; future utilities) are NOT selected at
            project level — they're matched against on-demand mid-task, when
            an event triggers them. For the match to work, the agent needs
            the INDEX (header info per skill — name + description) in
            working memory. The full body is loaded only when the skill is
            actually invoked.

            Loading the index at selecting (not designing) entry is
            deliberate: by the time the user finishes selecting and the
            first artifacts are generating, on-demand matches can already
            happen. Waiting until designing entry would create a window
            where the agent doesn't yet know what utilities exist.

            NOT IN THIS INDEX: live-annotate. It is a top-level depends_on,
            already loaded — its preview-server is the surface that feeds
            on-demand events into input.md in the first place.
      start_server:
        provider: live-annotate
        component: preview-server
        args: [ ${state.output-dir}, ${EXEC} ]
        bind: 0.0.0.0
        surface_to_user: url
    conflict_precedence:
      rules:
        - on visual tokens, brand wins over craft
        - user input wins over brand and craft (latest input.md entry)
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
      - feedback-inbox processing is delegated to the live-annotate library skill
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

resume:
  recoverable_surface:
    - ${EXEC}/meta.yml
    - ${EXEC}/input.md
    - ${EXEC}/execution-state/
  steps:
    - read meta.yml — note phase, input_cursor, status, state_schema
    - read every input.md entry AFTER input_cursor
    - read ${EXEC}/execution-state/state.yaml; for by-ref keys relevant to the current phase, read their blob files
    - rerun phases.${phase}.on_entry (if defined) — this re-pulls list-resources catalogs, the selected resource library, and re-starts any servers from scratch
    - take action per current phase
    - advance meta.yml.input_cursor only after each input is FULLY reflected
  phase_extras:
    discovery: []
    selecting:
      - on_entry.load_indices already covers the catalog reload; nothing extra
    designing:
      - reconcile state.produced-files with what's actually on disk
      - verify selected-template / selected-design-system / output-dir still valid
      - critical_warning: see phases.designing.on_entry.load.b_resource_library.why
    done:
      - if a new input arrived after done, transition back to designing
```
