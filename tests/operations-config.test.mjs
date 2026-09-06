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
  assert.match(server, /const allowPartial = false/);
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

test("builder receives market evidence, wider estimates and forward proof", async () => {
  const [pipeline, builder, admin] = await Promise.all([read("pipeline/update.mjs"), read("app/builder/target-builder.ts"), read("app/admin/page.tsx")]);
  for (const field of ["expectedValue", "marketProbability", "modelProbability", "modelMarketGap"]) assert.match(pipeline, new RegExp(field));
  assert.match(pipeline, /MODEL_ESTIMATE/);
  assert.match(pipeline, /paperTrials/);
  assert.match(builder, /mode: BuildMode/);
  assert.match(builder, /maxLegs = mode === "target" \? 21 : 8/);
  assert.match(admin, /Forward prediction proof/);
});

test("converter exposes verified codes and never offers a partial conversion", async () => {
  const [form, worker, railway] = await Promise.all([read("app/converter/converter-form.tsx"), read("worker/index.ts"), read("scripts/railway-server.mjs")]);
  assert.match(form, /Your \{destinationMeta\.label\} code/);
  assert.doesNotMatch(form, /Create code with available matches/);
  assert.match(form, /allowPartial: false/);
  assert.match(form, /\{transferSelections\.length\} readable selections listed/);
  assert.match(form, /payload\.warning \|\|/);
  assert.match(worker, /Code created, but account history could not be saved/);
  assert.match(railway, /Code created, but account history could not be saved/);
  assert.match(worker, /decoded\.partial\) \{/);
  assert.match(railway, /const allowPartial = false/);
});
