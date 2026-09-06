import assert from "node:assert/strict";
import test from "node:test";
import { attachOdds, buildModelContext, scoreEvent } from "../lib/model.mjs";
import { buildTicket } from "../lib/tickets.mjs";
import { normalizeEspnEvent, normalizeEspnGlobalEvent } from "../lib/espn.mjs";
import { normalizeFootballDataRow, parseCsv } from "../lib/football-data.mjs";
import { canonicalTeamId } from "../lib/identity.mjs";

const finished = (id, days, homeId, awayId, homeScore, awayScore) => ({ id, kickoff: new Date(Date.now() - days * 86_400_000).toISOString(), status: "FINISHED", homeTeam: { id: homeId, name: homeId }, awayTeam: { id: awayId, name: awayId }, homeScore, awayScore });
const history = [
  finished("1", 2, "A", "C", 3, 0), finished("2", 4, "D", "A", 0, 2), finished("3", 6, "A", "E", 2, 0),
  finished("4", 3, "B", "F", 0, 2), finished("5", 5, "G", "B", 2, 1), finished("6", 7, "B", "H", 1, 1),
];
const fixture = { id: "next", kickoff: new Date(Date.now() + 86_400_000).toISOString(), status: "SCHEDULED", homeTeam: { id: "A", name: "Alpha" }, awayTeam: { id: "B", name: "Beta" }, league: { name: "Test League" }, odds: [] };

test("the keyless model exposes many flexible markets", () => {
  const predictions = scoreEvent(fixture, history);
  assert.ok(predictions.length > 30);
  assert.ok(predictions.some((item) => item.key === "DC_1X"));
  assert.ok(predictions.some((item) => item.key.startsWith("HCP_3WAY_")));
  assert.ok(!predictions.some((item) => item.name === "Correct score"));
  assert.ok(!predictions.some((item) => item.key.startsWith("ONE_UP_") || item.key.startsWith("TWO_UP_")));
  assert.ok(predictions.find((item) => item.key === "MATCH_HOME").probability > predictions.find((item) => item.key === "MATCH_AWAY").probability);
});

test("fixtures with no team history still receive cautious model probabilities", () => {
  const predictions = scoreEvent(fixture, []);
  assert.ok(predictions.length > 30);
  assert.equal(predictions[0].factors.homePlayed, 0);
  assert.ok(predictions.every((item) => item.dataQuality < 0.2));
  assert.ok(predictions.some((item) => item.key === "OVER_1_5"));
});

test("the model context adds opponent-adjusted Elo and venue history", () => {
  const context = buildModelContext(history, fixture.kickoff);
  const home = scoreEvent(fixture, history, context).find((item) => item.key === "MATCH_HOME");
  assert.ok(home.factors.homeElo > home.factors.awayElo);
  assert.ok(home.factors.homeVenuePlayed > 0);
  assert.equal(home.factors.homeHistoryPlayed, 3);
  assert.ok(home.factors.minimumLongHistory > 0);
  assert.ok(Number.isFinite(home.factors.homeRestDays));
});

test("historical CSV rows normalize into the same permanent team identities", () => {
  const rows = parseCsv("Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,B365H,B365D,B365A,Avg>2.5,Avg<2.5,AHh,AvgAHH,AvgAHA\n20/08/2026,20:00,Wolves,Man United,2,1,2.4,3.2,2.9,1.8,2.1,-0.25,1.95,1.9\n");
  const event = normalizeFootballDataRow(rows[0], { code: "E0", id: "eng.1", name: "Premier League", country: "England" }, "2026-27");
  assert.equal(event.homeTeam.id, canonicalTeamId("Wolverhampton Wanderers"));
  assert.equal(event.awayTeam.id, canonicalTeamId("Manchester United"));
  assert.equal(event.odds.length, 7);
  assert.equal(event.odds.find((odd) => odd.selection === "Over 2.5").odds, 1.8);
  assert.equal(event.odds.find((odd) => odd.market === "Asian handicap").line, -0.25);
});

test("quoted odds keep the provider mapping needed for future booking codes", () => {
  const predictions = scoreEvent(fixture, history);
  const priced = attachOdds(predictions, [{ market: "Match winner", selection: "1", odds: 1.6, source: "public-json", marketId: "m1", selectionId: "s1", provider: "Example", deepLink: "https://example.com/bet" }]);
  assert.equal(priced.find((item) => item.key === "MATCH_HOME").quotedOdds, 1.6);
  assert.equal(priced.find((item) => item.key === "MATCH_HOME").oddsProvider, "Example");
  assert.equal(priced.find((item) => item.key === "MATCH_HOME").providerDeepLink, "https://example.com/bet");
});

test("odds matching never confuses match totals with team totals or missing lines", () => {
  const predictions = scoreEvent(fixture, history);
  const wrongFamily = attachOdds(predictions, [{ market: "Home team goals", selection: "Over 1.5", line: 1.5, odds: 1.7, source: "test", marketId: "home-total", selectionId: "over" }]);
  assert.equal(wrongFamily.find((item) => item.key === "OVER_1_5").quotedOdds, null);
  const missingLine = attachOdds(predictions, [{ market: "Total goals", selection: "Over", odds: 1.7, source: "test", marketId: "total", selectionId: "over" }]);
  assert.equal(missingLine.find((item) => item.key === "OVER_1_5").quotedOdds, null);
});

