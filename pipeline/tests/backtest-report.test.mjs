import test from "node:test";
import assert from "node:assert/strict";
import { backtestHistory } from "../lib/backtest.mjs";

test("expanded report counts settled examples and excludes DNB voids", () => {
  const events = Array.from({length: 8}, (_,i) => ({ id: String(i), status: "FINISHED", kickoff: `2025-01-${String(i+1).padStart(2,"0")}T12:00:00Z`, homeTeam: { id: "a", name: "A" }, awayTeam: { id: "b", name: "B" }, league: {id:"test",name:"Test"}, homeScore: 1, awayScore: i % 2, odds: [
    {selectionId:"home",odds:1.8},{selectionId:"draw",odds:3.4},{selectionId:"away",odds:4.8},
  ] }));
  const report = backtestHistory(events, {sampleSize: 4, minimumTraining: 2});
  assert.equal(report.matches, 4);
  const dnb = report.markets.find(r => r.key === "DNB_HOME");
  assert.equal(dnb.matches, 2);
  assert.equal(dnb.voids, 2);
  assert.equal(report.baseline.accuracy, .5);
  assert.ok(report.markets.every(r => r.selected <= r.matches));
  assert.equal(report.pricingAudit.probabilityModels[0].matches, 4);
  assert.match(report.pricingAudit.conclusion, /primary probability baseline/);
});
