import assert from "node:assert/strict";
import test from "node:test";
import { batchMissingSelections, buildBatchXReply, buildXReply, extractBookingCodes, extractXPostId, parseXConversionRequest } from "../scripts/x-reply-helper.mjs";

test("X requests detect common bookmaker wording and a booking code", () => {
  const parsed = parseXConversionRequest("@OddsAura BW73507C38 convert this code to sporting bet for me");
  assert.equal(parsed.requestText, "@OddsAura BW73507C38 convert this code to sporting bet for me"); assert.equal(parsed.sourceProvider, "betway"); assert.equal(parsed.destinationProvider, "sportybet"); assert.equal(parsed.code, "BW73507C38"); assert.deepEqual(parsed.codes, [{ code: "BW73507C38", label: null }]);
  const explicit = parseXConversionRequest("Please convert AB12CD34 from BetKing into betPawa");
  assert.equal(explicit.sourceProvider, "betking"); assert.equal(explicit.destinationProvider, "betpawa"); assert.equal(explicit.code, "AB12CD34");
});

test("multiple labelled codes are extracted from one X request", () => {
  assert.deepEqual(extractBookingCodes("10 odds - BW73A28FF6\n10 odds - BW73A3186A\n20 odds - BW73A4E735"), [
    { code: "BW73A28FF6", label: "10 odds" },
    { code: "BW73A3186A", label: "10 odds" },
    { code: "BW73A4E735", label: "20 odds" },
  ]);
  assert.deepEqual(extractBookingCodes("Codes are in this image pic.twitter.com/AbC123xY"), []);
});

test("X reply reports matched selections, combined odds and unavailable legs", () => {
  const reply = buildXReply({ sourceProvider: "betway", destinationProvider: "sportybet", sourceCode: "BW73507C38", result: { code: "SPT123", decoded: 3, resolved: [{ odds: 1.5 }, { odds: 2 }], unmatched: [{ reason: "Not offered" }] } });
  assert.match(reply, /2\/3 Selections Matched \| 3\.00 Odds/); assert.match(reply, /Code: SPT123/); assert.match(reply, /1 selection\(s\) unavailable/);
});

test("X post IDs are extracted only from status links", () => { assert.equal(extractXPostId("https://x.com/example/status/1234567890?s=20"), "1234567890"); assert.equal(extractXPostId("https://x.com/example"), null); });

test("batch replies stay within X limits and name short missing selections", () => {
  const items = [
    { sourceCode: "BW73A28FF6", label: "10 odds", result: { code: "SPT111", unmatched: [{ homeTeam: "Ajax", awayTeam: "Willem II", market: "Handicap" }] } },
    { sourceCode: "BW73A3186A", label: "10 odds", result: { code: "SPT222" } },
    { sourceCode: "BW73A4E735", label: "20 odds", result: { code: "SPT333" } },
  ];
  const reply = buildBatchXReply({ sourceProvider: "betway", destinationProvider: "sportybet", items, resultUrl: "https://oddsaura.site/x/abc12345" });
  assert.match(reply, /10 odds: SPT111/); assert.match(reply, /Ajax-Willem II \(Handicap\)/); assert.ok(reply.length <= 280); assert.deepEqual(batchMissingSelections(items), ["Ajax-Willem II (Handicap)"]);
});

test("long missing-game lists use the public details link", () => {
  const items = [{ sourceCode: "BW123456", result: { code: "SPT123", unmatched: Array.from({ length: 12 }, (_, index) => ({ homeTeam: `Very Long Home Team ${index}`, awayTeam: `Very Long Away Team ${index}`, market: "Asian Handicap" })) } }];
  const reply = buildBatchXReply({ sourceProvider: "betway", destinationProvider: "sportybet", items, resultUrl: "https://oddsaura.site/x/abc12345" });
  assert.match(reply, /12 selections/); assert.match(reply, /https:\/\/oddsaura\.site\/x\/abc12345/); assert.ok(reply.length <= 280);
});

test("large failed batches retain the details link and safety line", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ sourceCode: `BWFAILED${index}`, result: {} }));
  const reply = buildBatchXReply({ sourceProvider: "betway", destinationProvider: "sportybet", items, resultUrl: "https://oddsaura.site/x/abc12345" });
  assert.match(reply, /20 codes failed/); assert.match(reply, /https:\/\/oddsaura\.site\/x\/abc12345/); assert.match(reply, /Check every slip/); assert.ok(reply.length <= 280);
});
