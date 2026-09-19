import assert from "node:assert/strict";
import test from "node:test";
import { extractXEmbedText, readFxPost, readXPost } from "../scripts/x-post-reader.mjs";

test("official X embed HTML is reduced to only the request text", () => {
  const html = '<blockquote class="twitter-tweet"><p lang="en">@OddsAura convert BW73A28FF6 to SportyBet<br>20 odds - BW73A4E735</p>&mdash; Example</blockquote>';
  assert.equal(extractXEmbedText(html), "@OddsAura convert BW73A28FF6 to SportyBet\n20 odds - BW73A4E735");
});

test("X link reader returns detected batch details without a paid API", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ author_name: "Example", author_url: "https://x.com/example", html: '<blockquote><p>Convert these Betway codes to SportyBet<br>10 odds - BW73A28FF6<br>20 odds - BW73A4E735</p></blockquote>' }), { status: 200, headers: { "content-type": "application/json" } });
  const post = await readXPost("https://x.com/example/status/1234567890", fakeFetch);
  assert.equal(post.detected.sourceProvider, "betway"); assert.equal(post.detected.destinationProvider, "sportybet"); assert.equal(post.detected.codes.length, 2); assert.equal(post.authorName, "Example");
});

test("free media fallback accepts only trusted X image URLs", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ status: { text: "convert to SportyBet", media: { photos: [{ url: "https://pbs.twimg.com/media/example.jpg", altText: "first image" }, { url: "https://attacker.example/code.jpg", altText: "ignored" }] }, author: { name: "Example", url: "https://x.com/example" } } }), { status: 200, headers: { "content-type": "application/json" } });
  const post = await readFxPost("1234567890", fakeFetch);
  assert.equal(post.photos.length, 1); assert.equal(post.photos[0].url, "https://pbs.twimg.com/media/example.jpg");
});

test("image-only booking codes are OCRed and merged with the post request", async () => {
  const fakeFetch = async (input) => { const url = String(input); if (url.includes("publish.x.com")) return new Response(JSON.stringify({ author_name: "Example", html: '<blockquote><p>@OddsAura convert these Betway codes to SportyBet pic.twitter.com/abc123</p></blockquote>' }), { status: 200, headers: { "content-type": "application/json" } }); throw new Error(`Unexpected fetch: ${url}`); };
  const fxReader = async () => ({ text: "@OddsAura convert these Betway codes to SportyBet", authorName: "Example", authorUrl: "https://x.com/example", photos: [{ url: "https://pbs.twimg.com/media/example.jpg", altText: "" }] });
  const ocrReader = async () => "10 odds - BW73A28FF6\n10 odds - BW73A3186A\n20 odds - BW73A4E735";
  const post = await readXPost("https://x.com/example/status/1234567890", fakeFetch, { fxReader, ocrReader });
  assert.equal(post.ocrUsed, true); assert.equal(post.mediaDetected, true);
  assert.deepEqual(post.detected.codes.map((item) => item.code), ["BW73A28FF6", "BW73A3186A", "BW73A4E735"]);
  assert.deepEqual(post.detected.codes.map((item) => item.label), ["10 odds", "10 odds", "20 odds"]);
  assert.equal(post.detected.sourceProvider, "betway"); assert.equal(post.detected.destinationProvider, "sportybet");
});
