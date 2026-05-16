---
name: state
version: 0.1.0
kind: library
description: |
  Protocol for managing the state of any execution — identity,
  input stream, working state, and resume semantics. Skills that
  reference this protocol inherit a uniform model for suspending
  and resuming work across interruptions.
---

# state

A protocol for the state of an execution — any run of a task, procedure, or skill-driven flow. It defines what an **Execution** is and how its state is identified, stored, suspended, and resumed. When a skill references this protocol, its state operations follow a uniform model — the agent reading both documents knows exactly where to put what, how to find what was already done, and how to pick up after an interruption.

---

## Core abstraction: Execution

```
Execution = {
  program  ← what is being executed
  input    ← what was asked of it
  state    ← where it currently is
}
```

Here, **program** is the static description of what to execute — typically a skill document, but the protocol places no constraint on its form (a procedure spec, workflow definition, or any structured instruction artifact qualifies).

An **Execution** is the named scope that contains everything about **one run** of a program: a reference to the program, the inputs it has received, the working state it has built up, and its lifecycle metadata. It is not the *result* of running a program — it is the *workspace* in which that run happens, addressable by an ID and persistent across interruptions. No state exists outside an execution; executions are isolated from each other.

---

## Layout

### Root directory

```
~/.aprog/                            # single per-user root
```

Per-project roots are not supported. For project-local access, symlink.

### Execution directory

```
~/.aprog/
  <execution-id>/                    # one execution = one directory
    meta.yml                         # protocol fields (standardized)
    input.md                         # user input stream (append-only)
    state/                           # private namespace owned by the program
```

| Path | Owner | Reader |
|---|---|---|
| `meta.yml` | protocol | any tool |
| `input.md` | protocol (format) + user (content) | any tool |
| `state/` (subdir) | the program | only that program |

OS analogy: `meta.yml` ≈ PCB (standardized external interface); `state/` ≈ private process memory (program-managed).

> Naming note: the **state** skill (this document) and the **state/** subdirectory inside an execution share a name but live at different layers — the skill is the protocol; the subdir is one location the protocol defines.

### Execution ID

Format: `<yyMMdd>-<4-char nanoid>` (e.g., `260516-x7k2`). Automatic, collision-free, sortable by `ls -lt`. No other formats are accepted.

### meta.yml

```yaml
id: <execution-id>
program: <name or path of what is being executed (e.g., a skill doc)>
program_version: <copy the program doc's version field if it has one; otherwise omit>
status: running | completed | failed
phase: <free text; the program defines its own phase names>
created_at: <ISO8601>
last_active_at: <ISO8601>
input_cursor: <ID of the latest fully-processed input; omit if none>
```

`phase` is free text. The protocol does **not** prescribe a phase set; each program defines its own FSM. But **the current phase must be written here** so that resume does not require reading `state/` first.

### input.md

```markdown
## input-001 @ 2026-05-16T06:00 — Initial
Design a corporate site. Blue/white palette, Products and Team pages.

---

## input-002 @ 2026-05-16T08:30 — Follow-up
Add an FAQ page.
```

- Single file, **append-only**; original history is never rewritten.
- Each entry: sequential ID (`input-NNN`) + ISO8601 timestamp + optional short title.
- **Entries MUST be separated by a `---` line** (Markdown horizontal rule). No other separator is recognized.
- Contains **only what the user said to the program**. Program-internal Q&A, decisions, and intermediate artifacts go in `state/`.

### state/ (subdir)

`state/` is a **key-value store on the filesystem**:

- **One file per key.** The filename **is** the key — no file extensions.
- **The file's content is the value.** Format is the program's choice — Markdown, JSON, YAML, plain text, etc.
- **Filenames are hyphen-separated, lowercase, and meaningful.** Examples: `current-design-direction`, `decided-color-palette`, `open-questions`.
- **Subdirectories group related keys** as namespaces when keys naturally cluster.

**`state/` should be self-contained** — if `meta.yml` is lost, the program should still be able to reconstruct "where I was" from `state/` alone.

---

## Resume

When resuming, `input.md` may have accumulated multiple entries. Distinguishing processed vs. unprocessed uses the cursor:

- On resume, read `input.md` and take every entry **after** `input_cursor` — those are unprocessed.
- **Advance the cursor only after fully consuming an input** ("fully consumed" = the request has been reflected into `state/`).
- The protocol guarantees **at-least-once**. Re-processing safety after interruption is the program's responsibility (use traces in `state/` to detect "started but did not finish").

This narrows `input.md` to a small consumer-offset queue of user inputs, without making the entire program state an event log.

---

## input vs. state

Not every user utterance during execution belongs in `input.md`:

| What the user says | Where it goes |
|---|---|
| "What I want / my constraints changed" (Add an FAQ; switch from blue to green) | `input.md` |
| "Regarding your previous question, my answer is X" (Use the logo I just sent) | `state/` |

`input.md` is the **evolution of the overall instruction to the program**; skill-internal Q&A stays in `state/`. The protocol can only state the rule; enforcement is the implementer's discipline.
