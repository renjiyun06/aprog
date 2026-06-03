---
name: shape
version: 0.2.0
kind: application
description: |
  Collaboratively shape a fuzzy product vision into a structured brief —
  vision, business modules, business processes, and key-process details.
  Output is a browseable, commentable single-page document; not code, not
  design. Hands off downstream to design / engineering skills.
---

# shape

```yaml
name: shape
version: 0.2.0
kind: application

depends_on:
  - skill: state
    note: MUST be loaded first. The state skill defines ${EXEC}, meta.yml, input.md, execution-state/, state.yaml, input_cursor, and resume.
  - skill: live-annotate
    note: |
      Provides the preview-server + overlay + draft/commit pipeline. Its
      SKILL.md defines server invocation, endpoints, and drain_procedure.

paths:
  EXEC:  ~/.aprog/<execution-id>/
  SKILL: <directory holding this SKILL.md>

purpose: |
  shape turns a fuzzy product vision into a structured brief that downstream
  skills (design, engineering) can act on. The decomposition is a four-level
  tree:

    1. Vision         — what the product is, for whom, why now, success signal
    2. Modules        — major slices (typically by role or by domain)
    3. Processes      — end-to-end business flows per module
    4. Details        — for CRITICAL processes only: actors, trigger, steps,
                        state machine, data points, business rules, exceptions

  Detail STOPS at state machine + data + rules. Field schemas, API contracts,
  UI mockups, and code belong to downstream skills.

  shape is NOT:
    - a "should we build it?" investor pitch
    - a design / mockup tool
    - an engineering plan / architecture review
    - a one-shot form-fill. It's a multi-turn collaborative walk.

output:
  serve_via:
    provider: live-annotate
    component: preview-server

  canonical:
    where: ${EXEC}/execution-state/
    why: |
      The canonical brief is the structured state. The HTML is a view;
      state is the source of truth. Edit state, then regenerate the
      HTML — never the other way round.

  render:
    inputs:
      - ${EXEC}/execution-state/state.yaml + the by-ref blobs it points to (vision, details.*)
      - ${SKILL}/resources/render-templates/${state.render-template}/SKILL.md
      - ${SKILL}/resources/render-templates/${state.render-template}/example.html
    output: ${state.output-dir}/index.html
    when:   on every state write that should be visible to the user
    how: |
      No transformer script. The agent READS state.yaml + its by-ref
      blobs + the chosen render-template's SKILL.md + example.html, then
      WRITES a single HTML page to output. The template's SKILL.md is
      the authority on visual signature and layout; shape just supplies
      the content (vision / modules / processes / details).

state_schema:
  - { key: vision,          storage: by-ref, content_type: markdown,                                                                description: "macro vision — problem, target users, value, success signal (vision phase; required)" }
  - { key: vision-notes,    storage: by-ref, content_type: markdown,                                                                description: "scratch of open axes / observations (vision phase)" }
  - { key: modules,         storage: inline,                                                                                         description: "list of business modules: id, name, owner-role, purpose, in-scope, out-of-scope (modules phase; required)" }
  - { key: processes,       storage: map,    key_pattern: <module-id>,  value_storage: inline,                                       description: "per module: list of processes with id, name, purpose, criticality (1-3), cross-refs (processes phase; required)" }
  - { key: details,         storage: map,    key_pattern: <process-id>, value_storage: by-ref, value_content_type: markdown,         description: "per critical process: actors, trigger, steps, state machine, data points, rules, exceptions, cross-refs (details phase)" }
  - { key: coverage,        storage: inline,                                                                                         description: "queue: which processes are detailed / deferred / skipped, with rationale (details phase; mutable)" }
  - { key: render-template, storage: inline,                                                                                         description: "name of resources/render-templates/<name>/ to use; one of pm-spec | doc-kami-parchment | docs-page | deck-simple; default pm-spec (vision phase)" }
  - { key: output-dir,      storage: inline,                                                                                         description: "absolute path where rendered HTML goes (vision phase; required)" }
  - { key: decisions,       storage: by-ref, content_type: markdown,                                                                description: "key clarification decisions with rationale; appended as we go (any phase; append-only)" }

resources:
  overview: |
    shape's resource library is initially EMPTY. Patterns are HARVESTED
    over time at the review phase, then become available in future
    executions. There is no pre-shipped seed — every entry grew out of a
    real execution that promoted it.
  root: ${SKILL}/resources/
  list_command: ${SKILL}/scripts/list-resources <category>
  categories:
    - { name: product-patterns,   role: broad product shapes (marketplace / subscription / SaaS / 工单 / ...) }
    - { name: module-recipes,     role: reusable business module designs (优惠券 / 积分 / 订单生命周期 / ...) }
    - { name: process-templates,  role: reusable process skeletons (下单 / 退款 / 对账差异处理 / ...) }
    - { name: role-cards,         role: role + concerns templates (消费者 / 加盟商 / 客服 / 运营 / 财务 / ...) }
    - { name: checklists,         role: cross-cutting checks (状态机闭环 / 金钱双闭环 / ...) }
    - { name: principles,         role: macro principles ("金钱流必须双闭环" / ...) }
    - { name: render-templates,   role: HTML presentation styles for the brief; each a folder with SKILL.md + example.html (currently pm-spec, doc-kami-parchment, docs-page, deck-simple) }
    - { name: skills,             role: on-demand utilities bundled here, each a folder with SKILL.md }
  loading_discipline: |
    - INDICES (from list-resources) are loaded WHOLE. Do NOT pipe through
      head / tail / grep / awk. A partial index produces silent failures —
      the agent will later try to match a user request against it, miss,
      and either fabricate, fall back wrong, or claim no such resource
      exists. None of these surface as "I truncated the catalog."
    - BODIES (full pattern / recipe / template / principle files) are
      loaded ON DEMAND. Read the body only when proposing or applying it.
    - Resource library starts EMPTY by design. shape graduates patterns
      through use (see phases.review.harvest). Do NOT fabricate resources
      that aren't in the library — propose decompositions from first
      principles and let the user promote them.

walk:
  mode: user-driven BFS-then-DFS
  rule: |
    The first three phases walk BREADTH-FIRST: pin the vision, then
    enumerate ALL modules, then enumerate ALL processes under each
    module. Only at the details phase does the walk go DEPTH-FIRST,
    and only into processes the user picks.

    Why BFS first: pinning the whole map before drilling lets the user
    see the territory and notice if a whole module / process is
    missing. DFS-first feels more productive in the moment but routinely
    misses big gaps (a module that nobody mentioned, a process that
    spans modules and belongs to neither).

    Why user-driven DFS: not every process is critical. Detailing every
    process to state-machine level is busy-work and dilutes attention.
    The user (or the criticality score assigned in the processes phase)
    decides which processes deserve detail. The rest are deferred or
    skipped, logged in the coverage key with rationale.

  deferral: |
    The coverage key tracks every process from the processes phase with one of:
      - detailed       — has a `details.<process-id>` blob
      - deferred       — explicitly punted for later (rationale required)
      - skipped        — explicitly out of scope (rationale required)
      - todo           — not yet decided (default after processes phase)

    The details phase can transition to review only when coverage has
    no `todo` entries — every process must be classified, even if the
    classification is "skipped".

phases:

  vision:
    goal: pin macro vision — problem, target users, value, success signal
    principles: |
      Vision is the seed of the whole tree. Wrong vision → wrong modules →
      wrong processes → wasted detail work. Five principles:

      - One question at a time. Multi-part questions overwhelm and
        produce shallow answers. If you find yourself writing two
        sentences both ending in a question mark, you've already failed.
      - Force a named user. "Everyone" / "users" / "businesses" is not
        a target — it's filler. Push for a role + context (e.g.
        "店主的店员在打烊后对账" not "用户使用对账功能").
      - Force a concrete pain. "Convenient" / "efficient" / "modern" is
        not a value prop. Push for "without X, the user has to Y, which
        costs Z." If Z can't be stated, the pain is hypothetical.
      - Success signal must be observable. "Users like it" is not a
        signal — "店主每周至少打开一次对账页且对账差异 ≤ 1%" is.
      - No premature modules. Don't start naming C端/B端/M端 until the
        vision has substance. Suggesting modules too early biases the
        decomposition.
    behavior:
      - ask one open question at a time
      - cover over time: problem, target user(s) with role + context, value, success signal, hard constraints
      - each user reply should narrow the space or surface a new unanswered axis
      - choose render-template once the kind of project is clear (default pm-spec; alternatives doc-kami-parchment / docs-page / deck-simple)
    writes: [vision, vision-notes, render-template, output-dir]
    transitions:
      - to: modules
        when: |
          vision covers: stated problem, at least one named target user with role+context,
          value prop tied to a concrete pain, and an observable success signal;
          output-dir exists on disk.

  modules:
    goal: enumerate business modules (BFS layer 1)
    on_entry:
      load_indices:
        - run: ${SKILL}/scripts/list-resources product-patterns
          why: known product patterns may suggest a module decomposition
        - run: ${SKILL}/scripts/list-resources role-cards
          why: role cards inform per-side modules (C端 / B端 / M端 …)
      constraints: |
        Consume FULL output of every list-resources run. Do NOT pipe
        through head / tail / grep / awk. (Same hard rule as
        aprog/design.)
    principles: |
      - Pick ONE decomposition axis at this level. The two common axes
        are BY ROLE (C端/B端/M端/客服端) and BY DOMAIN (订单/商品/会员/
        营销/财务). Don't mix axes at the same level — it produces
        overlapping modules that hide gaps.
      - Each module must trace to the vision. If a proposed module can't
        be tied to a piece of the vision, either drop it or surface a
        gap in the vision (and revisit vision phase).
      - In-scope / out-of-scope is part of the module definition, not
        an afterthought. "What this module does NOT include" matters as
        much as what it does.
    behavior:
      - propose a module decomposition with rationale for the axis chosen
      - each module entry has: id (kebab-case), name, owner-role, purpose, in-scope, out-of-scope
      - ask user to confirm / amend before moving on
    writes: [modules]
    transitions:
      - to: processes
        when: |
          every named target user from vision is served by ≥1 module;
          every module has owner-role + purpose + in/out-of-scope filled;
          user confirms decomposition.

  processes:
    goal: enumerate end-to-end processes per module (BFS layer 2)
    on_entry:
      load_indices:
        - run: ${SKILL}/scripts/list-resources process-templates
          why: known process skeletons (下单, 退款, 对账, 实名认证 …) may inform decomposition
      constraints: |
        Consume FULL output. Do NOT pipe through head/tail/grep/awk.
    principles: |
      - Process boundaries are end-to-end, not screen-by-screen. "用户
        下单" is a process; "选择商品页" is a screen. A process spans
        screens, actors, time, and possibly side effects (notifications,
        ledger entries).
      - Cross-module processes get a primary module owner + listed as
        a cross-ref on the other modules. Don't duplicate.
      - Criticality (1=critical / 2=important / 3=low-stakes) is assigned
        here, not in details. Critical = involves money, state changes
        with downstream effects, SLA, compliance, or recovery from
        failure. Important = routine but non-trivial. Low-stakes = nice-
        to-have / static / read-only.
      - Telling the user up front "criticality 1 will be detailed; 2-3
        may be deferred" calibrates expectations — and lets them push
        back if they think something is mis-scored.
    behavior:
      - walk the modules; for each, propose processes with id, name, one-line purpose, criticality, cross-refs
      - id pattern: <module-id>.<process-slug>, e.g. c-side.order
      - confirm criticality scores with the user (one ask per module, not per process)
      - initialize coverage with every process as `todo`
    writes: [processes.<module-id>, coverage]
    transitions:
      - to: details
        when: |
          every module has ≥1 process listed;
          every process has a criticality score;
          coverage seeded with `todo` for all.

  details:
    goal: detail critical processes (user-driven DFS, BFS done)
    on_entry:
      start_server:
        provider: live-annotate
        component: preview-server
        args: [ ${state.output-dir}, ${EXEC} ]
        bind: 0.0.0.0
        surface_to_user: url
      render: regenerate ${state.output-dir}/index.html per output.render
      load_indices:
        - run: ${SKILL}/scripts/list-resources module-recipes
          why: reusable modules (优惠券, 积分, 订单生命周期 …) may apply
        - run: ${SKILL}/scripts/list-resources skills
          why: |
            Optional on-demand utilities bundled under resources/skills/.
            Empty in v0.1 (live-annotate is a top-level library, not bundled
            here). Future on-demand skills will surface through this index.
    principles: |
      Detail covers: actors, trigger, steps, state machine, data points,
      business rules, exceptions, cross-references. NO further than
      that — no API endpoints, no field schemas, no UI mockups.

      Why the ceiling: shape's output is a brief that downstream skills
      (design, engineering) act on. Going deeper here forces shape to
      make decisions that belong to those downstream skills, and locks
      them in before they have the right context. Stop one level above
      the schema.

      Walking discipline:
      - Show user the unaddressed-critical queue from coverage every
        round. Don't ask "which next?" in the abstract — ask from a
        concrete list.
      - One process per round. Resist the urge to batch-detail.
      - After detailing, ask user to walk the rendered page in the
        browser — the rendered tree is the natural review surface.
      - Comments dropped via the preview overlay land in the
        feedback-inbox; process them as input-NNN entries
        (see live-annotate semantics).
    behavior:
      - regenerate ${state.output-dir}/index.html per output.render on entry and after each detail write
      - surface the preview URL once on entry; on every subsequent round, remind only if the user seems unaware
      - propose detailing the highest-criticality `todo` process; user may pick another, defer, or skip
      - write details.<process-id> (markdown blob) with the full schema below; update coverage
      - watch feedback-inbox for new comments; process each as input arrives
    detail_schema: |
      Each details.<process-id> markdown blob MUST cover:

      ## Actors
        which roles touch this process; primary actor first.

      ## Trigger
        what event/condition kicks it off (user action, scheduled job,
        upstream event, error condition).

      ## Steps
        numbered, with branch points called out. Branches reference
        sub-numbered alternatives, not a separate flow.

      ## State Machine
        states + transitions. ASCII state diagram OR YAML
        { states: [...], transitions: [{from, to, on, guard?}] }.
        Closed (every state has a way out OR is terminal).

      ## Data Points
        key data items + their owners (which module/table is source of
        truth). NOT field schemas — just "the order's status field
        owned by module c-side.order" level.

      ## Business Rules
        constraints, validations, calculations expressed as rules,
        NOT code. e.g. "退款金额 ≤ 原订单实付金额 − 已退款金额".

      ## Exceptions
        failure modes + handling. Each exception names: what fails,
        who notices, what the user sees, what the system does.

      ## Cross-References
        - depends-on: <process-id> — what this process needs that
          another process produces
        - unblocks: <process-id> — what this process produces that
          another process needs
    writes: [details.<process-id>, coverage, decisions]
    transitions:
      - to: review
        when: |
          coverage has no `todo` entries (every process is classified
          as detailed / deferred / skipped, with rationale);
          user signals "we have enough detail to hand off".

  review:
    goal: consistency + completeness pass; harvest reusables
    on_entry:
      load_indices:
        - run: ${SKILL}/scripts/list-resources checklists
          why: cross-cutting checks applicable here
        - run: ${SKILL}/scripts/list-resources principles
          why: macro principles to verify against
    passes:
      consistency: |
        Walk the tree and check:
        - vision traceability: every module ties back to vision
        - module coverage: every named target user from vision is served
        - process closure: every state machine in details has all
          states reachable and every non-terminal state has ≥1 outgoing
          transition
        - cross-ref closure: every `depends-on` resolves to an existing
          process; every `unblocks` is reflected in the target's
          `depends-on`
        - money / state double-loop: every process that moves money or
          state has a corresponding rollback / compensation / reconciliation
          process somewhere in the tree (or is explicitly waived in
          decisions with rationale)
        - exception coverage: every detail's exceptions section is
          non-empty (a process with no exceptions modeled is suspect)
        Flag every violation as a finding and surface one at a time.
      harvest: |
        After consistency passes, ask the user — ONE category at a time
        — whether anything from this execution is worth promoting to
        the library:

          1. product-patterns — the overall product shape (marketplace /
             订阅 / SaaS / 工单 / 团购 / ...)
          2. module-recipes — reusable module designs (优惠券 / 积分 /
             订单生命周期 / 实名认证 / 风控 / 对账 / 退款 …)
          3. process-templates — reusable process skeletons (下单 /
             退款 / 退货 / 补单 / 对账差异处理 …)
          4. role-cards — role + concerns templates (消费者 / 加盟商 /
             客服 / 运营 / 财务 / 风控 …)
          5. checklists — cross-cutting checks (状态机闭环 / 金钱双闭环
             / 异常路径覆盖 …)
          6. principles — macro principles ("金钱流必须双闭环" / "每个
             角色都要有它能干什么的清单" …)
          7. render-templates — HTML rendering styles for the brief

        For each promotion: choose category, propose a name (kebab-case),
        write the file to ${SKILL}/resources/<category>/<name>.md with
        a frontmatter block:

          ---
          name: <name>
          version: 0.1.0
          source_execution: <exec-id>
          source_date: <YYYY-MM-DD>
          rationale: <one-sentence why this is worth keeping>
          ---

        Append the promotion to the decisions key for traceability.
        Promotions are append-only to the library; if a similar
        resource exists, propose an update (with version bump) rather
        than a duplicate.
    behavior:
      - run consistency pass, surface findings one-at-a-time, write fixes to state
      - run harvest pass, one category at a time, write promoted resources to library
      - update decisions with all promotions
    writes: [decisions, "resources/<category>/<name>.md (under ${SKILL})"]
    transitions:
      - to: done
        when: |
          consistency pass has no open findings;
          harvest pass complete (user has confirmed for every category);
          user signs off.

  done:
    goal: terminal — brief is ready to hand off
    on_entry:
      write_meta:
        status: completed
      message_to_user: |
        Brief saved to ${state.output-dir}/index.html and canonical
        state under ${EXEC}/execution-state/. Downstream skills
        (aprog/design, engineering) can read both. Use meta.yml +
        execution-state/ to resume or fork.

resume:
  recoverable_surface:
    - ${EXEC}/meta.yml
    - ${EXEC}/input.md
    - ${EXEC}/execution-state/
  steps:
    - read meta.yml — note phase, input_cursor, status, state_schema
    - read every input.md entry AFTER input_cursor
    - read ${EXEC}/execution-state/state.yaml; resolve every by-ref key relevant to the current phase (vision, decisions, details.*)
    - rerun phases.${phase}.on_entry (if defined) — re-pulls list-resources catalogs, re-renders, restarts the preview-server from scratch
    - always re-read the FULL state tree (vision + modules + all processes + all details). The brief's whole structure is the agent's working memory — partial recall produces inconsistent decompositions.
    - take action per current phase
    - advance meta.yml.input_cursor only after each input is FULLY reflected
  phase_extras:
    vision:    []
    modules:   []
    processes: []
    details:
      - re-render to ${state.output-dir} (the rendered HTML is not preserved across restarts)
      - re-surface the preview URL
    review:    []
    done:      [if a new input arrived after done, transition back into details]
  group_b_reminder: |
    Mirror of design's Group B trap, lighter here because shape's
    resources start empty. As the library grows, the same discipline
    applies: when resuming with a non-empty library, the agent must
    actually READ the relevant resource bodies before applying them,
    not just see them in the index and assume.
```
