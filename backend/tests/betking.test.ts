import test from "node:test";
import assert from "node:assert/strict";
import { createBetKingCode } from "../src/modules/providers/betking.js";

const event = {
  id: 1004777986, name: "Borussia Dortmund - Hamburg", homeTeam: "Borussia Dortmund", awayTeam: "Hamburg", date: "2026-08-29T16:30:00Z",
  markets: [{ id: 673653050, typeId: 110, name: "1x2", specialValue: "", selections: [{ id: 2153200560, name: "1", status: "VALID", odd: { value: 1.31 } }] }],
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
