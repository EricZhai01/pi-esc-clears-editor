/**
 * Pure helpers, kept free of pi imports so they can be unit tested without the
 * host application installed.
 */

/**
 * Terminal auto-repeat emits escape bytes roughly every 30ms while a key is
 * held. Presses closer together than this are treated as one held key, so
 * holding Escape cannot clear the editor twice or open the rewind list.
 */
export const REPEAT_IGNORE_MS = 49;

/** True when `now` continues a held-key burst that started at `lastPressAt`. */
export function isEscapeRepeat(now: number, lastPressAt: number): boolean {
  return lastPressAt !== 0 && now - lastPressAt < REPEAT_IGNORE_MS;
}
