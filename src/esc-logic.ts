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
 * - Otherwise the commit is deferred. On the second press it is scheduled rather
 *   than performed; if a third press arrives first, the key was held, so the
 *   commit is cancelled and the rest of the burst is dropped.
 */

/** Max gap between two presses to count as a deliberate double press. */
export const PAIR_MS = 400;

/**
 * Grace period after the second press before a deferred commit runs, used only on
 * terminals that do not report key-repeat events. A third press inside this
 * window means the key is held.
 *
 * Must be at least `PAIR_MS`. Any interval below `PAIR_MS` counts as a pair, so
 * a held key producing presses faster than that always schedules another
 * deferred commit. Keeping the grace window at least as long guarantees that
 * next press arrives before the timer fires and cancels it. Shorter values leave
 * a band (BURST_MS to PAIR_MS) where a held key still commits.
 */
export const BURST_MS = PAIR_MS;

/**
 * How long to keep dropping escapes once a held burst is recognised. Refreshed
 * by every dropped escape, so it lasts until the key is released.
 */
export const SUPPRESS_MS = 400;

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
}

export function createEscState(): EscState {
  return { pendingPressAt: 0, suppressUntil: 0, deadline: 0, intent: null };
}

export type EscAction =
  /** Held key or its tail: drop it and cancel anything scheduled. */
  | "swallow"
  /** First press: remember it and drop it. */
  | "hold"
  /** Second press on a repeat-reporting terminal: act now. */
  | "commit"
  /** Second press elsewhere: act after `BURST_MS` unless a third press arrives. */
  | "defer"
  /** Hand the escape straight to pi. */
  | "forward";

export interface EscOptions {
  /** What a completed double press would do in the editor's current state. */
  intent: EscIntent;
  /** Terminal marked this event as a key repeat. */
  isRepeat: boolean;
  /** Whether `isRepeat` can be trusted (Kitty keyboard protocol active). */
  repeatAware: boolean;
}

const dropped = (now: number): EscState => ({
  pendingPressAt: 0,
  suppressUntil: now + SUPPRESS_MS,
  deadline: 0,
  intent: null,
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
  { intent, isRepeat, repeatAware }: EscOptions,
): { state: EscState; action: EscAction } {
  // Authoritative repeat signal, when the terminal provides one.
  if (repeatAware && isRepeat) return { state: dropped(now), action: "swallow" };

  // Still dropping the tail of a held burst.
  if (now < state.suppressUntil) return { state: dropped(now), action: "swallow" };

  // A third press arrived before the deferred commit: the key was held.
  if (state.deadline !== 0 && now < state.deadline) {
    return { state: dropped(now), action: "swallow" };
  }

  if (intent === "native") {
    return {
      state: { ...state, pendingPressAt: 0, deadline: 0, intent: null },
      action: "forward",
    };
  }

  const isPair = state.pendingPressAt !== 0 && now - state.pendingPressAt < PAIR_MS;

  if (isPair) {
    const committed: EscState = { ...dropped(now), intent };
    // With repeats reported, a real second tap is never marked as one, so it is
    // safe to act immediately. Without that, wait for a possible third press.
    return repeatAware
      ? { state: committed, action: "commit" }
      : { state: { ...committed, deadline: now + BURST_MS }, action: "defer" };
  }

  return {
    state: { ...state, pendingPressAt: now, deadline: 0, intent },
    action: "hold",
  };
}

/** State after a deferred commit has run. */
export function markCommitted(now: number): EscState {
  return dropped(now);
}
