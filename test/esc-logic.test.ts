import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BURST_MS,
  createEscState,
  handleEscPress,
  markCleared,
  PAIR_MS,
  SUPPRESS_MS,
  type EscOptions,
} from "../src/esc-logic.ts";

const T = 1_000_000;

/** Text present, agent idle, terminal does NOT report key repeat. */
const typing: EscOptions = { canClear: true, isRepeat: false, repeatAware: false };
/** Same, but the terminal reports key repeat (Kitty protocol). */
const typingKitty: EscOptions = { ...typing, repeatAware: true };
/** Empty editor / streaming / autocomplete / bash mode. */
const native: EscOptions = { canClear: false, isRepeat: false, repeatAware: false };

function run(events: Array<[number, Partial<EscOptions>]>, base: EscOptions = typing) {
  let state = createEscState();
  return events.map(([at, opts]) => {
    const result = handleEscPress(state, T + at, { ...base, ...opts });
    state = result.state;
    return { action: result.action, at };
  });
}

const actions = (events: Array<[number, Partial<EscOptions>]>) =>
  run(events).map((e) => e.action);

test("esc esc with text defers then clears on a non-reporting terminal", () => {
  assert.deepEqual(actions([[0, {}], [200, {}]]), ["hold", "deferClear"]);
});

test("esc esc with text clears immediately when repeats are reported", () => {
  assert.deepEqual(
    run([[0, {}], [200, {}]], typingKitty).map((e) => e.action),
    ["hold", "clear"],
  );
});

test("esc esc on an empty editor forwards both presses", () => {
  assert.deepEqual(actions([[0, native], [200, native]]), ["forward", "forward"]);
});

test("a slow second press does not pair", () => {
  assert.deepEqual(actions([[0, {}], [PAIR_MS + 50, {}]]), ["hold", "hold"]);
});

test("a third press cancels the deferred clear (held key)", () => {
  assert.deepEqual(actions([[0, {}], [100, {}], [200, {}]]), [
    "hold",
    "deferClear",
    "swallow",
  ]);
});

test("holding never forwards an escape, so no rewind list", () => {
  // Press, then repeats every 90ms (typical) for ~2.5s, past the initial delay.
  const events: Array<[number, Partial<EscOptions>]> = [[0, {}]];
  for (let at = 500; at < 3000; at += 90) events.push([at, {}]);
  const out = actions(events);
  assert.equal(
    out.filter((a) => a === "forward").length,
    0,
    `holding must not forward; got ${out.join(",")}`,
  );
});

test("holding cancels the deferred clear instead of performing it", () => {
  const events: Array<[number, Partial<EscOptions>]> = [[0, {}]];
  for (let at = 90; at < 900; at += 90) events.push([at, {}]);
  const out = run(events).map((e) => e.action);
  const defer = out.indexOf("deferClear");
  assert.ok(defer !== -1, "the repeat pair is deferred, not performed");
  assert.ok(
    out.slice(defer + 1).includes("swallow"),
    "a following repeat cancels the deferred clear",
  );
});

test("a reported repeat is swallowed when the terminal reports repeats", () => {
  const result = handleEscPress(createEscState(), T, { ...typingKitty, isRepeat: true });
  assert.equal(result.action, "swallow");
});

test("a repeat flag is ignored when the terminal cannot report repeats", () => {
  // Some terminals set bits that look like a repeat flag without ever sending
  // real repeat events. Only trust the flag when the protocol is actually on.
  const result = handleEscPress(createEscState(), T, { ...typing, isRepeat: true });
  assert.equal(result.action, "hold");
});

test("holding is ignored right after the editor was cleared", () => {
  const cleared = markCleared(T);
  const result = handleEscPress(cleared, T + SUPPRESS_MS - 1, typing);
  assert.equal(result.action, "swallow");
});

test("after a burst ends, a genuine double tap still clears", () => {
  const afterBurst = T + SUPPRESS_MS * 2;
  const first = handleEscPress(createEscState(), afterBurst, typing);
  assert.equal(first.action, "hold");
  const second = handleEscPress(first.state, afterBurst + 150, typing);
  assert.equal(second.action, "deferClear");
});

test("the deferred-clear window covers typical repeat intervals", () => {
  assert.ok(BURST_MS >= 200, "must exceed a repeat interval up to ~200ms");
  assert.ok(PAIR_MS > BURST_MS || PAIR_MS === BURST_MS, "pair window must not be tighter than the burst window");
});

// Regression: with BURST_MS < PAIR_MS, a held key repeating in the band
// between them (BURST_MS, PAIR_MS) cleared the editor, because the deferred
// timer fired before the next repeat could cancel it.
test("a held key never clears at any repeat interval below PAIR_MS", () => {
  for (const interval of [30, 50, 90, 150, 250, 300, 350, 390, PAIR_MS - 1]) {
    let state = createEscState();
    let timerAt: number | null = null;
    const start = T;
    for (let at = start; at < start + 6000; at += interval) {
      if (timerAt !== null && timerAt <= at) {
        assert.fail(`held key cleared the editor at repeat interval ${interval}ms`);
      }
      const result = handleEscPress(state, at, typing);
      state = result.state;
      if (state.clearDeadline !== 0) timerAt = state.clearDeadline;
      else timerAt = null;
    }
  }
});

test("a deliberate double tap clears at every gap below PAIR_MS", () => {
  for (const gap of [30, 60, 100, 150, 250, 350, PAIR_MS - 1]) {
    const first = handleEscPress(createEscState(), T, typing);
    assert.equal(first.action, "hold", `gap ${gap}ms first press`);
    const second = handleEscPress(first.state, T + gap, typing);
    assert.equal(second.action, "deferClear", `gap ${gap}ms second press`);
  }
});
