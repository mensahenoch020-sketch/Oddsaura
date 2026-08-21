import test from "node:test";
import assert from "node:assert/strict";
import { createSportyBetCode } from "../src/modules/providers/sportybet.js";

test("creates and verifies a SportyBet code from provider identifiers", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/orders/share?")) return Response.json({ bizCode: 10000, data: { shareCode: "PB3CFX", shareURL: "http://www.sportybet.com/ng/?shareCode=PB3CFX" } });
    return Response.json({ bizCode: 10000, data: { ticket: { selections: [{ eventId: "sr:match:72221154" }] } } });
  };
  const result = await createSportyBetCode([{
    fixtureId: "fixture-1", homeTeam: "Arsenal", awayTeam: "Coventry City", kickoff: "2026-08-21T19:00:00Z",
    marketKey: "MATCH_HOME", marketName: "Match result", selection: "Arsenal",
    providerEventId: "sr:match:72221154", providerMarketId: "1", providerOutcomeId: "1",
  }], fakeFetch as typeof fetch);
  assert.equal(result.code, "PB3CFX");
  assert.equal(result.deepLink, "https://www.sportybet.com/ng/?shareCode=PB3CFX");
  assert.match(requests[0]?.url ?? "", /\/api\/ng\/orders\/share\?/);
  assert.deepEqual(requests[0]?.body, { selections: [{ eventId: "sr:match:72221154", marketId: "1", outcomeId: "1", specifier: "" }] });
  assert.match(requests[1]?.url ?? "", /\/api\/ng\/orders\/share\/PB3CFX$/);
});

test("searches the fixture, loads exact markets, and maps an away result", async () => {
  const requests: string[] = [];
  const event = {
    eventId: "sr:match:1", homeTeamName: "FC Juarez", awayTeamName: "America", estimateStartTime: Date.parse("2026-08-22T03:00:00Z"),
    markets: [{ id: "1", desc: "1X2", status: 0, outcomes: [{ id: "1", desc: "Home", odds: "4.10", isActive: 1 }, { id: "2", desc: "Draw", odds: "3.50", isActive: 1 }, { id: "3", desc: "Away", odds: "1.80", isActive: 1 }] }],
  };
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input); requests.push(url);
    if (url.includes("firstSearch")) return Response.json({ bizCode: 10000, data: { preMatch: [event], live: [] } });
    if (url.includes("factsCenter/event?")) return Response.json({ bizCode: 10000, data: event });
    if (url.includes("/orders/share?")) return Response.json({ bizCode: 10000, data: { shareCode: "REAL12" } });
    return Response.json({ bizCode: 10000, data: { ticket: { selections: [{}] } } });
  };
  const result = await createSportyBetCode([{
    fixtureId: "espn-1", homeTeam: "FC Juárez", awayTeam: "América", kickoff: "2026-08-22T03:00:00Z",
    marketKey: "MATCH_AWAY", marketName: "Match result", selection: "América",
  }], fakeFetch as typeof fetch);
  assert.equal(result.resolved[0]?.eventId, "sr:match:1");
  assert.equal(result.resolved[0]?.outcomeId, "3");
  assert.equal(result.resolved[0]?.odds, 1.8);
  assert.match(requests[0] ?? "", /\/api\/ng\/factsCenter\/event\/firstSearch\?/);
  assert.match(requests[1] ?? "", /\/api\/ng\/factsCenter\/event\?/);
});

test("maps double chance and total-goals selections to SportyBet identifiers", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const event = {
    eventId: "sr:match:2", homeTeamName: "Lions", awayTeamName: "Stars", estimateStartTime: Date.parse("2026-08-23T15:00:00Z"),
    markets: [
      { id: "10", desc: "Double Chance", status: 0, outcomes: [{ id: "9", desc: "Home or Draw", odds: "1.24", isActive: 1 }, { id: "10", desc: "Home or Away", odds: "1.30", isActive: 1 }, { id: "11", desc: "Draw or Away", odds: "1.41", isActive: 1 }] },
      { id: "18", specifier: "total=2.5", desc: "Over/Under", status: 0, outcomes: [{ id: "12", desc: "Over 2.5", odds: "1.90", isActive: 1 }, { id: "13", desc: "Under 2.5", odds: "1.94", isActive: 1 }] },
    ],
  };
  const secondEvent = {
    ...event, eventId: "sr:match:3", homeTeamName: "Eagles", awayTeamName: "Tigers",
    estimateStartTime: Date.parse("2026-08-24T15:00:00Z"),
  };
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("firstSearch")) return Response.json({ bizCode: 10000, data: { preMatch: [event, secondEvent] } });
    if (url.includes("factsCenter/event?")) return Response.json({ bizCode: 10000, data: url.includes("sr%3Amatch%3A3") ? secondEvent : event });
    if (url.includes("/orders/share?")) return Response.json({ bizCode: 10000, data: { shareCode: "TWO123" } });
    return Response.json({ bizCode: 10000, data: { ticket: { selections: [{}, {}] } } });
  };
  const shared = { fixtureId: "fixture-2", homeTeam: "Lions", awayTeam: "Stars", kickoff: "2026-08-23T15:00:00Z" };
  const result = await createSportyBetCode([
    { ...shared, marketKey: "DC_1X", marketName: "Double chance", selection: "Lions or draw" },
    { ...shared, fixtureId: "fixture-3", homeTeam: "Eagles", awayTeam: "Tigers", kickoff: "2026-08-24T15:00:00Z", marketKey: "UNDER_2_5", marketName: "Total goals", selection: "Under 2.5", line: 2.5 },
  ], fakeFetch as typeof fetch);
  assert.deepEqual(result.resolved.map((item) => [item.marketId, item.outcomeId, item.specifier]), [["10", "9", null], ["18", "13", "total=2.5"]]);
  const share = requests.find((item) => item.url.includes("/orders/share?"));
  assert.deepEqual(share?.body, { selections: [
    { eventId: "sr:match:2", marketId: "10", outcomeId: "9", specifier: "" },
    { eventId: "sr:match:3", marketId: "18", outcomeId: "13", specifier: "total=2.5" },
  ] });
});
