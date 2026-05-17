# design-yaml — experiment

A parallel rewrite of the **design** skill in a **YAML spec + prose docs** form, to evaluate whether moving from natural-language `SKILL.md` to a structured spec **adds clarity without losing fidelity**.

This is an exploration. The live `design/SKILL.md` is unchanged — it's still the in-use skill. Nothing here is wired into Claude Code.

---

## What's here

```
experiments/design-yaml/
  SPEC.yaml        # phases, transitions, state KV schema, on-entry loads, scripts
  docs/
    principles.md  # discovery philosophy + how to think
    rationale.md   # the "why" passages — anchored from SPEC.yaml
  README.md        # this file
```

## The split

The hypothesis: a clean YAML carries the **machinery**, prose carries the **judgment**.

| Goes in SPEC.yaml | Goes in docs/*.md |
|---|---|
| FSM phases + transitions | Discovery philosophy ("ask one question at a time") |
| State KV schema (key / format / required / mutable) | Why singular template / list craft |
| `on_entry` file lists and script invocations | Why group B is the most-omitted on resume |
| Conflict precedence (brand > craft > user) | Why user-input always wins despite brand specificity |
| Resume step sequence | What "silently incomplete" failure looks like in practice |
| Output channel + inbox endpoints | Why static servers can't substitute for preview-server |

When SPEC.yaml lists a rule whose intent is non-obvious, it points at a docs anchor:

```yaml
constraints:
  - consume FULL output of every list-resources run
  - do NOT pipe through head / tail / grep
  - see docs/rationale.md#index-truncation
```

The LLM is expected to follow the anchor before acting.

## Comparing with the live skill

| | `design/SKILL.md` (live) | `experiments/design-yaml/` |
|---|---|---|
| Lines (machinery part) | ~200 lines of mixed prose + lists | SPEC.yaml ~210 lines |
| Lines (rationale part) | embedded inline | docs ~200 lines, two files |
| Total | 200 | 410 |
| Cross-references | linear reading order | anchor-based jumps |
| LLM execution fidelity | proven (in current bencao-coffee execution) | untested |
| Machine readability | low (LLM-only parser) | high (YAML parsers, lint, FSM viz) |
| Adding a new phase | edit prose; risk inconsistency | edit `phases:` block; structure enforced |
| Adding a new state KV | edit table + writes block + transition | edit `state_kv:` row + phase `writes:` |

The total line count is HIGHER for the split form. That's expected: prose stitches multiple concerns together with connective sentences; splitting forces explicit cross-refs that the connective sentences encoded implicitly.

## Open questions

1. **Does the LLM execute SPEC.yaml as faithfully as SKILL.md?** Untested. Would need a parallel execution to compare.
2. **Do the docs anchors actually get followed?** Or does the LLM scan SPEC.yaml top-down, see a rule, apply it, and ignore the `why:` field?
3. **Is the cardinality / detail loss in YAML acceptable?** E.g., the prose form of "MUST re-read every file in group B" carries warning-tone bold + caps. YAML can express the prohibition but not the urgency. Does this matter?
4. **Should SPEC.yaml be the source of truth, with SKILL.md generated from it?** Or are they parallel sources that human-edit independently?
5. **Tooling.** A spec lint that checks every `${state.X}` template refers to a declared `state_kv` key would catch a class of bugs. A FSM viz from `phases:` would help users understand the skill at a glance. Neither exists yet.

## Recommended next step

Don't migrate the live `design` skill. Instead, **try writing a NEW skill** in this form (something simple — maybe a media-processing skill or a single-page-artifact skill) and see whether (a) authoring it in YAML feels better than authoring in prose, and (b) the LLM executes it as well. That's the test that matters; everything else is speculation.
