import test from "node:test";
import assert from "node:assert/strict";
import { createSportyBetCode } from "../src/modules/providers/sportybet.js";

test("creates and verifies a SportyBet code from provider identifiers", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/orders/share?")) return Response.json({ bizCode: 10000, data: { shareCode: "PB3CFX" } });
    return Response.json({ bizCode: 10000, data: { outcomes: [{ eventId: "sr:match:72221154" }] } });
  };
  const result = await createSportyBetCode([{
    fixtureId: "fixture-1", homeTeam: "Arsenal", awayTeam: "Coventry City", kickoff: "2026-08-21T19:00:00Z",
    marketKey: "MATCH_HOME", marketName: "Match result", selection: "Arsenal",
    providerEventId: "sr:match:72221154", providerMarketId: "1", providerOutcomeId: "1",
  }], fakeFetch as typeof fetch);
  assert.equal(result.code, "PB3CFX");
  assert.equal(result.deepLink, "https://www.sportybet.com/?shareCode=PB3CFX");
  assert.deepEqual(requests[0]?.body, { selections: [{ eventId: "sr:match:72221154", marketId: "1", outcomeId: "1", specifier: null }] });
  assert.match(requests[1]?.url ?? "", /\/orders\/share\/PB3CFX$/);
});

test("matches a neutral prediction to SportyBet's current market", async () => {
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("wapConfigurableEventsByOrder")) return Response.json({ bizCode: 10000, data: { tournaments: [{ events: [{
      eventId: "sr:match:1", homeTeam: { name: "FC Juarez" }, awayTeam: { name: "America" }, estimateStartTime: Date.parse("2026-08-22T03:00:00Z"),
      markets: [{ id: "1", desc: "1X2", outcomes: [{ id: "1", desc: "Home", odds: "4.10" }, { id: "2", desc: "Draw", odds: "3.50" }, { id: "3", desc: "Away", odds: "1.80" }] }],
    }] }] } });
    if (url.includes("/orders/share?")) return Response.json({ bizCode: 10000, data: { shareCode: "REAL12" } });
    return Response.json({ bizCode: 10000, data: { outcomes: [{}] } });
  };
  const result = await createSportyBetCode([{
    fixtureId: "espn-1", homeTeam: "FC Juárez", awayTeam: "América", kickoff: "2026-08-22T03:00:00Z",
    marketKey: "MATCH_AWAY", marketName: "Match result", selection: "América",
  }], fakeFetch as typeof fetch);
  assert.equal(result.resolved[0]?.eventId, "sr:match:1");
  assert.equal(result.resolved[0]?.outcomeId, "3");
  assert.equal(result.resolved[0]?.odds, 1.8);
});
