import test from "node:test";
import assert from "node:assert/strict";
import { createBetPawaCode } from "../src/modules/providers/betpawa.js";

const event = {
  id: "37326063", startTime: "2026-08-28T19:00:00Z",
  participants: [{ name: "Crystal Palace", position: 1 }, { name: "Manchester City", position: 2 }],
  markets: [{ marketType: { id: "3743", name: "1X2 - FT", displayName: "1X2 | Full Time" }, row: [{ prices: [
    { id: "1528007495", name: "1", odds: 4.9 }, { id: "1528007496", name: "X", odds: 4.21 }, { id: "1528007497", name: "2", odds: 1.72 },
  ] }] }],
};

test("creates and reload-verifies a public betPawa booking code", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); requests.push({ url, init });
    if (url.includes("/search?")) return Response.json({ events: [event] });
    if (url.includes("/events/")) return Response.json(event);
    if (url.endsWith("/booking-number")) return Response.json({ code: "09W20DY" });
    return Response.json({ items: [{ eventInfo: { id: event.id } }], originalCount: 1 });
  };
  const result = await createBetPawaCode([{
    fixtureId: "fixture-1", homeTeam: "Crystal Palace FC", awayTeam: "Manchester City", kickoff: event.startTime,
    marketKey: "MATCH_HOME", marketName: "Match result", selection: "Crystal Palace FC",
  }], fakeFetch as typeof fetch);
  assert.equal(result.code, "09W20DY");
  assert.equal(result.resolved[0]?.outcomeId, "1528007495");
  const create = requests.find((item) => item.url.endsWith("/booking-number"));
  assert.deepEqual(JSON.parse(String(create?.init?.body)), { selections: { selections: [{ type: "SINGLE", selections: [1528007495] }] } });
  assert.ok(requests.some((item) => item.url.endsWith("/booking-number/09W20DY")));
  assert.equal((create?.init?.headers as Record<string, string>)["x-pawa-brand"], "betpawa-nigeria");
});

test("maps a totals row by its live line", async () => {
  const totalsEvent = { ...event, id: "event-2", participants: [{ name: "Lions", position: 1 }, { name: "Tigers", position: 2 }], markets: [{
    marketType: { id: "5000", name: "Total Score Over/Under - FT" },
    row: [{ specifier: { total: "1.5" }, prices: [{ id: "100", name: "Over", odds: 1.2 }] }, { specifier: { total: "2.5" }, prices: [{ id: "101", name: "Over", odds: 1.8 }, { id: "102", name: "Under", odds: 2.1 }] }],
  }] };
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/search?")) return Response.json({ events: [totalsEvent] });
    if (url.includes("/events/")) return Response.json(totalsEvent);
    if (url.endsWith("/booking-number")) return Response.json({ code: "TOTAL25" });
    return Response.json({ items: [{}], originalCount: 1 });
  };
  const result = await createBetPawaCode([{ fixtureId: "two", homeTeam: "Lions", awayTeam: "Tigers", kickoff: event.startTime,
    marketKey: "OVER_2_5", marketName: "Total goals", selection: "Over 2.5", line: 2.5 }], fakeFetch as typeof fetch);
  assert.equal(result.resolved[0]?.outcomeId, "101");
  assert.equal(result.resolved[0]?.specifier, "total=2.5");
});

test("falls back to betPawa's public event list when search returns no fixture", async () => {
  const publicEvent = { ...event, id: "777001", participants: [{ name: "Arsenal FC", position: 1 }, { name: "Chelsea FC", position: 2 }] };
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/api/sportsbook/v3/search?")) return Response.json({ data: { events: [] } });
    if (url.includes("/events?categoryId=") || url.includes("/events/popular?")) return new Response('<a href="/event/777001?filter=all"><span>Arsenal FC</span><span>Chelsea FC</span></a>');
    if (url.includes("/api/sportsbook/v4/events/777001")) return Response.json({ data: publicEvent });
    if (url.endsWith("/booking-number")) return Response.json({ code: "FALL777" });
    return Response.json({ items: [{}], originalCount: 1 });
  };
  const result = await createBetPawaCode([{ fixtureId: "fallback", homeTeam: "Arsenal", awayTeam: "Chelsea", kickoff: event.startTime, marketKey: "MATCH_HOME", marketName: "Match result", selection: "Arsenal" }], fakeFetch as typeof fetch);
  assert.equal(result.code, "FALL777");
  assert.equal(result.resolved[0]?.eventId, "777001");
});
