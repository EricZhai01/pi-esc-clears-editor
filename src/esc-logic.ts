/**
 * Pure helpers, kept free of pi imports so they can be unit tested without the
 * host application installed.
 *
 * Why this is more than a timestamp comparison:
 *
 * Terminal auto-repeat cannot be detected by a short time window. Repeat starts
 * only after the OS initial delay (hundreds of ms), then fires at the repeat
 * rate, so the first repeat arrives long after the previous event and looks
 * exactly like a genuine second press:
 *
 *   press(0)  ...  repeat(+500)  repeat(+590)  repeat(+680) ...
 *
 * Consecutive repeats are then as close together as a fast double tap, so no
 * single window separates them. The one reliable difference is that a hold keeps
 * producing presses, so a committed action is deferred briefly and cancelled if
 * another press follows. `BURST_MS` is that brief wait, and it is the only
 * source of delay.
 *
 * A marked repeat (`isRepeat`) short-circuits all of this. `isKeyRepeat` only
 * parses the bytes, so it is trustworthy without touching terminal state. Once a
 * terminal has been seen to mark repeats, an unmarked second press is known to
 * be a genuine tap and can commit immediately.
 *
 * Terminal capability is deliberately never queried. `isKittyProtocolActive()`
 * from `@earendil-works/pi-tui` reads module-level state in a *different* module
 * instance than the one pi runs: pi's bundle inlines its own pi-tui copy, while
 * extensions resolve the package separately. That function therefore always
 * answers `false` inside an extension and must not be used to gate behaviour.
 */

/**
 * Tunable window in ms. Must cover the terminal's key-repeat interval so a held
 * key always schedules a commit that the next repeat cancels. macOS and Windows
 * repeat well inside 250ms by default, and `BURST_MS` is driven by it.
 */
function windowMs(): number {
  const raw = Number(process.env.PI_DOUBLE_ESC_MS);
  return Number.isFinite(raw) && raw >= 100 && raw <= 1000 ? raw : 250;
}

/** Max gap between two presses to count as a deliberate double press. */
export const PAIR_MS = windowMs();

/**
 * Grace period after the second press before a deferred commit runs. A third
 * press inside this window means the key is held.
 *
 * Must be at least `PAIR_MS`. Any interval below `PAIR_MS` counts as a pair, so
 * a held key producing presses faster than that always schedules another
 * deferred commit. Keeping the grace window at least as long guarantees the next
 * press arrives before the timer fires and cancels it. A shorter value leaves a
 * band (BURST_MS to PAIR_MS) where a held key still commits.
 */
export const BURST_MS = PAIR_MS;

/**
 * How long to keep dropping escapes once a held burst is recognised. Refreshed
 * by every dropped escape, so it lasts until the key is released. Must exceed
 * `BURST_MS` so a burst cannot resume committing mid-hold.
 */
export const SUPPRESS_MS = PAIR_MS + 150;

/**
 * What a completed double press should do.
 *
 * - `clear`: the editor has text; wipe it.
 * - `rewind`: the editor is empty; open the rewind list.
 * - `native`: pi should get the escapes untouched. Used while streaming, with
 *   autocomplete open, or in bash mode, where pi owns the escape key.
 */
export type EscIntent = "clear" | "rewind" | "native";

export interface EscState {
  /** When the first press of a possible double press arrived. 0 means none. */
  pendingPressAt: number;
  /** Escape bytes to drop until this time. 0 means not suppressing. */
  suppressUntil: number;
  /** When a deferred commit runs. 0 means none scheduled. */
  deadline: number;
  /** What the pending press is for. `null` means nothing pending. */
  intent: "clear" | "rewind" | null;
  /**
   * Set once a marked repeat has been seen, meaning the terminal reports repeat
   * events. An unmarked second press can then be trusted as a genuine tap.
   */
  repeatsReported: boolean;
}

export function createEscState(): EscState {
  return {
    pendingPressAt: 0,
    suppressUntil: 0,
    deadline: 0,
    intent: null,
    repeatsReported: false,
  };
}

export type EscAction =
  /** Held key or its tail: drop it and cancel anything scheduled. */
  | "swallow"
  /** First press: remember it and drop it. */
  | "hold"
  /** Second press, terminal known to report repeats: act now. */
  | "commit"
  /** Second press elsewhere: act after `BURST_MS` unless a third press arrives. */
  | "defer"
  /** Hand the escape straight to pi. */
  | "forward";

export interface EscOptions {
  /** What a completed double press would do in the editor's current state. */
  intent: EscIntent;
  /** The terminal marked this event as a key repeat. */
  isRepeat: boolean;
}

const dropped = (state: EscState, now: number): EscState => ({
  pendingPressAt: 0,
  suppressUntil: now + SUPPRESS_MS,
  deadline: 0,
  intent: null,
  repeatsReported: state.repeatsReported,
});

/**
 * Decide what to do with an escape press.
 *
 * Escapes are only ever intercepted while `intent` is `clear` or `rewind`, which
 * means the agent is idle, no autocomplete is open, the input is not a bash
 * command, and the editor is either holding text (`clear`) or empty (`rewind`).
 * In both of those states a single escape is a no-op in pi, so dropping it costs
 * nothing. That is what makes holding safe.
 *
 * The `rewind` case matters because pi's own double-escape handler has no
 * key-repeat guard: forwarding a held burst to it opens and closes the rewind
 * list once per repeat. Confirming the double press here, and forwarding exactly
 * two escapes to pi when it is real, keeps pi's `doubleEscapeAction` setting
 * (tree, fork or none) while stopping the flicker.
 */
export function handleEscPress(
  state: EscState,
  now: number,
  { intent, isRepeat }: EscOptions,
): { state: EscState; action: EscAction } {
  if (isRepeat) {
    // Marked in the bytes, so it is never a fresh press. Record that this
    // terminal reports repeats, which enables the instant path below.
    return {
      state: { ...dropped(state, now), repeatsReported: true },
      action: "swallow",
    };
  }

  // Still dropping the tail of a held burst.
  if (now < state.suppressUntil) return { state: dropped(state, now), action: "swallow" };

  // A third press arrived before the deferred commit: the key was held.
  if (state.deadline !== 0 && now < state.deadline) {
    return { state: dropped(state, now), action: "swallow" };
  }

  if (intent === "native") {
    return {
      state: { ...state, pendingPressAt: 0, deadline: 0, intent: null },
      action: "forward",
    };
  }

  const isPair = state.pendingPressAt !== 0 && now - state.pendingPressAt < PAIR_MS;

  if (isPair) {
    const committed = dropped(state, now);
    // If this terminal marks repeats, an unmarked second press cannot be a
    // repeat, so it is a real tap and can act at once.
    if (state.repeatsReported) return { state: committed, action: "commit" };
    return { state: { ...committed, intent, deadline: now + BURST_MS }, action: "defer" };
  }

  return {
    state: { ...state, pendingPressAt: now, deadline: 0, intent },
    action: "hold",
  };
}

/** State after a deferred commit has run. */
export function markCommitted(state: EscState, now: number): EscState {
  return dropped(state, now);
}
