import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapMeanInterval, rankedProbabilityScore, wilsonInterval } from "../lib/statistics.mjs";

test("ranked probability score rewards a confident correct ordered outcome", () => {
  assert.ok(rankedProbabilityScore([.8, .15, .05], 0) < rankedProbabilityScore([.05, .15, .8], 0));
});

test("wilson interval contains the observed hit rate", () => {
  const interval = wilsonInterval(83, 100);
  assert.ok(interval.low < .83 && interval.high > .83);
});

test("bootstrap mean interval is deterministic and contains the sample mean", () => {
  const first = bootstrapMeanInterval([1, -1, 1, 1, -1]);
  const second = bootstrapMeanInterval([1, -1, 1, 1, -1]);
  assert.deepEqual(first, second);
  assert.ok(first.low <= .2 && first.high >= .2);
});
