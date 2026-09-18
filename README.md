# pi-esc-clears-editor

A [pi](https://pi.dev) extension that makes Escape behave like Claude Code:

- **Esc Esc** with text in the editor clears the editor.
- **Esc Esc** with an empty editor opens the rewind list (pi's session tree).
- A **single Esc** keeps pi's native behaviour: abort while streaming, dismiss autocomplete.

## Why

Pi hardcodes `Ctrl+C` to clear the editor on the first press and exit on the second, and `Escape` to `app.interrupt`. There is no setting to change either. If you are used to clearing with Escape, the `Ctrl+C` reflex is risky because a second press quits pi.

This extension adds double-Esc clearing, matching Claude Code, without touching `Ctrl+C`.

Double-Esc rather than single Esc is deliberate: a stray keypress should not destroy what you typed.

## Install

Via npm:

```bash
pi install npm:pi-esc-clears-editor
```

Via git:

```bash
pi install git:github.com/EricZhai01/pi-esc-clears-editor@v0.2.0
```

Or copy `extensions/double-esc-clears-editor.ts` and `src/esc-logic.ts` to
`~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project). Keep the
relative `extensions/` to `src/` layout. Run `/reload` to apply without restarting.

## Behaviour details

| Situation | Result |
|---|---|
| Esc Esc, text in editor, agent idle | Editor clears |
| Esc Esc, empty editor | Rewind list opens (`doubleEscapeAction`) |
| Single Esc, agent idle with text | Nothing (held, then dropped) |
| Single Esc, agent streaming | Unchanged: aborts / restores queued messages |
| Esc Esc, autocomplete open | Unchanged: dismisses autocomplete |
| Esc in bash mode (`!...`) | Unchanged: exits bash mode |
| Holding Esc | Unchanged: key repeat is swallowed, nothing clears |
| `Ctrl+C` | Unchanged: still clears, then exits |

The double-escape action follows your `doubleEscapeAction` setting: `"tree"` (default)
opens the session tree, `"fork"` opens the fork list, `"none"` disables the rewind list.

### Why a single Esc does not clear

Pi only acts on Escape when the editor is empty (rewind list) or while streaming
(abort). While idle with text, a single Escape is already a no-op natively, so the
extension swallows it and waits for a second press. Swallowing it also keeps pi's
own double-escape timer unarmed, so clearing never spills into opening the rewind
list on the next press.

### Holding Esc

Terminals auto-repeat a held key roughly every 30ms. Esc presses less than 49ms
apart are treated as one held key, so holding Esc never clears the editor and never
opens the rewind list by accident. The thresholds live in `src/esc-logic.ts` as
`REPEAT_IGNORE_MS` and `DOUBLE_ESCAPE_MS`.

## Development

```bash
npm test    # zero-dependency unit tests, run by node:test
```

## Requirements

Pi 0.85.x or later, which exports `CustomEditor` from
`@earendil-works/pi-coding-agent` and `matchesKey` from `@earendil-works/pi-tui`.

## Licence

MIT
