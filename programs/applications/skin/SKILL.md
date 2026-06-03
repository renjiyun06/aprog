---
name: skin
version: 0.1.0
kind: application
description: |
  Facial skin analysis application. Takes a three-shot face capture
  (frontal + left + right), runs an image-processing tool catalog over
  it to score each clinical/cosmetic metric, produces a professional
  report, then enters a consultation mode where the user can keep
  asking follow-up questions grounded in the same analysis. Each run is
  an Execution managed by the `state` skill, so consultations resume
  across sessions.
---

# skin

```yaml
name: skin
version: 0.1.0
kind: application

# ---------------------------------------------------------------------------
# Stance
# ---------------------------------------------------------------------------
stance: |
  `skin` is a SHORT-RUNNING application that turns three face photos
  into one analysis bundle (per-metric scores + evidence visualizations
  + a written report), then STAYS OPEN as a consultation surface so the
  user can ask follow-up questions about their report ("why are my
  pores at 45?", "I'm pregnant — which of these can I still use?",
  "what changed since last month?"). The analysis bundle is the durable
  artifact; the consultation transcript is a stream of Q&A grounded in
  that bundle.

  Tools used during analysis live inside this skill (no separate library
  skill). They are not exposed as a public API — they are this app's
  private workshop. Other skills that want to score skin should depend
  on `skin` and call its `analyze` phase, not the tools directly.

depends_on:
  - skill: state
    note: |
      Each `skin` run is an Execution. shots, per-metric scores,
      evidence files, the report, and the consultation history all
      live under ${EXEC}/execution-state/. The state skill defines
      identity, input.md, schema-merge, and resume semantics; this
      skill only declares its own state_schema entries below.

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
paths:
  SKILL:   <directory holding this SKILL.md>
  TOOLS:   ${SKILL}/scripts/tools/         # private image-processing tools
  MODELS:  ${SKILL}/models/                # model weights (face-parsing, acne det)
  EXEC:    ~/.aprog/<execution-id>/

# ---------------------------------------------------------------------------
# Inputs the user supplies
# ---------------------------------------------------------------------------
inputs:
  shots:
    frontal:
      role: primary
      face_yaw: -10° to +10°
      uses: |
        Most metrics default to this shot — overall tone, T-zone oil,
        forehead and glabella wrinkles, eye region, lips, jawline.
    left:
      role: lateral
      face_yaw: -60° to -90°
      uses: |
        Left cheek pores, left nasolabial fold, left crow's feet,
        pre-auricular wrinkles, ear-side pigmentation.
    right:
      role: lateral
      face_yaw: +60° to +90°
      uses: same as left, mirrored.

  required_format:
    color_space:   sRGB, 8-bit
    min_resolution: 1024×1024 short edge
    file_format:   JPEG / PNG / HEIC (decoded to RGB before tools see it)
    face_share:    face bbox ≥ 35% of frame
    no_makeup:     strongly recommended
    no_filter:     beauty filters / smoothing MUST be off
    lighting:      diffuse natural or cool-white indoor; no hard shadow,
                   no warm tungsten

  optional:
    questionnaire: |
      Short user-supplied form (age, sex, pregnancy/lactation, skin
      history, allergies, current routine). Read at the start of
      `consult` and used by the safety rules. The application MAY
      collect it during `intake` or later — but pregnancy/lactation
      MUST be known before any product recommendation is made.
    prior_run_id: |
      A previous skin execution id, used by the delta tool to compute
      change since last visit.

# ---------------------------------------------------------------------------
# Phases (FSM)
# ---------------------------------------------------------------------------
phases:
  - intake
  - analyze
  - report
  - consult
  - done

phase_transitions: |
  intake   → analyze    once all three shots pass quality_check (or the
                        user explicitly waives a rejected shot)
  analyze  → report     once every selected tool has produced its JSON
  report   → consult    once the report blob is written and surfaced
                        to the user
  consult  → consult    while the user keeps asking follow-ups
  consult  → done       on explicit user "we're done" OR after a long
                        idle (caller's choice)

  Any phase MAY transition back to intake if the user uploads new
  shots (e.g. a retake). The application MUST start a fresh analyze
  pass and append the new bundle to the run (the prior one is kept
  for delta).

# ---------------------------------------------------------------------------
# State schema
# ---------------------------------------------------------------------------
state_schema:

  # --- inputs ---
  - key: shots
    storage: map
    key_pattern: <shot-id, e.g. frontal | left | right | frontal-retake-1>
    value_storage: by-ref
    value_content_type: binary
    description: original uploaded images; binary blobs under blobs/shots/.

  - key: questionnaire
    storage: by-ref
    content_type: yaml
    description: user form (age, sex, pregnancy, history, routine, allergies).

  - key: prior_run_id
    storage: inline
    description: previous execution id for delta computation; omit if first run.

  # --- intake ---
  - key: quality
    storage: map
    key_pattern: <shot-id>
    value_storage: inline
    description: |
      Per-shot quality_check result:
      { pass: bool, checks: { sharpness, lighting, face_size, face_yaw,
      no_filter }, reason: <if fail> }.

  # --- analyze ---
  - key: parse
    storage: map
    key_pattern: <shot-id>
    value_storage: by-ref
    value_content_type: binary
    description: |
      Face-parsing output per shot (19-class semantic mask + named
      ROIs). Stored as .npz under blobs/parse/.

  - key: normalized
    storage: map
    key_pattern: <shot-id>
    value_storage: by-ref
    value_content_type: binary
    description: |
      Color-normalized + aligned image per shot. All scoring tools
      read FROM normalized, not the raw upload.

  - key: metrics
    storage: map
    key_pattern: <metric-name, e.g. pores | oil | wrinkles_static | acne | ...>
    value_storage: by-ref
    value_content_type: json
    description: |
      Each tool's JSON output, conforming to the per-metric contract
      (see analysis_output_contract). One file per metric under
      blobs/metrics/.

  - key: evidence
    storage: map
    key_pattern: <metric-name>
    value_storage: by-ref
    value_content_type: binary
    description: |
      Per-metric evidence PNG (mask, overlay, heatmap, bbox image,
      annotated patch). One file per metric under blobs/evidence/.

  - key: safety_flags
    storage: inline
    description: |
      Hard-rule outcomes that the consult phase MUST respect:
      { pregnant: bool, lactating: bool, barrier_compromised: bool,
        gags_moderate_or_above: bool, suspected_pigmented_lesion: bool,
        see_doctor: bool, see_doctor_reasons: [str] }.
      Computed by the safety rule engine after analyze, NOT by an LLM.

  # --- report ---
  - key: report
    storage: by-ref
    content_type: markdown
    description: |
      The user-facing report. Two-voice (Western dimension + TCM
      pattern) when TCM mapping is wired in. Every numeric claim must
      trace to a key in metrics; the report MUST NOT introduce numbers
      not present there.

  - key: report_payload
    storage: by-ref
    content_type: json
    description: |
      Structured form of the same report (radar axes, big-number
      panels, priorities, routine, product tags). Front-end renders
      from this; the markdown is for chat surfaces.

  # --- consult ---
  - key: consultations
    storage: by-ref
    content_type: jsonl
    description: |
      Append-only Q&A log. Each line:
      { id, asked_at, question (user text), referenced_metrics: [...],
        answer (markdown), citations: [metric:..., kb:..., rule:...],
        safety_block_applied: bool }.
      One Q&A per input.md entry after the report. The state skill's
      input_cursor governs which questions have been answered.

# ---------------------------------------------------------------------------
# Tool catalog (PRIVATE — used only inside `analyze`)
# ---------------------------------------------------------------------------
# Tools group into four bands. Callers outside `skin` should NOT invoke
# these directly — depend on skin and call its analyze phase instead.
# ---------------------------------------------------------------------------
tool_catalog:

  preprocessing:
    - tool: quality_check
      band: classical_cv
      input: one image
      does: |
        Reject blurry / badly lit / off-angle / filter-suppressed shots.
      checks:
        - face_present (MediaPipe)
        - face bbox ≥ 35%
        - yaw within shot's declared band
        - variance of Laplacian ≥ threshold (sharpness)
        - std(L*) across face skin ≤ threshold (even lighting)
        - high-frequency suppression detector (no beauty filter)

    - tool: face_parse
      band: learned (BiSeNet, face-parsing.PyTorch)
      input: one image
      does: |
        19-class semantic mask + named ROIs: forehead / glabella /
        nose / l_cheek / r_cheek / chin / l_periorbital /
        r_periorbital / philtrum / upper_lip / lower_lip / jawline.

    - tool: color_normalize
      band: classical_cv
      does: |
        gray-world or shades-of-gray white balance + optional Retinex
        + resample so inter-pupillary distance = 256 px.

    - tool: align_to_canonical
      band: classical_cv
      does: |
        Affine-warp so eyes are horizontal at canonical positions.
        Frontal and lateral shots use different templates.

  classical_cv:
    - { tool: oil_highlight,        metric: oiliness,           algorithm: HSV high-V low-S mask, weighted by T-zone vs U-zone }
    - { tool: pore_blackhat,        metric: pores,              algorithm: black-hat morph + connected components in [3,30] px }
    - { tool: blackhead_blob,       metric: blackheads,         algorithm: SimpleBlobDetector dark+small on nose ROI }
    - { tool: spot_lab_cluster,     metric: pigmentation_spots, algorithm: Lab (L<pct30) AND (b>pct70), CCs ≥ min_area }
    - { tool: redness_a_channel,    metric: redness,            algorithm: a-channel > pct80, Frangi splits linear vs diffuse }
    - { tool: dullness_l_channel,   metric: dullness,           algorithm: 100 - mean(L)*100/255 per region }
    - { tool: uniformity_lab_std,   metric: tone_uniformity,    algorithm: weighted std of L,a,b across skin mask }
    - { tool: ita_fitzpatrick,      metric: skin_type,          algorithm: ITA° = atan((L-50)/b)*180/π → 6 bands }
    - { tool: texture_gabor,        metric: texture_roughness,  algorithm: Gabor energy (4×3) + LBP entropy }
    - { tool: gloss_distribution,   metric: gloss,              algorithm: highlight mask + spatial entropy }
    - { tool: wrinkle_frangi,       metric: wrinkles_static,    algorithm: Frangi vesselness at σ∈[1,3] + skeleton length & depth }
    - { tool: dark_circle_l_diff,   metric: dark_circle,        algorithm: ΔL,Δa,Δb between infraorbital & cheek ROIs + shadow grad → subtype }
    - { tool: lip_color,            metric: lip_state,          algorithm: Lab on lip mask + Frangi for lip fissures }
    - { tool: eyebag_geometry,      metric: eyebag,             algorithm: shadow valley + bulge gradient below lower-lid landmark }

  learned:
    - tool: acne_detect
      metric: acne
      model: YOLOv8 fine-tuned on ACNE04 OR HF `imfarzanansari/skintelligent-acne`
      output_aggregation: |
        per-lesion (bbox, class) → GAGS score (6 regions × grade × weight)
        → severity ∈ {none, mild, moderate, severe, very_severe}
      safety_link: GAGS ≥ 19 sets safety_flags.gags_moderate_or_above = true

    - tool: spot_classify
      metric: pigmentation_type
      model: small CNN OR DermLIP zero-shot
      output: per-spot label ∈ {sunspot, freckle, melasma, cafe_au_lait, PIH, PIE}

    - tool: wrinkle_grade
      metric: glogau_grade
      input: wrinkle_frangi output + age
      model: rule + small classifier → Glogau I–IV

    - tool: skin_age_regress
      metric: skin_age
      input: full face + classical metrics
      model: small regressor (GBM / MLP)
      output: { skin_age, delta_vs_chrono_age }

    - tool: pan_derm_embed
      metric: <feature extractor, not a metric>
      model: PanDerm (Nature Medicine 2025)
      use: optional shared backbone for downstream learned tools

  composite:
    - { tool: radar_summary,        algorithm: normalize 8 axes to 0-100 }
    - { tool: overall_score,        algorithm: weighted mean of radar axes; weights configurable }
    - { tool: delta_vs_baseline,    algorithm: diff against prior_run_id's metrics, with confidence band }

  safety:
    - tool: safety_rule_engine
      band: deterministic   # NOT an LLM
      input: metrics + questionnaire
      does: |
        Hardcoded rules — the only authority on `safety_flags`:
          - pregnancy/lactation → forbid retinoids, hydroquinone,
            high-strength salicylic, oral isotretinoin
          - barrier_score < threshold → forbid acids, physical exfoliants,
            high-conc vitamin C, retinoids; recommend repair-only routine
          - GAGS ≥ moderate OR suspected_pigmented_lesion → see_doctor = true
          - sudden widespread redness + itch → suspect contact dermatitis,
            recommend stopping all active products
      output: safety_flags + reason strings

# ---------------------------------------------------------------------------
# Per-metric output contract (what each tool's JSON blob looks like)
# ---------------------------------------------------------------------------
analysis_output_contract:
  json_shape:
    metric:        <canonical name>
    score:         <0–100 integer; 100 = best>
    level:         excellent | good | fair | concerning
    raw_metrics:   <free dict of intermediate numbers>
    by_region:     <optional; per-ROI breakdown>
    confidence:    <0.0–1.0; lowered by poor lighting, small face, blur>
    evidence_uri:  <relative path to evidence PNG under blobs/evidence/>
    notes:         <optional caveats>
  rules:
    - score and raw_metrics MUST both be present
    - report generation MUST read raw_metrics, not score alone
    - evidence MUST exist unless tool is a pure scalar (e.g. fitzpatrick)

# ---------------------------------------------------------------------------
# Procedures (what the application actually does in each phase)
# ---------------------------------------------------------------------------
procedure:

  intake:
    steps: |
      1. Receive shots from the user (input.md describes which file is
         frontal / left / right; the application copies them into
         ${EXEC}/execution-state/blobs/shots/ and writes the `shots`
         schema entry).
      2. Receive (or solicit) questionnaire. Write `questionnaire`.
      3. Run `quality_check` on each shot. Write `quality`.
      4. If any shot fails: surface the reasons, ask the user to
         retake OR explicitly waive that shot (waived shots get
         confidence penalty downstream). Loop until all three are
         resolved.
    advance_cursor: |
      Per the state protocol: advance meta.yml.input_cursor only after
      the shots & questionnaire have been written to state and the
      quality check has produced a verdict.

  analyze:
    steps: |
      1. For each accepted shot, run `face_parse` and `color_normalize`
         + `align_to_canonical`. Write `parse` and `normalized`.
      2. Run every applicable classical_cv tool on its declared ROI(s)
         of the appropriate shot. Each tool writes its blob under
         metrics/<name>.json and its evidence under
         evidence/<name>.png.
      3. Run learned tools (acne_detect, spot_classify, wrinkle_grade,
         skin_age_regress). Same write pattern.
      4. Run composite tools (radar_summary, overall_score,
         delta_vs_baseline if prior_run_id is set).
      5. Run `safety_rule_engine`. Write `safety_flags`.
    parallelism: |
      Each tool is a pure function over (shot, parse). They MAY run
      in parallel. The application is responsible for joining.

  report:
    steps: |
      1. Read all `metrics`, `safety_flags`, `questionnaire`,
         optionally `delta_vs_baseline`.
      2. Render a structured JSON payload (radar axes, big numbers,
         priorities, recommended routine, product tags) → write
         `report_payload`.
      3. Render a markdown report from that payload using a
         schema-locked prompt. The prompt MUST:
           - read raw_metrics, not just score
           - never introduce a number that isn't in metrics
           - present Western dimensions and (if mapping is available)
             TCM patterns side by side
           - obey safety_flags — never recommend a forbidden ingredient
           - end with at most 3 priorities and a routine
      4. Write `report`. Surface the report to the user.
    safety_check: |
      Before surfacing, run a hard-rule pass over the report markdown:
        - reject if any forbidden ingredient (per safety_flags) appears
          in a recommendation
        - reject if any number appears that isn't in metrics
        - reject if forbidden words appear ("诊断", "治疗", "确诊", …)
      A reject triggers regeneration with the failure reason in the
      prompt; loop at most 3 times before falling back to a template.

  consult:
    purpose: |
      After the report is delivered, the user almost always has
      follow-ups: "why are my pores at 45?", "you recommended salicylic
      — I'm pregnant", "what changed since last month", "is the spot on
      my cheek dangerous?". The consult phase serves these.
    steps: |
      Loop while in `consult`:
        a. Read the next unconsumed input.md entry (per state protocol).
        b. Classify the question into one of:
             - explain (drill into a metric / evidence)
             - product_advice (ingredient/routine question)
             - safety (lesion / reaction / pregnancy)
             - delta (changes over time)
             - general (lifestyle, diet, sleep)
             - off-topic (steer back politely)
        c. Retrieve grounded context:
             - for explain → relevant metrics + evidence URI
             - for product_advice → ingredient KB + safety_flags
             - for safety → safety_flags + a deterministic rule answer
             - for delta → delta_vs_baseline payload
        d. Generate an answer with a schema-locked prompt. Same rules
           as report: no invented numbers, obey safety_flags, never
           use forbidden disease words. Cite which metrics / KB pages /
           rules were used.
        e. Run the same safety_check as in report.
        f. Append a Q&A line to `consultations` (jsonl). Surface the
           answer.
        g. Advance input_cursor.
    hard_rule_overrides: |
      For any question that hits a hardcoded safety rule (pregnancy
      asking about retinoid; user describing a changing pigmented
      lesion; user reporting a likely adverse reaction), the FIRST
      sentence of the answer is generated by the rule engine, NOT the
      LLM. The LLM only writes the surrounding explanation.

  done:
    steps: |
      Mark meta.yml.status = completed. The execution-state/ directory
      is retained for delta-vs-baseline by future runs.

# ---------------------------------------------------------------------------
# Out of scope (firm boundaries)
# ---------------------------------------------------------------------------
not_in_scope:
  - skin disease diagnosis: |
      The skill is a COSMETIC / WELLNESS evaluation surface, not a
      medical diagnostic tool. It triggers "see a dermatologist"
      flows; it does NOT name diseases.
  - hardware-measured metrics (TEWL, true hydration): |
      Image-based proxies are exposed as advisory only with low
      confidence. Truthful measurement requires Corneometer / Tewameter.
  - product purchase / payment flows: |
      The report can carry product tags; commerce is the caller's
      problem.
  - long-running multi-month tracking workflows: |
      Each run is a single execution. Cross-execution trend curves are
      the responsibility of whatever layer above `skin` aggregates runs.

# ---------------------------------------------------------------------------
# Invocation
# ---------------------------------------------------------------------------
invocation:
  start_a_run: |
    The user (or an outer skill) starts a new skin execution by writing
    the first input.md entry with the three image paths and any
    questionnaire data. The application creates the Execution per the
    state protocol, copies the images into blobs/shots/, and advances
    through intake → analyze → report → consult.

  resume: |
    Per the state skill, resume reads meta.yml.phase. Each phase has a
    deterministic recovery path:
      intake   → re-check which shots/quality entries exist; finish the gaps.
      analyze  → re-check which metrics blobs exist; run only the missing
                 tools (tools are pure functions).
      report   → if `report` and `report_payload` are both present, skip
                 to consult; else regenerate.
      consult  → process every input.md entry after input_cursor.

  ending: |
    The user explicitly says "done" (or the caller times out). The skill
    transitions to `done`. The Execution is retained on disk; future
    skin runs may reference it as prior_run_id.

# ---------------------------------------------------------------------------
# Tool maturity matrix
# ---------------------------------------------------------------------------
maturity:
  shippable_week_1:
    - quality_check
    - face_parse
    - color_normalize
    - oil_highlight
    - pore_blackhat
    - blackhead_blob
    - spot_lab_cluster
    - redness_a_channel
    - dullness_l_channel
    - uniformity_lab_std
    - ita_fitzpatrick
    - dark_circle_l_diff
    - lip_color
    - wrinkle_frangi
    - radar_summary
    - overall_score
    - safety_rule_engine

  needs_model_weights:
    - acne_detect
    - spot_classify
    - wrinkle_grade
    - skin_age_regress
    - pan_derm_embed

  experimental:
    - texture_gabor          # numerical scale not yet calibrated
    - gloss_distribution     # entropy threshold needs human-rated set
    - eyebag_geometry        # geometric heuristic brittle on side shots
    - hydration_proxy        # advisory only; pair with questionnaire
    - barrier_proxy          # advisory only; pair with questionnaire

# ---------------------------------------------------------------------------
# Versioning rule
# ---------------------------------------------------------------------------
versioning:
  major: change to phase set, state_schema, or analysis_output_contract
  minor: add a new tool, or change algorithm internals while preserving JSON
  patch: bugfix that does not change scores by more than ±1 point
```
