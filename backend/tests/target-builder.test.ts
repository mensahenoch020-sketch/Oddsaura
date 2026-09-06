import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetSlip } from "../../app/builder/target-builder.js";
import type { PredictedPick } from "../../app/data.js";

function pick(id: string, odds: number, confidence = .7): PredictedPick {
  return { id, fixtureId: id, kickoff: "2030-01-02T12:00:00Z", league: { name: "Test" }, homeTeam: { name: `${id} Home` }, awayTeam: { name: `${id} Away` }, market: { key: "OVER_1_5", name: "Over 1.5", category: "TOTALS", line: 1.5 }, selection: "Over 1.5", probability: confidence, confidence, quotedOdds: odds, fairOdds: odds, tier: "SAFE", dataQuality: "HIGH", historyMatches: 20, marketProbability: confidence - .01, modelMarketGap: .03, expectedValue: -.01, reasoning: "test" };
}

test("target builder follows requested totals through 50 odds", () => {
  const rows = Array.from({ length: 24 }, (_, index) => pick(`f${index}`, 1.35 + (index % 5) * .08));
  const five = buildTargetSlip(rows, 5, Date.parse("2029-01-01"));
  const twenty = buildTargetSlip(rows, 20, Date.parse("2029-01-01"));
  const fifty = buildTargetSlip(rows, 50, Date.parse("2029-01-01"));
  assert.ok(five && Math.abs(five.estimatedOdds - 5) / 5 < .08);
  assert.ok(twenty && Math.abs(twenty.estimatedOdds - 20) / 20 < .08);
  assert.ok(fifty && Math.abs(fifty.estimatedOdds - 50) / 50 < .08);
  assert.ok(twenty.picks.length > five.picks.length);
  assert.ok(fifty.picks.length > twenty.picks.length);
});

test("target builder never repeats a fixture or includes a started match", () => {
  const rows = [pick("same", 1.7), { ...pick("other-market", 1.8), fixtureId: "same" }, { ...pick("started", 2), kickoff: "2028-01-01T12:00:00Z" }, pick("future", 1.9)];
  const result = buildTargetSlip(rows, 3, Date.parse("2029-01-01"));
  assert.ok(result);
  assert.equal(new Set(result.picks.map((item) => item.fixtureId)).size, result.picks.length);
  assert.equal(result.picks.some((item) => item.id === "started"), false);
});

test("target builder rejects unsupported bookmaker markets and unconfirmed prices", () => {
  const unsupported = Array.from({ length: 4 }, (_, index) => ({ ...pick(`btts${index}`, 1.45, .72), market: { key: "BTTS_YES", name: "Both teams to score", category: "GOALS" }, selection: "Yes" }));
  assert.equal(buildTargetSlip(unsupported, 2, Date.parse("2029-01-01"), "betway"), null);
  const estimated = Array.from({ length: 4 }, (_, index) => ({ ...pick(`raw${index}`, 1.45, .72), quotedOdds: null, marketProbability: null, expectedValue: null }));
  assert.ok(buildTargetSlip(estimated, 2, Date.parse("2029-01-01"), "sportybet", "target"));
  assert.equal(buildTargetSlip(estimated, 2, Date.parse("2029-01-01"), "sportybet", "recommended"), null);
});

test("target builder uses verified live prices when rebuilding a short slip", () => {
  const rows = Array.from({ length: 24 }, (_, index) => pick(`live${index}`, 1.45, .72));
  const first = buildTargetSlip(rows, 20, Date.parse("2029-01-01"));
  assert.ok(first);
  const livePrices = Object.fromEntries(first.picks.map((item) => [item.fixtureId, 1.25]));
  const retry = buildTargetSlip(rows, 20, Date.parse("2029-01-01"), "sportybet", "target", livePrices);
  assert.ok(retry);
  assert.ok(retry.picks.length > first.picks.length);
  assert.ok(Math.abs(retry.estimatedOdds - 20) < Math.abs(first.picks.reduce((odds) => odds * 1.25, 1) - 20));
});
