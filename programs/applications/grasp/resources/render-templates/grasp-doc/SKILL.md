---
name: grasp-doc
description: |
  Clean four-section doc layout for the grasp livedoc — Survey, Concepts,
  Flows, Mechanisms[]. Long-read, annotatable, accumulative. The single
  template grasp ships with in v0.1.0.
---

# grasp-doc

```yaml
name: grasp-doc
description: project-understanding livedoc

intent: |
  A long-read, document-feel single page where the user can sit with a
  project's mental model and add questions inline. Optimized for reading
  paragraphs and snippets, NOT for skimming a dashboard.

layout:
  header:
    role: project metadata bar
    fields: [project-name, project-head (short sha), grasped-at, phase pill]
  toc:
    role: sticky left rail
    items:
      - Survey
      - Concepts
      - Flows (list)
      - Mechanisms (list, grows as user asks)
  main:
    order: [survey, concepts, flows, mechanisms]
    survey:
      structure: one prose section with subsections — Stack, Layout, Services, External deps, Entry points
      style: prose paragraphs + small tables
    concepts:
      structure: card grid, 2-3 columns
      card_fields: [id, term, definition (1 line), relates-to (chips)]
    flows:
      structure: vertical stack, one card per flow
      card_fields: [id, name, trigger, sequence (numbered with file:line citations), outcome]
    mechanisms:
      structure: vertical stack, one card per mechanism, appended as user asks
      card_fields:
        - "What it is — one paragraph"
        - "How it works — sequence / pseudocode anchored in file:line"
        - "Where it lives — files + key functions"
        - "Caveats — non-obvious constraints, footguns, version notes"

anchor_convention: |
  Every annotatable element carries a data-grasp-node attribute keyed to
  state. This lets live-annotate comments map back to which piece of
  understanding the user is questioning.

  - data-grasp-node="header"                  project metadata
  - data-grasp-node="survey"                  whole survey section
  - data-grasp-node="survey.<subsection>"    optional fine-grained
  - data-grasp-node="concepts.<id>"           a single concept card
  - data-grasp-node="flows.<id>"              a single flow card
  - data-grasp-node="mechanisms.<id>"         a single mechanism card

visual_signature:
  palette:
    bg:         "#fafaf7"        # warm off-white
    surface:    "#ffffff"        # cards
    ink:        "#1f2328"        # body text
    muted:      "#6b7280"        # secondary
    accent:     "#7c3aed"        # subtle violet, for active toc / accents
    border:     "#e5e7eb"
    code-bg:    "#0f1419"
    code-ink:   "#e6e1cf"
  type:
    body:   "ui-serif, 'Source Serif Pro', 'Noto Serif SC', serif"
    head:   "ui-sans-serif, 'Inter', system-ui"
    mono:   "ui-monospace, 'JetBrains Mono', 'SF Mono', monospace"
  rhythm:
    body_size:  17px
    body_lh:    1.7
    h2:         28px
    h3:         20px
    section_gap: 64px
  ornaments:
    section_rule: "hairline 1px solid var(--border) under each h2"
    mechanism_card: "left 3px accent bar"
    flow_step_number: "monospace circle, ink on warm-100"
    code_block: "dark, no shadows, 4px left padding gutter"
    tables: "horizontal lines only, no vertical"

generation_rules: |
  - agent READS state.yaml + by-ref blobs and WRITES one HTML file. No
    transformer script.
  - All content originates in state. Do NOT introduce facts in the HTML
    that are not in state — that desynchronizes the source of truth.
  - Cited file:line references render as inline <code> with the path,
    optionally a github-style link if state knows the repo URL.
  - mechanisms[] is appended in order of state.mechanisms map (which the
    agent maintains in insertion order).
  - Phase pill shows current ${meta.phase}. After 'done', show "done".
  - The page is server-rendered once per state write. live-annotate
    overlay is injected by preview-server, not by this template.

inputs:
  state_yaml:      ${EXEC}/execution-state/state.yaml
  by_ref_blobs:    ${EXEC}/execution-state/blobs/
  output:          ${state.output-dir}/index.html

see_also:
  - example.html  # full reference render of this template
```
