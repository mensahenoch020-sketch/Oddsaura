import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetSlip, correctedSearchTarget, rankBestBets } from "../../app/builder/target-builder.js";
import { BookmakerCodeError, unavailableFixtureId } from "../../app/builder/providers.js";
import type { PredictedPick } from "../../app/data.js";
import { interpretAssistantRequest, matchesRequestedMarket } from "../../app/assistant/nlu.js";

function pick(id: string, odds: number, confidence = .7): PredictedPick {
  return { id, fixtureId: id, kickoff: "2030-01-02T12:00:00Z", league: { name: "Test" }, homeTeam: { name: `${id} Home` }, awayTeam: { name: `${id} Away` }, market: { key: "OVER_1_5", name: "Over 1.5", category: "TOTALS", line: 1.5 }, selection: "Over 1.5", probability: confidence, confidence, quotedOdds: odds, fairOdds: odds, tier: "SAFE", dataQuality: "HIGH", historyMatches: 80, marketProbability: confidence - .01, modelMarketGap: .03, expectedValue: .01, reasoning: "test" };
}

test("target builder follows requested totals beyond the old 100 odds ceiling", () => {
  const rows = Array.from({ length: 40 }, (_, index) => pick(`f${index}`, 1.35 + (index % 5) * .08));
  const five = buildTargetSlip(rows, 5, Date.parse("2029-01-01"));
  const twenty = buildTargetSlip(rows, 20, Date.parse("2029-01-01"));
  const fifty = buildTargetSlip(rows, 50, Date.parse("2029-01-01"));
  const fiveHundred = buildTargetSlip(rows, 500, Date.parse("2029-01-01"));
  const oneThousand = buildTargetSlip(rows, 1000, Date.parse("2029-01-01"));
  assert.ok(five && Math.abs(five.estimatedOdds - 5) / 5 < .08);
  assert.ok(twenty && Math.abs(twenty.estimatedOdds - 20) / 20 < .08);
  assert.ok(fifty && Math.abs(fifty.estimatedOdds - 50) / 50 < .08);
  assert.ok(fiveHundred && Math.abs(fiveHundred.estimatedOdds - 500) / 500 < .08);
  assert.ok(oneThousand && Math.abs(oneThousand.estimatedOdds - 1000) / 1000 < .08);
  assert.ok(twenty.picks.length > five.picks.length);
  assert.ok(fifty.picks.length > twenty.picks.length);
  assert.equal(oneThousand.target, 1000);
});

test("Best Bet keeps individually qualified matches when the full target is unavailable", () => {
  const rows = [pick("best", 1.57, .7)];
  const ranked = rankBestBets(rows, Date.parse("2029-01-01"));
  const result = buildTargetSlip(rows, 2, Date.parse("2029-01-01"), "sportybet", "recommended");
  assert.equal(ranked.length, 1);
  assert.equal(result?.picks[0]?.id, "best");
  assert.equal(result?.exact, false);
});

test("Best Bet rotates through equally qualified evidence-approved market families", () => {
  const markets = [
    ["MATCH_HOME", "Match result", "Home"],
    ["OVER_1_5", "Total goals", "Over 1.5"],
    ["DC_1X", "Double chance", "Home or draw"],
    ["DNB_HOME", "Draw no bet", "Home"],
  ] as const;
  const rows = markets.flatMap(([key, name, selection], familyIndex) => Array.from({ length: 4 }, (_, index) => ({
    ...pick(`${familyIndex}-${index}`, 1.42, .72 - index * .002),
    market: { key, name, category: "TEST", line: null },
    selection,
  })));
  const ranked = rankBestBets(rows, Date.parse("2029-01-01"));
  assert.equal(new Set(ranked.slice(0, 4).map((item) => item.market.key.replace(/^(MATCH_|DC_|DNB_|OVER_).*/, "$1"))).size, 4);
});

test("removed 2.5 totals never appear in target or recommended slips", () => {
  const rows = ['OVER_2_5', 'UNDER_2_5'].map(key => ({ ...pick(key, 1.5, .8), market: { key, name: 'Total goals', category: 'TOTALS', line: 2.5 } }));
  for (const mode of ['target', 'recommended'] as const) assert.equal(buildTargetSlip(rows, 2, Date.parse('2029-01-01'), 'sportybet', mode), null);
  assert.deepEqual(rankBestBets(rows, Date.parse('2029-01-01')), []);
});

test("target builder never repeats a fixture or includes a started match", () => {
  const rows = [pick("same", 1.7), { ...pick("other-market", 1.8), fixtureId: "same" }, { ...pick("started", 2), kickoff: "2028-01-01T12:00:00Z" }, pick("future", 1.9)];
  const result = buildTargetSlip(rows, 3, Date.parse("2029-01-01"));
  assert.ok(result);
  assert.equal(new Set(result.picks.map((item) => item.fixtureId)).size, result.picks.length);
  assert.equal(result.picks.some((item) => item.id === "started"), false);
});

