import assert from "node:assert/strict";
import test from "node:test";
import { attachOdds, scoreEvent } from "../lib/model.mjs";
import { buildTicket } from "../lib/tickets.mjs";
import { normalizeEspnEvent, normalizeEspnGlobalEvent } from "../lib/espn.mjs";

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
  assert.ok(predictions.some((item) => item.name === "Correct score"));
  assert.ok(predictions.find((item) => item.key === "MATCH_HOME").probability > predictions.find((item) => item.key === "MATCH_AWAY").probability);
});

test("quoted odds keep the provider mapping needed for future booking codes", () => {
  const predictions = scoreEvent(fixture, history);
  const priced = attachOdds(predictions, [{ market: "Match winner", selection: "1", odds: 1.6, source: "public-json", marketId: "m1", selectionId: "s1", provider: "Example", deepLink: "https://example.com/bet" }]);
  assert.equal(priced.find((item) => item.key === "MATCH_HOME").quotedOdds, 1.6);
  assert.equal(priced.find((item) => item.key === "MATCH_HOME").oddsProvider, "Example");
  assert.equal(priced.find((item) => item.key === "MATCH_HOME").providerDeepLink, "https://example.com/bet");
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
  const candidates = Array.from({ length: 5 }, (_, index) => ({ fixtureId: `f${index}`, key: `k${index}`, name: "Double chance", category: "Result", selection: "1X", probability: 0.8, confidence: 0.8, quotedOdds: 1.35, edge: 0.05, oddsSource: "public-json", factors: { homePlayed: 8, awayPlayed: 8 } }));
  const fixtures = candidates.map((item) => ({ id: item.fixtureId, status: "SCHEDULED", kickoff: new Date(Date.now() + 86_400_000).toISOString(), league: { name: "League" }, homeTeam: { name: "Home" }, awayTeam: { name: "Away" } }));
  const ticket = buildTicket(candidates, "SAFE", fixtures);
  assert.ok(ticket);
  assert.equal(new Set(ticket.selections.map((item) => item.fixtureId)).size, ticket.selections.length);
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
