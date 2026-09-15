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
  assert.match(history, /HISTORY_GLOBAL_DAYS: "730"/);
  assert.match(live, /BOOKMAKER_FIXTURE_LIMIT: "200"/);
  assert.match(history, /group: football-publish/);
  assert.match(live, /group: football-publish/);
  assert.match(history, /git pull --rebase origin main/);
  assert.match(live, /git pull --rebase origin main/);
});

test("assistant expands an insufficient saved pool through only the requested bookmaker", async () => {
  const [client, providers, worker, collection, pipeline] = await Promise.all([
    read("app/assistant/assistant-client.tsx"),
    read("app/builder/providers.ts"),
    read("worker/index.ts"),
    read("backend/src/modules/providers/market-collection.ts"),
    read("pipeline/update.mjs"),
  ]);
  assert.match(client, /expandEligiblePool/);
  assert.match(providers, /\/expand/);
  assert.match(worker, /providerExpandMatch/);
  assert.match(collection, /options\.providers/);
  assert.match(pipeline, /expansionCandidates/);
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
  assert.match(server, /process\.env\.ODDSAURA_EDGE_ORIGIN\?\.replace/);
  assert.doesNotMatch(server, /oddsaura\.chipsofrio\.chatgpt\.site/);
  assert.match(server, /if \(edgeOrigin\) return await proxyEdge/);
});

test("public football payloads are split, bundled and cached for faster mobile loading", async () => {
  const [data, pipeline, build] = await Promise.all([read("app/data.ts"), read("pipeline/update.mjs"), read("scripts/build-verified.sh")]);
  assert.match(data, /SnapshotScope/);
  assert.match(data, /cache: RequestCache = "force-cache"/);
  assert.match(data, /refreshSnapshot/);
  assert.match(data, /\/data\/\$\{scope\}\.json/);
  assert.match(build, /build-public-data\.mjs/);
  for (const scope of ["builder", "matches", "daily", "results", "admin"]) assert.match(pipeline, new RegExp(`${scope}:`));
  assert.match(pipeline, /daily: \{ \.\.\.common, tickets: snapshot\.tickets \?\? \[\], watchlist: snapshot\.watchlist \?\? \[\] \}/);
});

test("mobile assistant fixes the composer while only the message thread scrolls", async () => {
  const [css, client] = await Promise.all([read("app/assistant/assistant.css"), read("app/assistant/assistant-client.tsx")]);
  assert.match(css, /\.assistant-thread[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.assistant-composer-dock\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(css, /bottom:\s*calc\(62px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.assistant-expandable\[open\][\s\S]*?content:\s*"Hide"/);
  assert.match(css, /\.assistant-output-details\[open\][\s\S]*?content:\s*"Hide"/);
  assert.match(client, /assistant-output-details/);
  assert.doesNotMatch(client, /scrollIntoView/);
  assert.match(client, /thread\.scrollTo/);
  assert.match(css, /\.assistant-composer textarea \{ font-size: 16px/);
});

test("builder receives market evidence, verified-price gates and forward proof", async () => {
  const [pipeline, builder, admin] = await Promise.all([read("pipeline/update.mjs"), read("app/builder/target-builder.ts"), read("app/admin/page.tsx")]);
  for (const field of ["expectedValue", "marketProbability", "modelProbability", "modelMarketGap"]) assert.match(pipeline, new RegExp(field));
  assert.doesNotMatch(pipeline, /modelEstimatePicks/);
  assert.match(pipeline, /paperTrials/);
  assert.match(builder, /mode: BuildMode/);
  assert.match(builder, /hasVerifiedPrice/);
  assert.match(builder, /isPublishedMarket/);
  assert.match(builder, /maxLegs = mode === "target" \? 21 : 8/);
  assert.doesNotMatch(builder, /Math\.min\(100/);
  assert.match(admin, /Forward prediction proof/);
  assert.match(admin, /refreshSnapshot\("admin"\)/);
  assert.match(admin, /metricEntries/);
  assert.match(pipeline, /homeHistoryMatches/);
  assert.match(pipeline, /trialTier: "OBSERVATION"/);
});

test("live fixtures inherit archived team history through canonical identities", async () => {
  const update = await read("pipeline/update.mjs");
  assert.match(update, /normalizeEventIdentity/);
  const identity = await read("pipeline/lib/identity.mjs");
  assert.match(identity, /canonicalTeamId/);
  assert.match(identity, /homeTeam: scopedTeam/);
  assert.match(identity, /awayTeam: scopedTeam/);
});

test("assistant evaluates time on requests and applies market filters to all selection paths", async () => {
  const client = await read("app/assistant/assistant-client.tsx");
  assert.doesNotMatch(client, /const \[referenceTime\]/);
  assert.equal((client.match(/const referenceTime = Date.now\(\)/g) ?? []).length, 4);
  assert.equal((client.match(/matchesRequestedMarket\(pick.market.key, intent.marketKeys\)/g) ?? []).length, 4);
  assert.match(client, /picks.some\(pick =>[^\n]*Date.now\(\)/);
  assert.doesNotMatch(client, /row.odds \?\? 1/);
});

test("converter exposes verified codes and clearly labelled partial conversion", async () => {
  const [form, worker, railway, controller] = await Promise.all([read("app/converter/converter-form.tsx"), read("worker/index.ts"), read("scripts/railway-server.mjs"), read("backend/src/modules/providers/controller.ts")]);
  assert.doesNotMatch(railway, /selections: parsed\.requested/);
  assert.doesNotMatch(worker, /parsed\.requested/);
  assert.match(railway, /const importedFrom = "bookmaker"/);
  assert.match(form, /Partial \$\{destinationMeta\.label\} code/);
  assert.match(form, /Partial code created/);
  assert.match(form, /allowPartial: true/);
  assert.match(await read("backend/src/modules/providers/routes.ts"), /body\.allowPartial \?\? false/);
  assert.match(form, /\{transferSelections\.length\} readable selections listed/);
  assert.match(form, /payload\.warning \|\|/);
  assert.match(worker, /Code created, but account history could not be saved/);
  assert.match(railway, /Code created, but account history could not be saved/);
  assert.match(worker, /decoded\.partial && !allowPartial/);
  assert.match(worker, /sourceSelections: selections/);
  assert.match(railway, /const allowPartial = body\.allowPartial === true/);
  assert.match(form, /Source import/);
  assert.match(controller, /stageDetails\("IMPORT"/);
  assert.match(controller, /creationStage/);
});
