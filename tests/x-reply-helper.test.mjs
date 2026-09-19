import assert from "node:assert/strict";
import test from "node:test";
import { buildXReply, extractXPostId, parseXConversionRequest } from "../scripts/x-reply-helper.mjs";

test("X requests detect common bookmaker wording and a booking code", () => {
  assert.deepEqual(parseXConversionRequest("@OddsAura BW73507C38 convert this code to sporting bet for me"), { requestText: "@OddsAura BW73507C38 convert this code to sporting bet for me", sourceProvider: "betway", destinationProvider: "sportybet", code: "BW73507C38" });
  const explicit = parseXConversionRequest("Please convert AB12CD34 from BetKing into betPawa");
  assert.equal(explicit.sourceProvider, "betking"); assert.equal(explicit.destinationProvider, "betpawa"); assert.equal(explicit.code, "AB12CD34");
});

test("X reply reports matched selections, combined odds and unavailable legs", () => {
  const reply = buildXReply({ sourceProvider: "betway", destinationProvider: "sportybet", sourceCode: "BW73507C38", result: { code: "SPT123", decoded: 3, resolved: [{ odds: 1.5 }, { odds: 2 }], unmatched: [{ reason: "Not offered" }] } });
  assert.match(reply, /2\/3 Selections Matched \| 3\.00 Odds/); assert.match(reply, /Code: SPT123/); assert.match(reply, /1 selection\(s\) unavailable/);
});

test("X post IDs are extracted only from status links", () => { assert.equal(extractXPostId("https://x.com/example/status/1234567890?s=20"), "1234567890"); assert.equal(extractXPostId("https://x.com/example"), null); });
