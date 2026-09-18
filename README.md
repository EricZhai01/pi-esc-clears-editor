# pi-esc-clears-editor

A [pi](https://pi.dev) extension that makes the Escape key behave like Claude Code:

- **Esc** with text in the editor clears the editor.
- **Esc twice** within 500ms opens the rewind list (pi's session tree).

## Why

Pi hardcodes `Ctrl+C` to clear the editor on the first press and exit on the second, and `Escape` to `app.interrupt`. There is no setting to change either. If you are used to Escape-to-clear, the `Ctrl+C` reflex is risky because a second press quits pi.

This extension replaces the input editor so Escape clears, without touching `Ctrl+C`.

## Install

Via npm:

```bash
pi install npm:pi-esc-clears-editor
```

Via git:

```bash
pi install git:github.com/EricZhai01/pi-esc-clears-editor@v0.1.1
```

Or copy `extensions/esc-clears-editor.ts` and `src/esc-logic.ts` to
`~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project). Keep the
relative `extensions/` → `src/` layout. Run `/reload` to apply without restarting.

## Behaviour details

| Situation | Result |
|---|---|
| Text in editor, agent idle | Editor clears |
| Editor empty, second Esc within 500ms | Rewind list opens (`doubleEscapeAction`) |
| Agent streaming or compacting | Unchanged: aborts / restores queued messages |
| Autocomplete open | Unchanged: closes autocomplete |
| Bash mode (`!...`) | Unchanged: exits bash mode |
| Holding Esc | Unchanged: key repeat is swallowed, nothing clears |
| `Ctrl+C` | Unchanged: still clears, then exits |

The double-escape action follows your `doubleEscapeAction` setting: `"tree"` (default)
opens the session tree, `"fork"` opens the fork list, `"none"` disables it.

### Holding Esc

Terminals auto-repeat a held key roughly every 30ms. Esc presses less than 49ms
apart are treated as one held key, so holding Esc never clears the editor twice and
never opens the rewind list by accident. The threshold lives in
`src/esc-logic.ts` as `REPEAT_IGNORE_MS`.

## Development

```bash
npm test    # zero-dependency unit tests, run by node:test
```

## Requirements

Pi 0.85.x or later, which exports `CustomEditor` from
`@earendil-works/pi-coding-agent` and `matchesKey` from `@earendil-works/pi-tui`.

## Licence

MIT
