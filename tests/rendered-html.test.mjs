import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("renders the public OddsAura landing page", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), env, ctx);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(html, /Smarter picks/);
  assert.match(html, /Create free account/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("redirects anonymous visitors away from protected predictions", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/dashboard"), env, ctx);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost/login?next=%2Fdashboard");
});

test("protects the Daily Odds hub", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/daily"), env, ctx);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost/login?next=%2Fdaily");
});
