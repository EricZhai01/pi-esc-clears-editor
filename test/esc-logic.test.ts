import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BURST_MS,
  createEscState,
  handleEscPress,
  markCommitted,
  PAIR_MS,
  SUPPRESS_MS,
  type EscIntent,
  type EscOptions,
} from "../src/esc-logic.ts";

const T = 1_000_000;

/** Editor has text, terminal does NOT report key repeat. */
const typing: EscOptions = { intent: "clear", isRepeat: false, repeatAware: false };
/** Same, terminal reports key repeat (Kitty protocol). */
const typingKitty: EscOptions = { ...typing, repeatAware: true };
/** Editor is empty: a double press opens the rewind list. */
const empty: EscOptions = { intent: "rewind", isRepeat: false, repeatAware: false };
/** Streaming / autocomplete / bash mode: pi owns the escape key. */
const native: EscOptions = { intent: "native", isRepeat: false, repeatAware: false };

function run(events: Array<[number, Partial<EscOptions>]>, base: EscOptions) {
  let state = createEscState();
  return events.map(([at, opts]) => {
    const result = handleEscPress(state, T + at, { ...base, ...opts });
    state = result.state;
    return { action: result.action, state };
  });
}

const actions = (events: Array<[number, Partial<EscOptions>]>, base: EscOptions) =>
  run(events, base).map((e) => e.action);

/** Repeats for a held key: first after the OS initial delay, then at the rate. */
function holdEvents(initialDelay: number, interval: number, span = 4000) {
  const events: Array<[number, Partial<EscOptions>]> = [[0, {}]];
  for (let at = initialDelay; at < span; at += interval) events.push([at, {}]);
  return events;
}

test("esc esc with text defers then commits on a non-reporting terminal", () => {
  assert.deepEqual(actions([[0, {}], [200, {}]], typing), ["hold", "defer"]);
});

test("esc esc with text commits immediately when repeats are reported", () => {
  assert.deepEqual(actions([[0, {}], [200, {}]], typingKitty), ["hold", "commit"]);
});

test("esc esc on an empty editor defers, to open the rewind list", () => {
  const out = run([[0, {}], [200, {}]], empty);
  assert.deepEqual(out.map((e) => e.action), ["hold", "defer"]);
  assert.equal(out[1].state.intent, "rewind");
});

test("streaming forwards both presses so abort still works", () => {
  assert.deepEqual(actions([[0, {}], [200, {}]], native), ["forward", "forward"]);
});

test("a slow second press does not pair", () => {
  assert.deepEqual(actions([[0, {}], [PAIR_MS + 50, {}]], typing), ["hold", "hold"]);
});

test("a third press cancels the deferred commit (held key)", () => {
  assert.deepEqual(actions([[0, {}], [100, {}], [200, {}]], typing), [
    "hold",
    "defer",
    "swallow",
  ]);
});

// Regression for the reported flicker: on an empty editor, forwarding the whole
// burst to pi opened and closed the rewind list once per repeat.
test("holding on an empty editor never forwards an escape", () => {
  const out = actions(holdEvents(500, 90), empty);
  assert.equal(
    out.filter((a) => a === "forward").length,
    0,
    `holding must not forward; got ${out.join(",")}`,
  );
});

test("holding on an empty editor never commits", () => {
  const out = actions(holdEvents(500, 90), empty);
  assert.equal(
    out.filter((a) => a === "commit").length,
    0,
    `holding must not commit; got ${out.join(",")}`,
  );
});

test("holding on an empty editor cancels the deferred commit", () => {
  const out = actions(holdEvents(90, 90, 900), empty);
  const defer = out.indexOf("defer");
  assert.ok(defer !== -1, "the repeat pair is deferred, not performed");
  assert.ok(
    out.slice(defer + 1).includes("swallow"),
    "a following repeat cancels the deferred commit",
  );
});

test("holding with text never clears at any repeat interval below PAIR_MS", () => {
  for (const interval of [30, 50, 90, 150, 250, 300, 350, 390, PAIR_MS - 1]) {
    let state = createEscState();
    const start = T;
    for (let at = start; at < start + 6000; at += interval) {
      const result = handleEscPress(state, at, typing);
      state = result.state;
      assert.notEqual(
        result.action,
        "commit",
        `held key committed at repeat interval ${interval}ms`,
      );
    }
  }
});

test("holding on an empty editor never commits at any repeat interval", () => {
  for (const interval of [30, 50, 90, 150, 250, 300, 350, 390, PAIR_MS - 1]) {
    let state = createEscState();
    const start = T;
    for (let at = start; at < start + 6000; at += interval) {
      const result = handleEscPress(state, at, empty);
      state = result.state;
      assert.notEqual(
        result.action,
        "commit",
        `held key committed at repeat interval ${interval}ms`,
      );
      assert.notEqual(
        result.action,
        "forward",
        `held key forwarded at repeat interval ${interval}ms`,
      );
    }
  }
});

test("a deliberate double tap commits at every gap below PAIR_MS", () => {
  for (const base of [typing, empty]) {
    for (const gap of [30, 60, 100, 150, 250, 350, PAIR_MS - 1]) {
      const first = handleEscPress(createEscState(), T, base);
      assert.equal(first.action, "hold", `${base.intent} gap ${gap}ms first press`);
      const second = handleEscPress(first.state, T + gap, base);
      assert.equal(second.action, "defer", `${base.intent} gap ${gap}ms second press`);
    }
  }
});

test("on a reporting terminal a double tap on an empty editor commits instantly", () => {
  const out = run([[0, {}], [200, {}]], { ...empty, repeatAware: true });
  assert.deepEqual(out.map((e) => e.action), ["hold", "commit"]);
  assert.equal(out[1].state.intent, "rewind");
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

test("holding is ignored right after a commit", () => {
  for (const base of [typing, empty]) {
    const committed = markCommitted(T);
    const result = handleEscPress(committed, T + SUPPRESS_MS - 1, base);
    assert.equal(result.action, "swallow", `${base.intent} after commit`);
  }
});

test("after a burst ends, a genuine double tap still commits", () => {
  for (const base of [typing, empty]) {
    const afterBurst = T + SUPPRESS_MS * 2;
    const first = handleEscPress(createEscState(), afterBurst, base);
    assert.equal(first.action, "hold", `${base.intent} first`);
    const second = handleEscPress(first.state, afterBurst + 150, base);
    assert.equal(second.action, "defer", `${base.intent} second`);
  }
});

test("the deferred commit window is at least the pair window", () => {
  assert.ok(BURST_MS >= PAIR_MS, "otherwise a held key can still commit");
});

test("intent rides along on the hold and the commit", () => {
  for (const intent of ["clear", "rewind"] as EscIntent[]) {
    const first = handleEscPress(createEscState(), T, { ...typing, intent });
    assert.equal(first.state.intent, intent);
    const second = handleEscPress(first.state, T + 100, { ...typing, intent });
    assert.equal(second.state.intent, intent);
  }
});
