import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("renders the public product landing page", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), env, ctx);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(html, /Find the right pick/);
  assert.match(html, /Ask OddsAura/);
  assert.match(html, /Create account/);
  assert.match(html, /Nations League/i);
  assert.match(html, /Africa Cup of Nations/i);
  assert.match(html, /Open converter/i);
  assert.match(html, /Turn a screenshot into a slip/i);
  for (const bookmaker of ["SportyBet", "Bet9ja", "betPawa", "Betway", "BetKing"]) assert.match(html, new RegExp(bookmaker, "i"));
  assert.doesNotMatch(html, /codex-preview/);
});

test("redirects anonymous visitors away from protected predictions", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/dashboard"), env, ctx);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost/login?next=%2Fdashboard");
});

test("renders protected pages from Railway forwarded identity without Cloudflare bindings", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/dashboard", {
    headers: {
      "x-oddsaura-user-email": "member@example.com",
      "x-oddsaura-user-name": "Railway Member",
      "x-oddsaura-user-role": "USER",
    },
  }), undefined, ctx);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Today’s football/);
  assert.doesNotMatch(html, /Internal Server Error/);
});

test("protects the Daily Odds hub", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/daily"), env, ctx);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost/login?next=%2Fdaily");
});

test("protects the conversational assistant", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/assistant"), env, ctx);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost/login?next=%2Fassistant");
});
