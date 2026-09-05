import test from "node:test";
import assert from "node:assert/strict";
import { decodeLoadedPayload } from "../src/modules/providers/decoder.js";
import { createSportyBetCode } from "../src/modules/providers/sportybet.js";
import { compareSelectionIds, verifyCreatedCode } from "../src/modules/providers/verification.js";

test("Betway European handicap retains home-relative line and away selection", () => {
  const result = decodeLoadedPayload("betway", "BW6F135922", { selections: [{ sportEvent: { homeTeam: "TSG Hoffenheim", awayTeam: "Borussia Dortmund", eventId: 99 }, market: { displayName: "Handicap (0:1)" }, outcome: { displayName: "Borussia Dortmund" } }] });
  assert.equal(result.selections[0].marketKey, "HCP_3WAY_AWAY");
  assert.equal(result.selections[0].line, -1);
  assert.throws(() => decodeLoadedPayload("betway", "TEST99", { selections: [{ sportEvent: { homeTeam: "A", awayTeam: "B" }, market: { displayName: "Asian Handicap (0:1)" }, outcome: { displayName: "B" } }] }));
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
