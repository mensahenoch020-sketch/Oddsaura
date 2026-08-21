import assert from "node:assert/strict";
import test from "node:test";
import { fetchJson, HttpError } from "../lib/http.mjs";

test("blocked public endpoints trip the circuit breaker without retries", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("blocked", { status: 403, statusText: "Forbidden" });
  };
  try {
    await assert.rejects(fetchJson("https://example.com/feed", { retries: 3 }), (error) => error instanceof HttpError && error.status === 403);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
