import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetSlip } from "../../app/builder/target-builder.js";
import type { PredictedPick } from "../../app/data.js";

function pick(id: string, odds: number, confidence = .7): PredictedPick {
  return { id, fixtureId: id, kickoff: "2030-01-02T12:00:00Z", league: { name: "Test" }, homeTeam: { name: `${id} Home` }, awayTeam: { name: `${id} Away` }, market: { key: "OVER_1_5", name: "Over 1.5", category: "TOTALS", line: 1.5 }, selection: "Over 1.5", probability: confidence, confidence, quotedOdds: odds, fairOdds: odds, tier: "SAFE", dataQuality: "HIGH", historyMatches: 20, reasoning: "test" };
}

test("target builder follows the requested total instead of returning two odds", () => {
  const rows = Array.from({ length: 12 }, (_, index) => pick(`f${index}`, 1.5 + (index % 3) * .08));
  const five = buildTargetSlip(rows, 5, Date.parse("2029-01-01"));
  const twenty = buildTargetSlip(rows, 20, Date.parse("2029-01-01"));
  assert.ok(five && Math.abs(five.estimatedOdds - 5) < 1.5);
  assert.ok(twenty && twenty.estimatedOdds > 14);
  assert.ok(twenty.picks.length > five.picks.length);
});

test("target builder never repeats a fixture or includes a started match", () => {
  const rows = [pick("same", 1.7), { ...pick("other-market", 1.8), fixtureId: "same" }, { ...pick("started", 2), kickoff: "2028-01-01T12:00:00Z" }, pick("future", 1.9)];
  const result = buildTargetSlip(rows, 3, Date.parse("2029-01-01"));
  assert.ok(result);
  assert.equal(new Set(result.picks.map((item) => item.fixtureId)).size, result.picks.length);
  assert.equal(result.picks.some((item) => item.id === "started"), false);
});
