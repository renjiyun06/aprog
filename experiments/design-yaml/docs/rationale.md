# Rationale

The "why" behind specific spec rules. Anchors are referenced from `SPEC.yaml`
via the `why:` field.

---

## preview-server

> Referenced from: `output.why`

The skill mandates serving artifacts via `${SKILL}/scripts/preview-server`, not via `python3 -m http.server` or any other generic static server.

Two reasons:

1. **Overlay injection.** The preview-server injects an in-page overlay script that lets the user click-to-annotate and click-to-tweak elements on the rendered page. Without it, the live-feedback loop (`live-annotate` + `live-tweak`) cannot exist — the user has no UI to leave a comment.
2. **Inbox endpoints.** The preview-server exposes `POST /feedback` and `POST /tweak`. These write JSONL records into `${EXEC}/state/feedback-inbox` / `tweak-inbox` AND append a new `input-NNN` entry to `${EXEC}/input.md` — so the next agent turn picks the feedback up automatically. Static servers obviously cannot do this.

The preview-server is a bridge between two worlds: the user's browser (rich UI surface) and the agent's input.md (the protocol's serial instruction stream). Without it, every browser observation costs a context switch back to chat.

---

## index-truncation

> Referenced from: `phases.selecting.on_entry.constraints`

The `list-resources` script emits frontmatter / header info for every resource in a category. It is the agent's only complete catalog of what's available — both for **proposing candidates** in `selecting` and for **matching on-demand utilities** in `designing`.

If the agent pipes the output through `head -50`, `grep some-keyword`, or any other filter, the in-memory catalog is **silently incomplete**. The agent will later try to match a user request against the catalog, fail to find the right entry, and either (a) fabricate one, (b) fall back to a wrong second choice, or (c) tell the user "no such skill exists" — all of which are silent failures, none of which surface to the user as "I truncated the catalog and don't actually know."

Past failure: an agent loaded only the first 30 lines of `list-resources skills`, then when the user asked for a screenshot utility, said no such skill existed. The `screenshot` skill was on line 47.

The constraint is therefore stated as a hard prohibition: **consume the FULL output every time**.

---

## resume-b

> Referenced from: `phases.designing.on_entry.load.b_resource_library.why`
> Referenced from: `resume.steps[].conditional.then.why_critical`

The single most-omitted step in resume is reloading **group B** — the skill's resource library. The other groups are easy to remember:

- **Group A** (execution state — `brand-brief`, `design-decisions`) feels obviously relevant on resume, and lives under `${EXEC}/` so it's right next to the meta.yml the agent just read.
- **Group C** (functional skill index) is small and easy.
- **Group B** (`DESIGN.md`, `tokens.css`, every craft file, template `SKILL.md`, references/) lives under `${SKILL}/`, NOT under `${EXEC}/`. It's invisible from the agent's perspective when they're focused on the execution — and it's the heaviest in pages.

What happens when group B is skipped: the agent reads `state/selected-design-system: kami`, **thinks it remembers what "kami" looks like**, and starts generating. The output drifts from the actual brand because the brand prose was never loaded — only the name. Same failure mode for craft rules and the template scaffold.

The fix, written in capital letters in the spec because the failure is silent: **MUST re-read every file in group B on every resume**. The previous agent's working memory is gone; the new agent starts blank. Reading `state/selected-design-system: kami` proves only that "kami" was selected — it proves nothing about what kami looks like.

Past failure: agent resumed a `260516-pkm1` execution, read state KVs, and produced output that violated the `kami` brand's strict 12-column grid. Group B never re-read. The user caught it on the next preview round, not the agent.

---

## conflict-precedence

> Referenced from: `phases.designing.conflict_precedence.why`

Two rules combine when an artifact decision is contested:

1. **Brand > craft on visual tokens.** If the active brand defines `--text-display: 1.6rem` and a craft rule says "headings ≥ 2rem for hierarchy clarity," brand wins. The brand is more specific (it knows this brand voice); craft is generic hygiene (applies across all brands).
2. **User input > everything.** If the user dialed `font-size: 1.2rem` on a heading via `live-tweak`, that wins over both brand and craft. Their tweak is the most recent, most specific signal.

The order is **NOT** a moral hierarchy — it's a specificity hierarchy. More specific evidence wins.

Where this gets tricky: a tweak that contradicts the brand should be **applied** (per the rule) but **flagged** in `design-decisions`. Future agents reading the decision log should see "user overrode brand on element X — likely intentional but worth a sanity-check." This keeps the rule clean (user input always wins, no waffle) while preserving an audit trail.

---

## functional-skill-index

> Referenced from: `phases.designing.on_entry.load.c_functional_skill_index.why`

The functional skills (`live-annotate`, `live-tweak`, plus future on-demand utilities) are not selected at project level. They are matched against on-demand mid-task, when an event triggers them (e.g., the preview-server writes an inbox entry).

For the match to work, the agent needs the **index** (header info per skill — name + description) **in working memory**. The full body is loaded only when the skill is actually invoked.

Loading the index at `selecting` (not `designing`) entry is deliberate: by the time the user finishes selecting and the first artifacts are generating, on-demand matches can already happen (a tweak might arrive seconds after the first preview). Waiting until `designing` entry would create a window where the agent doesn't yet know what utilities exist.

---

## template-vs-craft-cardinality

> Referenced from: `phases.selecting.notes.cardinality`

Each project picks **exactly one** design-template and **exactly one** design-system. But it can opt into **many** craft rules.

The asymmetry is intentional:

- A **design-template** defines the **shape** of the deliverable (a deck is not a multi-page site). A project that needs two shapes (deck AND mobile prototype) should be **split into two executions**. One project = one shape. Mixing shapes inside one Execution produces incoherent output and complicates the FSM (which `produced-files` entry belongs to which shape?).
- A **design-system** defines the **brand voice**. Two brand voices in one project means the project doesn't have a brand — it has two. Either reconcile into one or split.
- **Craft rules** are universal hygiene (typography, color contrast, anti-AI-slop). They naturally combine. Opting into "tight typography" AND "WCAG contrast" AND "anti-slop visuals" together is not a contradiction — it's just three orthogonal disciplines layered on the same artifact.

So: shape = 1, brand = 1, hygiene = N. Spec encodes this with `required: true` on the singular fields and a plain list for craft.
