import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("historical automation keeps the approved eight-season 2,000-match scope", async () => {
  const [history, live] = await Promise.all([
    read(".github/workflows/update-football-history.yml"),
    read(".github/workflows/update-football-data.yml"),
  ]);
  assert.match(history, /HISTORY_SEASONS: "8"/);
  assert.match(history, /BACKTEST_MATCHES: "2000"/);
  assert.match(history, /group: football-publish/);
  assert.match(live, /group: football-publish/);
  assert.match(history, /git pull --rebase origin main/);
  assert.match(live, /git pull --rebase origin main/);
});

test("Railway protects and serves account operations used by the live UI", async () => {
  const server = await read("scripts/railway-server.mjs");
  for (const route of ["/daily", "/api/codes", "/api/ticket-controls", "/api/admin"]) assert.match(server, new RegExp(route.replaceAll("/", "\\/")));
  for (const table of ["oa_generated_codes", "oa_ticket_controls"]) assert.match(server, new RegExp(table));
  assert.match(server, /async function bookmakerApi/);
  assert.match(server, /async function adminApi/);
  assert.match(server, /\/api\/providers/);
  assert.match(server, /const allowPartial = body\.allowPartial === true/);
  assert.match(server, /allowPartial \}/);
});

test("public football payloads are split, bundled and cached for faster mobile loading", async () => {
  const [data, pipeline, build] = await Promise.all([read("app/data.ts"), read("pipeline/update.mjs"), read("scripts/build-verified.sh")]);
  assert.match(data, /SnapshotScope/);
  assert.match(data, /cache: RequestCache = "force-cache"/);
  assert.match(data, /refreshSnapshot/);
  assert.match(data, /\/data\/\$\{scope\}\.json/);
  assert.match(build, /build-public-data\.mjs/);
  for (const scope of ["builder", "matches", "daily", "results", "admin"]) assert.match(pipeline, new RegExp(`${scope}:`));
});

test("converter exposes a visible code and supports an explicit partial retry", async () => {
  const [form, worker, railway] = await Promise.all([read("app/converter/converter-form.tsx"), read("worker/index.ts"), read("scripts/railway-server.mjs")]);
  assert.match(form, /Your \{destinationMeta\.label\} code/);
  assert.match(form, /Create code with available matches/);
  assert.match(form, /allowPartial \}/);
  assert.match(worker, /body\.allowPartial \?\? false/);
  assert.match(railway, /const allowPartial = body\.allowPartial === true/);
});
