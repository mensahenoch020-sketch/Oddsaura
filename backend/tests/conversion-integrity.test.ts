import test from "node:test";
import assert from "node:assert/strict";
import { decodeLoadedPayload } from "../src/modules/providers/decoder.js";
import { createSportyBetCode } from "../src/modules/providers/sportybet.js";
import { compareSelectionIds, verifyCreatedCode } from "../src/modules/providers/verification.js";
import { BookmakerIntegrationError, convertBookmakerCode } from "../src/modules/providers/controller.js";

test("Betway European handicap retains home-relative line and away selection", () => {
  const result = decodeLoadedPayload("betway", "BW6F135922", { selections: [{ sportEvent: { homeTeam: "TSG Hoffenheim", awayTeam: "Borussia Dortmund", eventId: 99 }, market: { displayName: "Handicap (0:1)" }, outcome: { displayName: "Borussia Dortmund" } }] });
  assert.equal(result.selections[0].marketKey, "HCP_3WAY_AWAY");
  assert.equal(result.selections[0].line, -1);
  const asian = decodeLoadedPayload("betway", "TEST99", { selections: [{ sportEvent: { homeTeam: "A", awayTeam: "B" }, market: { displayName: "Asian Handicap (0:1)" }, outcome: { displayName: "B" } }] });
  assert.equal(asian.selections[0]?.marketKey, "RAW_EXACT");
  assert.equal(asian.selections[0]?.sourceMarketName, "Asian Handicap (0:1)");
});

test("verification does not confuse missing identity, wrong identity and exact identity", async () => {
  assert.equal(compareSelectionIds(["a"], ["b"]), false);
  assert.equal(compareSelectionIds(["a"], [""]), null);
  assert.equal(compareSelectionIds(["a", "b"], ["b", "a"]), true);
  assert.equal(compareSelectionIds(["a", "b"], ["a", "a"]), false);
  assert.equal((await verifyCreatedCode(async () => { throw new Error("timeout"); })).verificationStatus, "UNVERIFIED");
});

test("SportyBet keeps a created code after timeout or same-count wrong selection", async () => {
  const pick = { fixtureId: "f1", homeTeam: "A", awayTeam: "B", kickoff: "2030-01-01T12:00:00Z", marketKey: "MATCH_HOME", marketName: "Match result", selection: "A", providerEventId: "event1", providerMarketId: "1", providerOutcomeId: "1" };
  for (const mode of ["timeout", "wrong", "exact"]) {
    const fetcher = (async (url: string | URL | Request) => {
      if (String(url).includes("share?")) return Response.json({ bizCode: 10000, data: { shareCode: "KEEP99" } });
      if (mode === "timeout") throw new Error("timeout");
      return Response.json({ bizCode: 10000, data: { ticket: { selections: [{ eventId: "event1", marketId: "1", outcomeId: mode === "wrong" ? "3" : "1", specifier: "" }] } } });
    }) as typeof fetch;
    const result = await createSportyBetCode([pick], fetcher);
    assert.equal(result.code, "KEEP99");
    assert.equal(result.verificationStatus, mode === "timeout" ? "UNVERIFIED" : mode === "wrong" ? "MISMATCH" : "VERIFIED");
  }
});

test("conversion failures identify the exact failed stage", async () => {
  const fetcher = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  await assert.rejects(
    () => convertBookmakerCode("sportybet", "betpawa", "TEST12", fetcher, true),
    (error: unknown) => error instanceof BookmakerIntegrationError && (error.details as { stage?: string })?.stage === "IMPORT",
  );
});
test("converts a Betway European handicap through SportyBet's live market catalogue", async () => {
  const kickoffSeconds = 1_900_000_000;
  const sportyEvent = {
    eventId: "sr:match:hcp", homeTeamName: "Ajax Amsterdam", awayTeamName: "Willem II Tilburg", estimateStartTime: kickoffSeconds * 1000,
    markets: [{ id: "99", desc: "European Handicap", specifier: "hcp=-4", status: 0, outcomes: [
      { id: "1", desc: "Home", odds: "5.5", isActive: 1 }, { id: "2", desc: "Draw", odds: "4.2", isActive: 1 }, { id: "3", desc: "Away", odds: "1.6", isActive: 1 },
    ] }],
  };
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("FindBookABet")) return Response.json({ selections: [{
      sportEvent: { eventId: 71924998, homeTeam: "Ajax Amsterdam", awayTeam: "Willem II Tilburg", expectedStartEpoch: kickoffSeconds },
      market: { displayName: "Handicap (0:4)" }, outcome: { displayName: "Willem II Tilburg" },
    }] });
    if (url.includes("firstSearch")) return Response.json({ bizCode: 10000, data: { preMatch: [sportyEvent] } });
    if (url.includes("factsCenter/event?")) return Response.json({ bizCode: 10000, data: sportyEvent });
    if (url.includes("/orders/share?")) return Response.json({ bizCode: 10000, data: { shareCode: "HCP123" } });
    if (url.includes("/orders/share/HCP123")) return Response.json({ bizCode: 10000, data: { ticket: { selections: [{ eventId: sportyEvent.eventId, marketId: "99", outcomeId: "3", specifier: "hcp=-4" }] } } });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  const result = await convertBookmakerCode("betway", "sportybet", "BW726419C0", fetcher, true);
  assert.equal(result.code, "HCP123");
  assert.equal(result.partial, false);
  assert.equal(result.resolved[0]?.marketId, "99");
  assert.equal(result.resolved[0]?.outcomeId, "3");
  assert.equal(result.verificationStatus, "VERIFIED");
});
