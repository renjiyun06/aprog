---
name: live-tweak
version: 0.1.0
kind: functional
description: |
  Apply structured property tweaks the user has dialled in on the live preview.
  Each tweak pairs a CSS selector with a set of explicit property changes
  (color, padding, margin, font-size, etc.) plus an optional note. This skill
  walks the inbox, applies each tweak to the relevant CSS rule (or inline
  style), and archives the processed entry.
---

# live-tweak

When the preview-server receives tweak batches from the in-browser overlay, it writes one JSONL record per tweak to `${EXEC}/state/tweak-inbox` and appends a new entry to `${EXEC}/input.md`. This skill defines how the agent **drains** that inbox.

Invoke this skill on demand when:

- A new `input-NNN` entry references **"Live tweaks"** (the preview-server emits this title).
- The user mentions "apply my tweaks", "the changes I dialled in", or similar.

---

## Inbox schema

`${EXEC}/state/tweak-inbox` is JSONL (one object per line):

```json
{
  "ts": "2026-05-16T13:45:10Z",
  "url": "/index.html",
  "selector": "main > section:nth-of-type(2) > h2",
  "props": {
    "color": "#1f2937",
    "font-size": "1.5rem",
    "padding-top": "12px"
  },
  "note": "make this match the body voice"
}
```

- `ts` — overlay POST timestamp.
- `url` — page the user was viewing.
- `selector` — CSS selector of the targeted element.
- `props` — object of CSS property → value. Only properties the user actually changed appear (no placeholders).
- `note` — optional free-text rationale.

The overlay was live-previewing these changes as the user typed; by the time the tweak lands here, the user has already seen and approved the visual result.

---

## Procedure

1. **Read** every line of `${EXEC}/state/tweak-inbox`.

2. **For each entry**, decide WHERE the change should land. Three placement strategies, in order of preference:

   a. **A matching brand token.** If the active design system (`${EXEC}/state/selected-design-system`) has a relevant token (e.g., the brand defines `--text-display` and the user adjusted `font-size` on a heading), prefer adjusting the token rather than the element. This keeps brand consistency.

   b. **The CSS rule that already styles this element.** Open the page's stylesheet; if there's a rule whose selector matches the same element, edit that rule's property. Less specific than inline, more shareable across pages.

   c. **Inline style on the element itself.** Last resort, when no shared rule applies or the brand explicitly varies this element from the system.

3. **Apply the property change.** For each `(property, value)` pair:
   - If multiple `props` belong to the same logical concept (e.g., `padding-top` + `padding-right` + `padding-bottom` + `padding-left`), consolidate into a shorthand (`padding: T R B L`) if all four are present.
   - Quote string values per CSS rules (e.g., `font-family: "Inter", sans-serif`).
   - Preserve the rest of the rule untouched.

4. **Respect the conflict order from `design`'s composition**: brand > craft on tokens; user input (this tweak) > everything. A tweak overrides previously generated values — don't second-guess.

5. **Archive** the entry:
   - Append to `${EXEC}/state/tweak-resolved` (JSONL) with extra fields:
     - `resolved_at`
     - `applied_to` (file edited, e.g., `/styles.css` or `/index.html`)
     - `placement` (one of `token | rule | inline`, matching the strategy used)
   - Remove the line from `${EXEC}/state/tweak-inbox`.

6. After all entries are drained, **advance `${EXEC}/meta.yml.input_cursor`**.

7. **Surface a summary**: `Applied N tweak(s) — K via brand tokens, K via shared rules, K via inline styles. Refresh the preview to verify.`

---

## Note vs props

`note` and `props` carry different intents:

- `props` is **what** the user wants (specific values).
- `note` is **why** or **broader context**. It may explain a constraint the props alone don't convey ("keep this readable on mobile too").

Always read `note` before applying. It may justify rejecting a pure prop change in favor of a smarter brand-coherent edit. When the note conflicts with the props, prefer the note's intent and write the resolution into `design-decisions`.

---

## Idempotency

Same risk as `live-annotate`: an agent crash mid-process may leave a tweak both in inbox and partially applied. Mitigations:

- Read the target file first; skip if the desired property already matches the requested value.
- Log each successful application to `${EXEC}/state/design-decisions`.

---

## Failure modes

- **Selector doesn't resolve**: source has changed since the overlay captured the path. Try a fuzzy match by tag + ancestor classes; if still ambiguous, leave in inbox and ask the user.
- **Token strategy unclear** (no obvious brand token to bump): fall back to rule-level edit. Note the decision so future tweaks on similar elements stay consistent.
- **Tweak contradicts brand**: e.g., user dialled a color that violates the brand's accent rules. Apply the user's choice (their tweak wins per the conflict order) but **flag it** in `design-decisions` and consider raising it in the next user-facing summary.
