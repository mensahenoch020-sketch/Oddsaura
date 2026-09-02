import test from "node:test";
import assert from "node:assert/strict";
import { decodeBookmakerCode, decodeLoadedPayload } from "../src/modules/providers/decoder.js";

test("decodes SportyBet match result and total selections", () => {
  const decoded = decodeLoadedPayload("sportybet", "ABC123", { data: { ticket: { selections: [
    { eventId: "match:1", eventName: "Arsenal vs Chelsea", startTime: "2026-08-30T15:00:00Z", marketName: "1X2", outcomeName: "Home" },
    { eventId: "match:2", eventName: "Liverpool vs Everton", startTime: "2026-08-30T17:00:00Z", marketName: "Total Goals", outcomeName: "Over 2.5", specifier: "total=2.5" },
  ] } } });
  assert.deepEqual(decoded.selections.map((item) => [item.marketKey, item.selection, item.line ?? null]), [["MATCH_HOME", "Arsenal", null], ["OVER_2_5", "Over 2.5", 2.5]]);
});

test("reports the exact source leg that has no safe market translation", () => {
  const decoded = decodeLoadedPayload("sportybet", "MIXED1", { data: { ticket: { selections: [
    { eventId: "one", eventName: "Arsenal vs Chelsea", startTime: "2026-09-05T15:00:00Z", marketName: "1X2", outcomeName: "Home" },
    { eventId: "two", eventName: "Liverpool vs Everton", startTime: "2026-09-05T17:00:00Z", marketName: "First throw-in", outcomeName: "Liverpool" },
  ] } } });
  assert.equal(decoded.partial, true);
  assert.equal(decoded.skipped, 1);
  assert.equal(decoded.skippedSelections[0]?.eventName, "Liverpool vs Everton");
  assert.equal(decoded.skippedSelections[0]?.marketName, "First throw-in");
});

test("decodes betPawa double chance selections", () => {
  const decoded = decodeLoadedPayload("betpawa", "PAWA12", { items: [
    { eventId: 44, eventName: "Lions - Tigers", startDate: "2026-08-31T12:00:00Z", marketName: "Double Chance", outcomeName: "X2" },
  ] });
  assert.equal(decoded.selections[0]?.marketKey, "DC_X2");
  assert.equal(decoded.selections[0]?.selection, "Draw or Tigers");
});

test("decodes betPawa's current nested booking response", () => {
  const decoded = decodeLoadedPayload("betpawa", "91BTVYP", { items: [{
    eventInfo: { id: "37432370", participants: [{ name: "Ipswich Town", position: 1 }, { name: "Liverpool FC", position: 2 }], startTime: "2026-09-04T19:00:00Z" },
    selections: [{ market: { displayName: "1X2 | Full Time" }, selectionInfo: { displayName: "2" } }],
  }] });
  assert.equal(decoded.selections[0]?.marketKey, "MATCH_AWAY");
  assert.equal(decoded.selections[0]?.selection, "Liverpool FC");
});

test("decodes wrapped Bet9ja selections", () => {
  const decoded = decodeLoadedPayload("bet9ja", "5PTEST", { d: JSON.stringify({ O: {
    first: { eventId: 9, eventName: "Milan v Roma", startdate: "2026-09-01T18:00:00Z", market: "GG/NG", sign: "GG" },
  } }) });
  assert.equal(decoded.selections[0]?.marketKey, "BTTS_YES");
});

test("decodes Bet9ja's current uppercase booking-code response", () => {
  const decoded = decodeLoadedPayload("bet9ja", "5PQFBWR", { R: "OK", D: { O: {
    first: { E_ID: 825683591, E_NAME: "Ipswich Town - Liverpool", STARTDATEUTC: "2026-09-04T19:00:00Z", M_NAME: "1X2", SGN: "2" },
  } } });
  assert.equal(decoded.selections[0]?.marketKey, "MATCH_AWAY");
  assert.equal(decoded.selections[0]?.selection, "Liverpool");
});

test("hydrates ID-only SportyBet code selections before translating", async () => {
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/orders/share/")) return Response.json({ bizCode: 10000, data: { ticket: { selections: [
      { eventId: "sr:match:77", marketId: "18", outcomeId: "12", specifier: "total=2.5" },
    ] } } });
    return Response.json({ bizCode: 10000, data: { eventId: "sr:match:77", homeTeamName: "Arsenal", awayTeamName: "Chelsea", estimateStartTime: Date.parse("2026-09-05T15:00:00Z"), markets: [
      { id: "18", desc: "Over/Under", specifier: "total=2.5", outcomes: [{ id: "12", desc: "Over 2.5" }, { id: "13", desc: "Under 2.5" }] },
    ] } });
  };
  const decoded = await decodeBookmakerCode("sportybet", "CODE77", fakeFetch as typeof fetch);
  assert.equal(decoded.selections[0]?.marketKey, "OVER_2_5");
  assert.equal(decoded.selections[0]?.homeTeam, "Arsenal");
  assert.equal(decoded.selections[0]?.providerEventId, "sr:match:77");
});

test("decodes BetKing booked coupon odds", () => {
  const decoded = decodeLoadedPayload("betking", "KING12", { odds: [
    { eventId: 12, eventName: "Bayern Munich - RB Leipzig", startTime: "2026-09-02T18:30:00Z", marketName: "Match Winner", selectionName: "Away" },
  ] });
  assert.equal(decoded.selections[0]?.marketKey, "MATCH_AWAY");
  assert.equal(decoded.selections[0]?.selection, "RB Leipzig");
});

test("loads and decodes BetKing's current Remix booking response", async () => {
  let posted = "";
  const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    posted = String(init?.body || "");
    const context = { state: { actionData: { "routes/($locale).widgets.bookBet": { bookedCoupon: { odds: [
      { matchId: 1005245677, matchName: "Ipswich - Liverpool", eventDate: "2026-09-04T19:00:00Z", marketName: "1X2", selectionName: "2" },
    ] } } } } };
    return new Response(`<script>window.__remixContext = ${JSON.stringify(context)};</script>`, { status: 500 });
  };
  const decoded = await decodeBookmakerCode("betking", "BR147U", fakeFetch as typeof fetch);
  assert.equal(decoded.selections[0]?.marketKey, "MATCH_AWAY");
  assert.match(decodeURIComponent(posted), /load_booking_code/);
});

test("loads and decodes Betway's current BookABet response", async () => {
  const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.bookingCode, "BW6D5EC50F");
    return Response.json({ selections: [{
      sportEvent: { eventId: 71924998, homeTeam: "FC Copenhagen", awayTeam: "Soenderjyske", expectedStartEpoch: 1_800_000_000 },
      market: { marketId: "719249981", displayName: "1X2" },
      outcome: { outcomeId: "7192499811", displayName: "FC Copenhagen" },
      price: { priceDecimal: 1.31 },
    }] });
  };
  const decoded = await decodeBookmakerCode("betway", "BW6D5EC50F", fakeFetch as typeof fetch);
  assert.equal(decoded.selections[0]?.marketKey, "MATCH_HOME");
  assert.equal(decoded.selections[0]?.homeTeam, "FC Copenhagen");
});