test("priced predictions use the de-margined market as the primary baseline", () => {
  const predictions = scoreEvent(fixture, history);
  const prices = [
    { market: "Match result", selection: "1", odds: 1.8, source: "test", marketId: "result", selectionId: "home" },
    { market: "Match result", selection: "X", odds: 3.5, source: "test", marketId: "result", selectionId: "draw" },
    { market: "Match result", selection: "2", odds: 5, source: "test", marketId: "result", selectionId: "away" },
  ];
  const home = attachOdds(predictions, prices).find((item) => item.key === "MATCH_HOME");
  assert.ok(home.marketProbability > 0);
  assert.ok(Math.abs(home.probability - home.marketProbability) < Math.abs(home.modelProbability - home.marketProbability));
});

test("the global board normalizes broad fixtures and team badges", () => {
  const event = normalizeEspnGlobalEvent({
    id: "900", uid: "s:600~l:700~e:900", date: "2026-08-23T14:00:00Z", season: { year: 2026, slug: "2026-27-english-premier-league" },
    status: { type: { state: "pre", completed: false, name: "STATUS_SCHEDULED" } },
    competitions: [{ id: "900", venue: { address: { country: "England" } }, competitors: [
      { homeAway: "home", team: { id: "1", displayName: "Alpha", abbreviation: "ALP", logo: "https://example.com/a.png" } },
      { homeAway: "away", team: { id: "2", displayName: "Beta", abbreviation: "BET", logo: "https://example.com/b.png" } },
    ], odds: [] }],
  });
  assert.equal(event.source, "espn-global-json");
  assert.equal(event.league.name, "English Premier League");
  assert.equal(event.homeTeam.logo, "https://example.com/a.png");
});

test("ticket construction does not repeat a fixture", () => {
  const candidates = Array.from({ length: 5 }, (_, index) => ({ fixtureId: `f${index}`, key: "DC_1X", name: "Double chance", category: "Result", selection: "1X", probability: 0.8, confidence: 0.8, quotedOdds: 1.35, fairOdds: 1.25, edge: 0.05, expectedValue: .08, marketProbability: .76, modelMarketGap: .04, oddsSource: "public-json", factors: { homePlayed: 8, awayPlayed: 8 } }));
  const fixtures = candidates.map((item) => ({ id: item.fixtureId, status: "SCHEDULED", kickoff: new Date(Date.now() + 86_400_000).toISOString(), league: { name: "League" }, homeTeam: { name: "Home" }, awayTeam: { name: "Away" } }));
  const ticket = buildTicket(candidates, "SAFE_2", fixtures);
  assert.ok(ticket);
  assert.equal(new Set(ticket.selections.map((item) => item.fixtureId)).size, ticket.selections.length);
});

test("ticket construction does not fill a ticket with under markets", () => {
  const candidates = Array.from({ length: 10 }, (_, index) => ({ fixtureId: `mix${index}`, key: index < 5 ? "UNDER_3_5" : "DC_1X", name: index < 5 ? "Under 3.5" : "Double chance", category: index < 5 ? "Goals" : "Result", selection: index < 5 ? "Under 3.5" : "1X", probability: .78, confidence: index < 5 ? .8 : .79, quotedOdds: 1.35, fairOdds: 1.28, edge: .03, expectedValue: .05, marketProbability: .75, modelMarketGap: .03, oddsSource: "public-json", factors: { homePlayed: 8, awayPlayed: 8 } }));
  const fixtures = candidates.map((item) => ({ id: item.fixtureId, status: "SCHEDULED", kickoff: new Date(Date.now() + 86_400_000).toISOString(), league: { name: "League" }, homeTeam: { name: "Home" }, awayTeam: { name: "Away" } }));
  const ticket = buildTicket(candidates, "SAFE_2", fixtures);
  assert.ok(ticket);
  assert.ok(ticket.selections.some((item) => !item.market.key.startsWith("UNDER_")));
  assert.ok(ticket.selections.filter((item) => item.market.key.startsWith("UNDER_")).length <= 2);
});

test("the ESPN fallback normalizes fixtures and available moneyline prices", () => {
  const event = normalizeEspnEvent({
    id: "401",
    date: "2026-08-22T15:00:00Z",
    status: { type: { state: "pre", completed: false, name: "STATUS_SCHEDULED" } },
    competitions: [{
      id: "401",
      competitors: [
        { homeAway: "home", team: { id: "1", displayName: "Alpha", abbreviation: "ALP", logo: "https://example.com/a.png" } },
        { homeAway: "away", team: { id: "2", displayName: "Beta", abbreviation: "BET", logo: "https://example.com/b.png" } },
      ],
      odds: [{ provider: { name: "Example" }, overUnder: 2.5, moneyline: { home: { close: { odds: "-150" } }, draw: { close: { odds: "+240" } }, away: { close: { odds: "+330" } } }, total: { over: { close: { line: "o2.5", odds: "-120" } }, under: { close: { line: "u2.5", odds: "+100" } } } }],
    }],
  }, { id: "eng.1", name: "Premier League" });
  assert.equal(event.status, "SCHEDULED");
  assert.equal(event.homeTeam.name, "Alpha");
  assert.equal(event.odds.length, 5);
  assert.equal(event.odds[0].odds, 1.67);
  assert.equal(event.odds.find((odd) => odd.selection === "Over 2.5").odds, 1.83);
});
