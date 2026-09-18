import { test } from "node:test";
import assert from "node:assert/strict";
import { isEscapeRepeat, REPEAT_IGNORE_MS } from "../src/esc-logic.ts";

test("repeat window is 49ms", () => {
  assert.equal(REPEAT_IGNORE_MS, 49);
});

test("first press is never a repeat", () => {
  assert.equal(isEscapeRepeat(1_000_000, 0), false);
});

test("auto-repeat intervals while a key is held are repeats", () => {
  const start = 1_000_000;
  assert.equal(isEscapeRepeat(start + 30, start), true);
  assert.equal(isEscapeRepeat(start + 10, start), true);
});

test("the 49ms boundary is exclusive", () => {
  const start = 1_000_000;
  assert.equal(isEscapeRepeat(start + 48, start), true);
  assert.equal(isEscapeRepeat(start + 49, start), false);
});

test("a deliberate double tap is not a repeat", () => {
  const start = 1_000_000;
  assert.equal(isEscapeRepeat(start + 250, start), false);
});

test("holding escape never chains into a fake double press", () => {
  // Simulate holding the key: the timestamp is refreshed on every swallowed
  // repeat, so the burst stays swallowed indefinitely.
  let last = 1_000_000;
  for (let i = 0; i < 100; i++) {
    const now = last + 30;
    assert.equal(isEscapeRepeat(now, last), true);
    last = now;
  }
});
