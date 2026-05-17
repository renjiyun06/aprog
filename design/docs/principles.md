# Principles

Guiding principles that the YAML spec cannot encode mechanically.
Read these as **how to think**, not as **what to do** — the spec covers the latter.

---

## Discovery

Discovery is **not a form fill**. The form-fill instinct produces shallow briefs that lock in the wrong direction.

- **One question at a time.** Multi-part questions overwhelm and produce shallow answers. If you find yourself writing two sentences both ending in a question mark, you've already failed.
- **Open before closed.** Ask "what feeling should visitors leave with?" before "blue or green?" Closed questions narrow too fast and miss the axis that actually matters.
- **Reference over description.** "Show me a site you like" beats "describe your aesthetic." Most people can recognize a fit better than they can articulate one.
- **Constraints surface uncertainty faster than goals.** Ask "what won't work here?" — the answer reveals the design space's edges faster than asking what *will* work.
- **No premature commitment.** Don't suggest skills, design systems, or even a direction until the brief is substantial. Suggesting too early biases the user into agreeing with you instead of discovering what they actually want.
- **Return to discovery anytime.** Even mid-`designing`, surfacing a missing axis beats charging forward on assumption. The phase you're in is a hint, not a prison.

---

## Resource loading discipline

Two principles that recur across phases:

- **Indices are loaded WHOLE.** When the spec says `run: list-resources <category>`, the agent must consume the entire output. Piping through `head`, `tail`, `grep`, or `awk` produces a silent partial index — and matches against it silently miss entries. See `rationale.md#index-truncation`.
- **Bodies are loaded ON DEMAND.** Reading a SKILL.md or DESIGN.md upfront is wasteful and crowds context. Read only the candidates you're proposing or invoking. (Exception: the **selected** template and design-system are read in full at `designing` entry — they're the working memory for generation.)

---

## On using state vs. input

A line that recurs throughout the protocol:

- `input.md` holds **what the user wants** (the instruction). Append-only, sequential.
- `state/` holds **what the program has built up** (the work). Mutable.

When you process an input, the result of "I understood and acted on this" goes into `state/`, not back into `input.md`. The protocol's at-least-once guarantee depends on this discipline: only advance `input_cursor` when the input is fully reflected in `state/` or in the output directory.

---

## On iteration vs. commitment

The FSM is forgiving by design:

- `done` can transition back to `designing`. A "finished" project that gets a new request just re-enters.
- `designing` can call back into discovery work informally — if a new axis surfaces (e.g., "actually we also need a mobile version"), pause generation, capture into `brand-brief`, then resume.
- Phases are checkpoints, not gates. Crossing forward is not a vow.