test("target builder evaluates alternative qualified markets without repeating a fixture", () => {
  const rows = [
    { ...pick("a-top", 1.2, .82), fixtureId: "a" },
    { ...pick("a-alt", 2, .7), fixtureId: "a", market: { key: "MATCH_HOME", name: "Match result", category: "RESULT" }, selection: "Home" },
    { ...pick("b-top", 1.2, .81), fixtureId: "b" },
    { ...pick("b-alt", 2, .69), fixtureId: "b", market: { key: "MATCH_AWAY", name: "Match result", category: "RESULT" }, selection: "Away" },
  ];
  const result = buildTargetSlip(rows, 4, Date.parse("2029-01-01"));
  assert.ok(result);
  assert.equal(result.exact, true);
  assert.equal(result.estimatedOdds, 4);
  assert.equal(new Set(result.picks.map(item => item.fixtureId)).size, result.picks.length);
});

test("request market restriction reaches builder and never substitutes another market", () => {
  const request = interpretAssistantRequest('20 odds sporty over 1.5 only');
  assert.equal(request.kind, 'build');
  if (request.kind !== 'build') return;
  const rows = [pick('total', 1.4), { ...pick('home', 1.5), market: { key: 'MATCH_HOME', name: 'Result', category: 'RESULT' } }];
  const filtered = rows.filter(row => matchesRequestedMarket(row.market.key, request.marketKeys));
  assert.deepEqual(filtered.map(row => row.id), ['total']);
  assert.equal(buildTargetSlip(filtered, 20, Date.parse('2029-01-01')), null);
});

test("eligibility changes with current time and rejects malformed kickoff or price", () => {
  const row = { ...pick('clock', 1.6), kickoff: '2030-01-02T12:00:00Z' };
  assert.equal(rankBestBets([row], Date.parse('2030-01-02T11:00:00Z')).length, 1);
  assert.equal(rankBestBets([row], Date.parse('2030-01-02T11:31:00Z')).length, 0);
  assert.equal(rankBestBets([{ ...row, kickoff: 'invalid' }], Date.parse('2029-01-01')).length, 0);
  assert.equal(buildTargetSlip([{ ...row, quotedOdds: NaN }], 1.6, Date.parse('2029-01-01')), null);
});

test("target builder rejects unsupported bookmaker markets and unconfirmed prices", () => {
  const unsupported = Array.from({ length: 4 }, (_, index) => ({ ...pick(`btts${index}`, 1.45, .72), market: { key: "BTTS_YES", name: "Both teams to score", category: "GOALS" }, selection: "Yes" }));
  assert.equal(buildTargetSlip(unsupported, 2, Date.parse("2029-01-01"), "betway"), null);
  const estimated = Array.from({ length: 4 }, (_, index) => ({ ...pick(`raw${index}`, 1.45, .72), quotedOdds: null, marketProbability: null, expectedValue: null }));
  assert.equal(buildTargetSlip(estimated, 2, Date.parse("2029-01-01"), "sportybet", "target"), null);
  assert.equal(buildTargetSlip(estimated, 2, Date.parse("2029-01-01"), "sportybet", "recommended"), null);
});

test("public builders reject negative expected-value selections", () => {
  const negative = Array.from({ length: 5 }, (_, index) => ({ ...pick(`negative${index}`, 1.45, .72), expectedValue: -.001 }));
  assert.equal(rankBestBets(negative, Date.parse("2029-01-01")).length, 0);
  assert.equal(buildTargetSlip(negative, 2, Date.parse("2029-01-01")), null);
});
test("published markets add tested BTTS and team-goal variety while weak markets stay blocked", () => {
  const tested = [
    { ...pick("btts", 1.55, .7), market: { key: "BTTS_YES", name: "Both teams to score", category: "GOALS" }, selection: "Yes" },
    { ...pick("team-goal", 1.32, .72), market: { key: "HOME_OVER_0_5", name: "Home team goals", category: "TEAM", line: .5 }, selection: "Over 0.5" },
  ];
  assert.ok(buildTargetSlip(tested, 2, Date.parse("2029-01-01"), "sportybet"));
  const weak = { ...pick("clean", 1.7, .72), market: { key: "HOME_CLEAN", name: "Clean sheet", category: "TEAM" }, selection: "Home" };
  assert.equal(buildTargetSlip([weak], 1.7, Date.parse("2029-01-01"), "sportybet"), null);
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

test("target retry corrects its search total in the direction of live price drift", () => {
  assert.ok(correctedSearchTarget(2, 1.54) > 2);
  assert.ok(correctedSearchTarget(2, 2.12) < 2);
  assert.equal(correctedSearchTarget(2, Number.NaN), 2);
  assert.ok(correctedSearchTarget(500, 350) > 500);
});

test("target retry can identify and exclude an unavailable bookmaker fixture", () => {
  assert.equal(unavailableFixtureId(new BookmakerCodeError("missing", { fixtureId: "fixture-7" })), "fixture-7");
  assert.equal(unavailableFixtureId(new BookmakerCodeError("missing", { unmatched: [{ fixtureId: "fixture-8" }] })), "fixture-8");
  assert.equal(unavailableFixtureId(new Error("missing")), null);
});
