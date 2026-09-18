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
 * producing presses. Two mechanisms use that:
 *
 * - When the terminal reports key-repeat events (Kitty keyboard protocol, which
 *   pi requests by default), `isRepeat` marks a repeat outright, and a press that
 *   is not marked is a real tap. That path is instant.
 * - Otherwise the clear is deferred. On the second press it is scheduled rather
 *   than performed; if a third press arrives first, the key was held, so the
 *   clear is cancelled and the rest of the burst is dropped.
 */

/** Max gap between two presses to count as a deliberate double press. */
export const PAIR_MS = 400;

/**
 * Grace period after the second press before a deferred clear runs, used only on
 * terminals that do not report key-repeat events. A third press inside this
 * window means the key is held. Must exceed the terminal's repeat interval,
 * which is normally well under 200ms; erring high only adds a short delay,
 * while erring low lets a held key clear the editor.
 */
export const BURST_MS = 300;

/**
 * How long to keep dropping escapes once a held burst is recognised. Refreshed
 * by every dropped escape, so it lasts until the key is released.
 */
export const SUPPRESS_MS = 400;

export interface EscState {
  /** When the first press of a possible double press arrived. 0 means none. */
  pendingPressAt: number;
  /** Escape bytes to drop until this time. 0 means not suppressing. */
  suppressUntil: number;
  /** When the deferred clear runs. 0 means none scheduled. */
  clearDeadline: number;
}

export function createEscState(): EscState {
  return { pendingPressAt: 0, suppressUntil: 0, clearDeadline: 0 };
}

export type EscAction =
  /** Held key or its tail: drop it and cancel any scheduled clear. */
  | "swallow"
  /** First press with text, which pi treats as a no-op: drop it. */
  | "hold"
  /** Confirmed second press: clear now. */
  | "clear"
  /** Second press on a non-reporting terminal: clear unless a third arrives. */
  | "deferClear"
  /** Hand straight to pi. */
  | "forward";

export interface EscOptions {
  /** Editor has text, agent idle, no autocomplete, not a bash command. */
  canClear: boolean;
  /** Terminal marked this event as a key repeat. */
  isRepeat: boolean;
  /** Whether `isRepeat` can be trusted (Kitty keyboard protocol active). */
  repeatAware: boolean;
}

const dropped = (now: number): EscState => ({
  pendingPressAt: 0,
  suppressUntil: now + SUPPRESS_MS,
  clearDeadline: 0,
});

/**
 * Decide what to do with an escape press.
 *
 * `canClear` is true only when the editor has text, the agent is idle, no
 * autocomplete is open, and the input is not a bash command. In that state a
 * single escape is a no-op in pi, so dropping it costs nothing. That is what
 * makes holding safe: the extension only ever intercepts escapes pi would ignore.
 *
 * While `canClear` is false, escapes are forwarded untouched, so abort,
 * autocomplete dismissal, bash-mode exit and the native rewind list keep working.
 */
export function handleEscPress(
  state: EscState,
  now: number,
  { canClear, isRepeat, repeatAware }: EscOptions,
): { state: EscState; action: EscAction } {
  // Authoritative repeat signal, when the terminal provides one.
  if (repeatAware && isRepeat) return { state: dropped(now), action: "swallow" };

  // Still dropping the tail of a held burst.
  if (now < state.suppressUntil) return { state: dropped(now), action: "swallow" };

  // A third press arrived before the deferred clear: the key was held.
  if (state.clearDeadline !== 0 && now < state.clearDeadline) {
    return { state: dropped(now), action: "swallow" };
  }

  if (!canClear) {
    return {
      state: { ...state, pendingPressAt: 0, clearDeadline: 0 },
      action: "forward",
    };
  }

  const isPair = state.pendingPressAt !== 0 && now - state.pendingPressAt < PAIR_MS;

  if (isPair) {
    // With repeats reported, a real second tap is never marked as one, so it is
    // safe to clear immediately. Without that, wait for a possible third press.
    if (repeatAware) {
      return { state: dropped(now), action: "clear" };
    }
    return {
      state: { ...dropped(now), clearDeadline: now + BURST_MS },
      action: "deferClear",
    };
  }

  return { state: { ...state, pendingPressAt: now, clearDeadline: 0 }, action: "hold" };
}

/** State after a deferred clear has run. */
export function markCleared(now: number): EscState {
  return dropped(now);
}
