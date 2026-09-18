import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEscState,
  DOUBLE_ESCAPE_MS,
  handleEscPress,
  isDoubleEscape,
  isEscapeRepeat,
  REPEAT_IGNORE_MS,
} from "../src/esc-logic.ts";

const T = 1_000_000;

test("thresholds: 49ms repeat guard, 500ms double press to match pi", () => {
  assert.equal(REPEAT_IGNORE_MS, 49);
  assert.equal(DOUBLE_ESCAPE_MS, 500);
});

test("first press is never a repeat or a double press", () => {
  assert.equal(isEscapeRepeat(T, 0), false);
  assert.equal(isDoubleEscape(T, 0), false);
});

test("the repeat and double-press boundaries are exclusive", () => {
  assert.equal(isEscapeRepeat(T + 48, T), true);
  assert.equal(isEscapeRepeat(T + 49, T), false);
  assert.equal(isDoubleEscape(T + 499, T), true);
  assert.equal(isDoubleEscape(T + 500, T), false);
});

test("esc esc with text clears", () => {
  const first = handleEscPress(createEscState(), T, true);
  assert.equal(first.action, "forward");

  const second = handleEscPress(first.state, T + 200, true);
  assert.equal(second.action, "clear");
});

test("esc esc on an empty editor forwards both presses", () => {
  const first = handleEscPress(createEscState(), T, false);
  assert.equal(first.action, "forward");

  const second = handleEscPress(first.state, T + 200, false);
  assert.equal(second.action, "forward");
});

test("a slow second press does not clear", () => {
  const first = handleEscPress(createEscState(), T, true);
  const second = handleEscPress(first.state, T + 600, true);
  assert.equal(second.action, "forward");
});

test("held escape is swallowed and never clears", () => {
  let state = createEscState();
  // First genuine press still forwards.
  const first = handleEscPress(state, T, true);
  assert.equal(first.action, "forward");
  state = first.state;

  // Then the key is held: ~30ms repeats for 3 seconds.
  let now = T;
  for (let i = 0; i < 100; i++) {
    now += 30;
    const result = handleEscPress(state, now, true);
    assert.equal(result.action, "swallow");
    state = result.state;
  }

  // Releasing and pressing once more is a fresh single press, not a clear.
  const after = handleEscPress(state, now + 200, true);
  assert.equal(after.action, "forward");
});

test("holding escape does not drift the double-press window", () => {
  // Regression: if repeats advanced lastPressAt, a press a full second later
  // would still be treated as a double press.
  let state = handleEscPress(createEscState(), T, true).state;
  let lastRepeat = T;
  for (let now = T + 30; now < T + 1000; now += 30) {
    state = handleEscPress(state, now, true).state;
    lastRepeat = now;
  }
  // Release the key, then press once more. Over a second has passed since the
  // first press, so this must forward rather than clear.
  const late = handleEscPress(state, lastRepeat + 200, true);
  assert.equal(late.action, "forward");
});

test("aborting a running task does not also clear text typed meanwhile", () => {
  // While streaming, canClear is false, so an abort double-tap must not arm a
  // clear for the next press.
  const first = handleEscPress(createEscState(), T, false);
  const second = handleEscPress(first.state, T + 200, false);
  assert.equal(second.action, "forward");

  // The user types text and presses esc once; it must forward, not clear.
  const third = handleEscPress(second.state, T + 400, true);
  assert.equal(third.action, "forward");
});

test("any other key resets the pending double press", () => {
  const first = handleEscPress(createEscState(), T, true);
  const state = createEscState(); // what handleInput does on a non-escape key
  const second = handleEscPress(state, T + 200, true);
  assert.equal(second.action, "forward");
});

test("two clean presses 90ms apart clear", () => {
  const first = handleEscPress(createEscState(), T, true);
  const second = handleEscPress(first.state, T + 90, true);
  assert.equal(second.action, "clear");
});
