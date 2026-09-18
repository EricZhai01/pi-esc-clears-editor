/**
 * Pure helpers, kept free of pi imports so they can be unit tested without the
 * host application installed.
 */

/**
 * Terminal auto-repeat emits escape bytes roughly every 30ms while a key is
 * held. Presses closer together than this are treated as one held key, so
 * holding Escape can never be mistaken for a deliberate double press.
 */
export const REPEAT_IGNORE_MS = 49;

/**
 * Window for a deliberate double press. Matches pi's own double-escape window,
 * so clearing and the rewind list feel like one gesture.
 */
export const DOUBLE_ESCAPE_MS = 500;

export interface EscState {
  /** When the last genuine (non-repeat) press happened. 0 means none. */
  lastPressAt: number;
  /** When any escape byte last arrived, repeats included. */
  lastEventAt: number;
  /** Whether the last genuine press was one we could have cleared on. */
  lastPressClearable: boolean;
}

export type EscAction =
  /** Held-key auto-repeat: drop it. */
  | "swallow"
  /** Second deliberate press with text: clear the editor. */
  | "clear"
  /** A normal press: hand it to pi. */
  | "forward";

export function createEscState(): EscState {
  return { lastPressAt: 0, lastEventAt: 0, lastPressClearable: false };
}

/** True when `now` continues a held-key burst that started at `lastEventAt`. */
export function isEscapeRepeat(now: number, lastEventAt: number): boolean {
  return lastEventAt !== 0 && now - lastEventAt < REPEAT_IGNORE_MS;
}

/** True when `now` completes a deliberate double press started at `lastPressAt`. */
export function isDoubleEscape(now: number, lastPressAt: number): boolean {
  return lastPressAt !== 0 && now - lastPressAt < DOUBLE_ESCAPE_MS;
}

/**
 * Decide what to do with an escape press.
 *
 * Repeats only advance `lastEventAt`, never `lastPressAt`, so holding the key
 * cannot drift the double-press window and turn a later single press into a
 * surprise clear.
 *
 * `clear` additionally requires the previous press to have been clearable. That
 * stops a double tap used to abort a running task from also wiping text typed
 * while the task was running.
 */
export function handleEscPress(
  state: EscState,
  now: number,
  canClear: boolean,
): { state: EscState; action: EscAction } {
  if (isEscapeRepeat(now, state.lastEventAt)) {
    return { state: { ...state, lastEventAt: now }, action: "swallow" };
  }

  if (canClear && state.lastPressClearable && isDoubleEscape(now, state.lastPressAt)) {
    return { state: createEscState(), action: "clear" };
  }

  return {
    state: { lastPressAt: now, lastEventAt: now, lastPressClearable: canClear },
    action: "forward",
  };
}
