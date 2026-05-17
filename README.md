# aprog

**Agent programs.** The harness — Claude Code, Codex, or any future LLM CLI — is the **runtime**; the things it actually executes are **programs**. This project names that idea and gives those programs a place to live.

---

## The idea

Today's agent harnesses are interactive shells: you talk, the agent reacts, the conversation ends, the state evaporates. Whatever the agent built up — a brief, a half-finished design, a decision tree, a working set of files — has no first-class home. It's smeared across a chat transcript, the local filesystem, and the agent's working memory, none of which are addressable, resumable, or composable.

But the work agents do is **intrinsically stateful**. A non-trivial task takes hours, spans interruptions, accumulates decisions, and produces artifacts. Treating each conversation as fresh is the wrong default. The state should be first-class — captured in a stable, inspectable form that any harness can pick up and continue.

That captured form is an **Execution**:

```
Execution = {
  program,    // what is being executed (a skill doc, a procedure, any structured instruction)
  input,      // what the user has asked of it (append-only stream)
  state,      // where it currently is (working memory the program manages)
}
```

An Execution is **the workspace in which one run of a program happens** — not the run's result. It is addressable by ID and persists across interruptions. It is the unit aprog cares about.

---

## Layout

Every Execution lives in a single directory:

```
~/.aprog/<execution-id>/
  meta.yml      # protocol-standardized status (phase, cursor, timestamps)
  input.md     # append-only user input stream, separated by ---
  state/       # private KV namespace owned by the program
```

The protocol that defines all of this lives in [`state/SKILL.md`](state/SKILL.md) — the **state** skill, which other programs in this repo depend on.

---

## What's in this repo

| Path | Kind | Purpose |
|---|---|---|
| `state/` | library skill | Defines the Execution protocol — identity, input stream, working state, resume semantics. Every program here is built on top of it. |
| `design/` | application skill | Designs websites, mobile prototypes, hi-fi mockups, slide decks, single-page artifacts, and media outputs. First real program; treats its own work as an Execution. |

More programs will land here as the pattern proves out. Each will be a directory with a `SKILL.md` and (if needed) `resources/` and `scripts/`.

---

## Why this matters

The OS analogy is deliberate:

| Classical OS | aprog |
|---|---|
| Process | Execution |
| PCB (process control block) | `meta.yml` |
| Private process memory | `state/` |
| Standard input | `input.md` |
| ABI / system interface | the state skill protocol |

Once agent runs are first-class persistent objects with a stable contract, a lot of things that today require ad-hoc engineering — resume, hand-off between harnesses, parallel work on the same project, audit trails, batch tooling — become routine filesystem operations.

This is the structural claim. The current implementation is intentionally minimal — flat directories, plain Markdown, plain YAML, one file per state key. The crudeness is the point: every contract is human-readable and tool-agnostic, no daemon required.

---

## Status

Early. Two skills (`state` v0.1.0, `design` v0.1.0). The protocol has been exercised through real project use; both the protocol and the skills are still iterating. None of the shapes here are final — they are the simplest forms that hold the idea up.

Feedback, breakage reports, and challenges to the model are welcome.
