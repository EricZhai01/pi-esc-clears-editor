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
| Single Esc, agent idle with text | Nothing (dropped) |
| Single Esc, agent streaming | Unchanged: aborts / restores queued messages |
| Esc Esc, autocomplete open | Unchanged: dismisses autocomplete |
| Esc in bash mode (`!...`) | Unchanged: exits bash mode |
| Holding Esc | Ignored: never clears the editor, never flickers the rewind list |
| `Ctrl+C` | Unchanged: still clears, then exits |

The double-escape action follows your `doubleEscapeAction` setting: `"tree"` (default)
opens the session tree, `"fork"` opens the fork list, `"none"` disables the rewind list.

### Why a single Esc does not clear

Pi only acts on Escape when the editor is empty (rewind list) or while streaming
(abort). While idle with text, a single Escape is already a no-op natively, so the
extension swallows it and waits for a second press. Swallowing it also keeps pi's
own double-escape timer unarmed, so clearing never spills into opening the rewind
list on the next press.

### The rewind list is confirmed here, not by pi

Pi's own double-escape handler has no key-repeat guard. Forwarding a held burst to
it opened and closed the rewind list once per repeat, because a lone Escape both
opens it (editor focused) and cancels it (`tui.select.cancel` is bound to Escape).

The extension therefore confirms the double press itself and only then feeds pi
exactly two escapes. That opens the list once and still honours `doubleEscapeAction`,
including `fork` and `none`.

### Holding Esc

Terminal auto-repeat cannot be detected by timing alone. Repeat starts only after
the OS initial delay (hundreds of ms) and then fires at the repeat rate, so the
first repeat arrives long after the previous event and looks exactly like a
genuine second press:

```
press(0)  ...  repeat(+500)  repeat(+590)  repeat(+680) ...
```

Consecutive repeats are then as close together as a fast double tap, so no single
short window separates a hold from a tap. The extension handles it like this:

- **A marked repeat short-circuits everything.** `isKeyRepeat` parses the bytes,
  so it needs no terminal state. The first time a marked repeat is seen, the
  extension remembers that this terminal reports repeats, and every later double
  tap commits immediately with no delay.
- **Otherwise the commit is deferred.** On the second press it is scheduled rather
  than performed; a third press means the key was held, so the commit is cancelled
  and the rest of the burst is dropped. This is the only source of delay.

The extension only intercepts escapes that pi would ignore. While streaming, with
autocomplete open, in bash mode, or with an empty editor, escapes are forwarded
untouched, so abort and the native rewind list keep working.

Terminal capability is never queried. `isKittyProtocolActive()` from
`@earendil-works/pi-tui` reads module-level state in a different module instance
than the one pi runs, because pi's bundle inlines its own pi-tui copy while
extensions resolve the package separately. That function always answers `false`
inside an extension, so it must not gate behaviour.

The thresholds live in `src/esc-logic.ts` as `PAIR_MS`, `BURST_MS` and
`SUPPRESS_MS`. A double tap never waits longer than `BURST_MS`. Set
`PI_DOUBLE_ESC_MS` (100–1000) to tune the window.

## Development

```bash
npm test    # zero-dependency unit tests, run by node:test
```

## Requirements

Pi 0.85.x or later, which exports `CustomEditor` from
`@earendil-works/pi-coding-agent` and `matchesKey` from `@earendil-works/pi-tui`.

## Licence

MIT
