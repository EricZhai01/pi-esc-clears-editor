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
  type EscState,
} from "../src/esc-logic.ts";

const T = 1_000_000;

const typing: EscOptions = { intent: "clear", isRepeat: false };
const empty: EscOptions = { intent: "rewind", isRepeat: false };
const native: EscOptions = { intent: "native", isRepeat: false };

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

test("esc esc with text defers then commits", () => {
  assert.deepEqual(actions([[0, {}], [200, {}]], typing), ["hold", "defer"]);
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

// Regression: on an empty editor, forwarding the whole burst to pi opened and
// closed the rewind list once per repeat.
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

/**
 * Replay a hold against the real machine, firing the deferred timer if no key
 * arrives to cancel it. This is the check that matters: a commit or a forward
 * here means holding Esc would clear the editor or flicker the rewind list.
 */
function replayHold(
  initialDelay: number,
  interval: number,
  base: EscOptions,
  span = 8000,
): { commits: number; forwards: number } {
  const start = T;
  const keys: number[] = [start];
  for (let at = start + initialDelay; at < start + span; at += interval) keys.push(at);
  keys.sort((a, b) => a - b);

  let state: EscState = createEscState();
  let commits = 0;
  let forwards = 0;
  let timerAt: number | null = null;

  for (let i = 0; i < keys.length; i++) {
    const at = keys[i]!;
    // Fire a due deferred commit before this key can cancel it.
    if (timerAt !== null && timerAt <= at) {
      commits++;
      timerAt = null;
      state = { ...state, suppressUntil: at + SUPPRESS_MS, deadline: 0 };
    }
    const result = handleEscPress(state, at, base);
    state = result.state;
    if (result.action === "commit") commits++;
    if (result.action === "forward") forwards++;
    timerAt = state.deadline !== 0 ? state.deadline : null;
  }
  if (timerAt !== null) commits++;
  return { commits, forwards };
}

test("replaying a hold never commits or forwards, at any repeat rate", () => {
  for (const base of [typing, empty]) {
    for (const delay of [250, 500, 1000]) {
      for (const interval of [10, 20, 30, 50, 80, 100, 150, 200, 249, 400, 500]) {
        const { commits, forwards } = replayHold(delay, interval, base);
        assert.equal(
          commits,
          0,
          `${base.intent}: hold committed (delay ${delay}ms, repeat ${interval}ms)`,
        );
        assert.equal(
          forwards,
          0,
          `${base.intent}: hold forwarded (delay ${delay}ms, repeat ${interval}ms)`,
        );
      }
    }
  }
});

test("a deliberate double tap pairs at every gap below PAIR_MS", () => {
  for (const base of [typing, empty]) {
    for (const gap of [10, 30, 60, 100, 150, 200, PAIR_MS - 1]) {
      const first = handleEscPress(createEscState(), T, base);
      assert.equal(first.action, "hold", `${base.intent} gap ${gap}ms first press`);
      const second = handleEscPress(first.state, T + gap, base);
      assert.equal(second.action, "defer", `${base.intent} gap ${gap}ms second press`);
    }
  }
});

test("a marked repeat is swallowed and never pairs", () => {
  const first = handleEscPress(createEscState(), T, typing);
  assert.equal(first.action, "hold");
  const repeat = handleEscPress(first.state, T + 90, { ...typing, isRepeat: true });
  assert.equal(repeat.action, "swallow");
  assert.equal(repeat.state.intent, null, "a repeat must not arm a pending press");
});

test("one marked repeat enables instant commits for later taps", () => {
  // The flag is only ever set by observing a marked repeat, so it does not
  // depend on any terminal capability API.
  let state = handleEscPress(createEscState(), T, typing).state;
  state = handleEscPress(state, T + 90, { ...typing, isRepeat: true }).state;
  assert.equal(state.repeatsReported, true);

  // Past the suppress window, a genuine tap pair now commits without waiting.
  const a = handleEscPress(state, T + SUPPRESS_MS + 100, typing);
  assert.equal(a.action, "hold");
  const b = handleEscPress(a.state, T + SUPPRESS_MS + 300, typing);
  assert.equal(b.action, "commit");
});

test("holding is ignored right after a commit", () => {
  for (const base of [typing, empty]) {
    const state = markCommitted(createEscState(), T);
    const result = handleEscPress(state, T + SUPPRESS_MS - 1, base);
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
  assert.ok(SUPPRESS_MS > BURST_MS, "a suppressed burst must not resume mid-hold");
});

test("the delay is the burst window and nothing else", () => {
  // The reported lag: a double tap should never wait longer than BURST_MS.
  assert.ok(BURST_MS <= 300, `double tap waits ${BURST_MS}ms`);
});

test("intent rides along on the hold and the commit", () => {
  for (const intent of ["clear", "rewind"] as EscIntent[]) {
    const first = handleEscPress(createEscState(), T, { ...typing, intent });
    assert.equal(first.state.intent, intent);
    const second = handleEscPress(first.state, T + 100, { ...typing, intent });
    assert.equal(second.state.intent, intent);
  }
});
