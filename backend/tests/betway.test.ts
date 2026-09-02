import test from "node:test";
import assert from "node:assert/strict";
import { createBetwayCode } from "../src/modules/providers/betway.js";

const event = { eventId: 71924998, homeTeam: "FC Copenhagen", awayTeam: "Soenderjyske", expectedStartEpoch: 1_800_000_000, regionId: "denmark", isFinished: false, isLive: false };
const market = { eventId: 71924998, marketId: "719249981", name: "[Win/Draw/Win]", displayName: "1X2", isActive: true, isSuspended: false };
const outcome = { eventId: 71924998, marketId: "719249981", originalMarketId: "719249981", outcomeId: "7192499811", displayName: "FC Copenhagen", isTradingActive: true, shouldDisplay: true };
const price = { outcomeId: "7192499811", priceDecimal: 1.31 };

test("creates and reload-verifies a zero-stake Betway BookABet code", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.includes("FeedsSearch/EventSearch")) return Response.json([{ eventId: 71924998 }]);
    if (url.includes("Feeds/EMOP")) return Response.json([{ event, markets: [market], outcomes: [outcome], prices: [price] }]);
    if (url.includes("/v1/Betting/BookABet")) return Response.json({ bookingCode: "BW6D5EC50F" });
    return Response.json({ selections: [{ sportEvent: event, market, outcome, price }] });
  };
  const result = await createBetwayCode([{ fixtureId: "source-one", homeTeam: "FC Copenhagen", awayTeam: "Sonderjyske", kickoff: new Date(1_800_000_000_000).toISOString(),
    marketKey: "MATCH_HOME", marketName: "Match result", selection: "FC Copenhagen" }], fakeFetch as typeof fetch);
  assert.equal(result.code, "BW6D5EC50F");
  assert.equal(result.resolved[0]?.odds, 1.31);
  const create = calls.find((call) => call.url.includes("/v1/Betting/BookABet"));
  const body = JSON.parse(String(create?.init?.body));
  assert.equal(body.outcomes[0].value, 0);
  assert.equal(body.outcomes[0].outcomeId, "7192499811");
  assert.ok(calls.some((call) => call.url.includes("/v2/Betting/FindBookABet")));
});

test("does not create a partial Betway code by default", async () => {
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("FeedsSearch/EventSearch")) return Response.json([{ eventId: 71924998 }]);
    return Response.json([{ event, markets: [market], outcomes: [outcome], prices: [price] }]);
  };
  await assert.rejects(() => createBetwayCode([{ fixtureId: "source-one", homeTeam: "FC Copenhagen", awayTeam: "Sonderjyske", kickoff: new Date(1_800_000_000_000).toISOString(),
    marketKey: "BTTS_YES", marketName: "Both teams to score", selection: "Yes" }], fakeFetch as typeof fetch), /not supported/i);
});

test("uses the event id from scored Betway search results, not the decimal score", async () => {
  const searchedEvent = { ...event, eventId: 71924999, homeTeam: "Arsenal", awayTeam: "Chelsea" };
  const searchedMarket = { ...market, eventId: 71924999, marketId: "719249991" };
  const searchedOutcome = { ...outcome, eventId: 71924999, marketId: "719249991", originalMarketId: "719249991", outcomeId: "7192499911", displayName: "Arsenal" };
  const searchedPrice = { ...price, outcomeId: "7192499911" };
  const calls: string[] = [];
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url.includes("FeedsSearch/EventSearch")) return Response.json([{ searchEvent: { id: 71924999, name: "Arsenal - Chelsea" }, resultScore: 0.846153846 }]);
    if (url.includes("Feeds/EMOP")) return Response.json([{ event: searchedEvent, markets: [searchedMarket], outcomes: [searchedOutcome], prices: [searchedPrice] }]);
    if (url.includes("/v1/Betting/BookABet")) return Response.json({ bookingCode: "BW6SEARCH1" });
    return Response.json({ selections: [{ sportEvent: searchedEvent, market: searchedMarket, outcome: searchedOutcome, price: searchedPrice }] });
  };
  const result = await createBetwayCode([{ fixtureId: "search-shape", homeTeam: "Arsenal", awayTeam: "Chelsea", kickoff: new Date(1_800_000_000_000).toISOString(), marketKey: "MATCH_HOME", marketName: "Match result", selection: "Arsenal" }], fakeFetch as typeof fetch);
  assert.equal(result.code, "BW6SEARCH1");
  const emop = calls.find((url) => url.includes("Feeds/EMOP")) ?? "";
  assert.match(emop, /eventIds=71924999/);
  assert.doesNotMatch(emop, /0\.846/);
});
