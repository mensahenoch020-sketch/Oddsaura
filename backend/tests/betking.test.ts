import test from "node:test";
import assert from "node:assert/strict";
import { createBetKingCode } from "../src/modules/providers/betking.js";

const event = {
  id: 1004777986, name: "Borussia Dortmund - Hamburg", homeTeam: "Borussia Dortmund", awayTeam: "Hamburg", date: "2026-08-29T16:30:00Z",
  markets: [{ id: 673653050, typeId: 110, name: "1x2", specialValue: "", selections: [{ id: 2153200560, name: "1", status: "VALID", odd: { value: 1.31 } }] },
    { id: 500, typeId: 160, name: "Totals", spreadMarkets: [{ id: 501, typeId: 160, name: "Totals", specialValue: "1.5", selections: [{ id: 502, name: "Over", status: "VALID", odd: { value: 1.22 } }] }] },
    { id: 99001, typeId: 99001, name: "First Throw-In", specialValue: "", selections: [{ id: 990011, name: "Borussia Dortmund", status: "VALID", odd: { value: 1.75 } }] }],
};

test("creates and reload-verifies a public BetKing booking code", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.includes("main-bets/")) return Response.json({ events: [event] });
    if (url.endsWith("action/createcoupon")) return Response.json({ odds: [{ selectionId: 2153200560, matchName: event.name }] });
    if (url.endsWith("action/bookbet")) return Response.json({ responseStatus: 1, bookedCouponCode: "6B2HQ4" });
    const context = { state: { actionData: { "routes/($locale).widgets.bookBet": { error: false, bookingCode: "6B2HQ4", bookedCoupon: { odds: [{ selectionId: 2153200560 }] } } } } };
    return new Response(`<script>window.__remixContext = ${JSON.stringify(context)};</script>`, { status: 500 });
  };
  const result = await createBetKingCode([{ fixtureId: "one", homeTeam: "Borussia Dortmund", awayTeam: "Hamburg", kickoff: "2026-08-29T16:30:00Z",
    marketKey: "MATCH_HOME", marketName: "Match result", selection: "Borussia Dortmund" }], fakeFetch as typeof fetch);
  assert.equal(result.code, "6B2HQ4");
  assert.equal(result.deepLink, "https://m.betking.com/en-ng/sports/book-bet/6B2HQ4");
  const create = calls.find((call) => call.url.endsWith("action/createcoupon"));
  const form = new URLSearchParams(String(create?.init?.body));
  assert.equal(JSON.parse(String(form.get("data"))).selections[0].selectionId, 2153200560);
  assert.ok(calls.some((call) => call.url.endsWith("widgets/bookBet")));
});

test("resolves total lines nested in BetKing spread markets", async () => {
  const totalEvent = event;
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("main-bets/")) return Response.json({ events: [totalEvent] });
    if (url.endsWith("action/createcoupon")) return Response.json({ odds: [{ selectionId: 502, matchName: totalEvent.name }] });
    if (url.endsWith("action/bookbet")) return Response.json({ responseStatus: 1, bookedCouponCode: "TOTAL1" });
    const context = { state: { actionData: { "routes/($locale).widgets.bookBet": { bookedCoupon: { odds: [{ selectionId: 502 }] } } } } };
    return new Response(`<script>window.__remixContext = ${JSON.stringify(context)};</script>`, { status: 500 });
  };
  const result = await createBetKingCode([{ fixtureId: "total", homeTeam: "Borussia Dortmund", awayTeam: "Hamburg", kickoff: "2026-08-29T16:30:00Z", marketKey: "OVER_1_5", marketName: "Total goals", selection: "Over 1.5", line: 1.5 }], fakeFetch as typeof fetch);
  assert.equal(result.code, "TOTAL1");
  assert.equal(result.resolved[0]?.outcomeId, "502");
});

test("matches a non-whitelisted market from BetKing's live event catalogue", async () => {
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("main-bets/")) return Response.json({ events: [event] });
    if (url.endsWith("action/createcoupon")) return Response.json({ odds: [{ selectionId: 990011, matchName: event.name }] });
    if (url.endsWith("action/bookbet")) return Response.json({ responseStatus: 1, bookedCouponCode: "RAWKING" });
    const context = { state: { actionData: { "routes/($locale).widgets.bookBet": { bookedCoupon: { odds: [{ selectionId: 990011 }] } } } } };
    return new Response(`<script>window.__remixContext = ${JSON.stringify(context)};</script>`, { status: 500 });
  };
  const result = await createBetKingCode([{ fixtureId: "raw", homeTeam: "Borussia Dortmund", awayTeam: "Hamburg", kickoff: "2026-08-29T16:30:00Z",
    marketKey: "RAW_EXACT", marketName: "First Throw-In", selection: "Borussia Dortmund", sourceMarketName: "First Throw-In", sourceOutcomeName: "Borussia Dortmund" }], fakeFetch as typeof fetch);
  assert.equal(result.resolved[0]?.marketId, "99001");
  assert.equal(result.resolved[0]?.outcomeId, "990011");
});

test("creates a partial BetKing code when one requested fixture is unavailable", async () => {
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("main-bets/")) return Response.json({ events: [event] });
    if (url.endsWith("action/createcoupon")) return Response.json({ odds: [{ selectionId: 2153200560, matchName: event.name }] });
    if (url.endsWith("action/bookbet")) return Response.json({ responseStatus: 1, bookedCouponCode: "PART42" });
    const context = { state: { actionData: { "routes/($locale).widgets.bookBet": { bookedCoupon: { odds: [{ selectionId: 2153200560 }] } } } } };
    return new Response(`<script>window.__remixContext = ${JSON.stringify(context)};</script>`, { status: 500 });
  };
  const result = await createBetKingCode([
    { fixtureId: "available", homeTeam: "Borussia Dortmund", awayTeam: "Hamburg", kickoff: "2026-08-29T16:30:00Z", marketKey: "MATCH_HOME", marketName: "Match result", selection: "Borussia Dortmund" },
    { fixtureId: "missing", homeTeam: "York City", awayTeam: "Rotherham United", kickoff: "2026-08-29T18:30:00Z", marketKey: "MATCH_HOME", marketName: "Match result", selection: "York City" },
  ], fakeFetch as typeof fetch, true);
  assert.equal(result.code, "PART42");
  assert.equal(result.partial, true);
  assert.equal(result.resolved.length, 1);
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0]?.fixtureId, "missing");
});
