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

test("public converter and private X reply assistant use the verified conversion path", async () => {
  const [server, publicPage, publicAssistant, admin, helper, reader, manifest] = await Promise.all([read("scripts/railway-server.mjs"), read("app/convert/page.tsx"), read("app/public-assistant.tsx"), read("app/admin/x-reply-assistant.tsx"), read("scripts/x-reply-helper.mjs"), read("scripts/x-post-reader.mjs"), read("app/manifest.ts")]);
  assert.match(server, /oa_public_rate_limits/); assert.match(server, /oa_x_reply_requests/); assert.match(server, /url\.pathname === "\/api\/public\/convert"/); assert.match(server, /\/api\/public\/x-results\//); assert.match(server, /activePublicConversions >= 3/); assert.match(server, /internalConversion/); assert.match(server, /url\.pathname === "\/api\/health"/);
  assert.match(publicPage, /<ConverterForm publicMode/); assert.match(publicAssistant, /href: "\/convert"/); assert.match(admin, /Convert all and draft reply/); assert.match(admin, /Open reply on X/); assert.match(admin, /x_url/); assert.match(helper, /buildBatchXReply/); assert.match(reader, /publish\.x\.com\/oembed/); assert.match(manifest, /share_target/);
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
  const [css, experience, client] = await Promise.all([read("app/assistant/assistant.css"), read("app/assistant/experience.css"), read("app/assistant/assistant-client.tsx")]);
  assert.match(css, /\.assistant-thread[\s\S]*?overflow-y:\s*auto/);
  assert.match(experience, /\.assistant-composer-dock\{position:relative/);
  assert.match(experience, /scroll-padding-bottom:12px/);
  assert.match(css, /\.assistant-expandable\[open\][\s\S]*?content:\s*"Hide"/);
  assert.match(css, /\.assistant-output-details\[open\][\s\S]*?content:\s*"Hide"/);
  assert.match(client, /assistant-output-details/);
  assert.doesNotMatch(client, /scrollIntoView/);
  assert.match(client, /thread\.scrollTo/);
  assert.match(css, /\.assistant-composer textarea \{ font-size: 16px/);
});

test("chat exports real betslip images and avoids false risk ratings without prices", async () => {
  const [client, image] = await Promise.all([read("app/assistant/assistant-client.tsx"), read("app/assistant/betslip-image.ts")]);
  assert.match(client, /risk: "LOW" \| "MEDIUM" \| "HIGH" \| "UNKNOWN"/);
  assert.match(client, /NOT ENOUGH DATA/);
  assert.match(client, /Save betslip/);
  assert.match(client, /slice\(0, 3\)/);
  assert.match(image, /canvas\.toBlob/);
  assert.match(image, /navigator\.share/);
  assert.match(image, /Check the final bookmaker slip/);
});

test("Railway applies security headers and rate limits account entry points", async () => {
  const server = await read("scripts/railway-server.mjs");
  for (const header of ["strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "content-security-policy"]) assert.match(server, new RegExp(header));
  assert.match(server, /consumeRateLimit/);
  assert.match(server, /Too many attempts/);
  assert.match(server, /HttpOnly; SameSite=Lax/);
});

test("public trust pages, consent links and responsible gambling guidance are present", async () => {
  const [privacy, terms, responsible, contact, auth, footer, sitemap] = await Promise.all([
    read("app/privacy/page.tsx"),
    read("app/terms/page.tsx"),
    read("app/responsible-gambling/page.tsx"),
    read("app/contact/page.tsx"),
    read("app/auth-form.tsx"),
    read("app/legal-footer.tsx"),
    read("app/sitemap.ts"),
  ]);
  assert.match(privacy, /We do not sell personal information/);
  assert.match(privacy, /essential cookies/);
  assert.match(terms, /OddsAura is not a bookmaker/);
  assert.match(terms, /Always review the final bookmaker slip/);
  assert.match(responsible, /Every bet can lose/);
  assert.match(contact, /privacy@oddsaura\.site/);
  assert.match(auth, /href="\/terms"/);
  assert.match(auth, /href="\/privacy"/);
  assert.match(footer, /responsible-gambling/);
  for (const route of ["privacy", "terms", "responsible-gambling", "contact"]) assert.match(sitemap, new RegExp(route));
});

test("minimal account and code results stay consistent on mobile", async () => {
  const [assistant, account, accountCss, results, sporty, routes] = await Promise.all([
    read("app/assistant/assistant-client.tsx"),
    read("app/account/page.tsx"),
    read("app/account/account.css"),
    read("app/results/page.tsx"),
    read("backend/src/modules/providers/sportybet.ts"),
    read("backend/src/modules/providers/routes.ts"),
  ]);
  assert.doesNotMatch(assistant, /Full history|Open full result history|Total unavailable|pick\.evidence/);
  assert.doesNotMatch(account, /GeneratedCodes/);
  assert.match(accountCss, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(results, /redirect\("\/dashboard"\)/);
  assert.match(assistant, /quotedOdds: pick\.quotedOdds/);
  assert.match(sporty, /input\.quotedOdds/);
  assert.match(routes, /quotedOdds: z\.number\(\)\.gt\(1\)/);
});

test("builder receives market evidence, verified-price gates and forward proof", async () => {
  const [pipeline, builder, admin] = await Promise.all([read("pipeline/update.mjs"), read("app/builder/target-builder.ts"), read("app/admin/page.tsx")]);
  for (const field of ["expectedValue", "marketProbability", "modelProbability", "modelMarketGap"]) assert.match(pipeline, new RegExp(field));
  assert.doesNotMatch(pipeline, /modelEstimatePicks/);
  assert.match(pipeline, /paperTrials/);
  assert.match(builder, /mode: BuildMode/);
  assert.match(builder, /hasVerifiedPrice/);
  assert.match(builder, /recommendationMode === "value"/);
  assert.match(builder, /\(pick\.edge \?\? -1\) >= \.01/);
  assert.match(builder, /\(pick\.edge \?\? -1\) >= -\.015/);
  assert.match(builder, /isPublishedMarket/);
  assert.match(builder, /maxLegs = mode === "target" \? Math\.min\(50, groupMap\.size\) : 8/);
  assert.doesNotMatch(builder, /Math\.min\(100/);
  assert.match(admin, /Forward prediction proof/);
  assert.match(admin, /refreshSnapshot\("admin"\)/);
  assert.match(admin, /metricEntries/);
  assert.match(pipeline, /homeHistoryMatches/);
  assert.match(pipeline, /trialTier: "OBSERVATION"/);
});

test("Daily Odds uses model-versus-market edge instead of bookmaker-margin EV", async () => {
  const [pipeline, tickets] = await Promise.all([read("pipeline/update.mjs"), read("pipeline/lib/tickets.mjs")]);
  assert.match(pipeline, /\(item\.edge \?\? -1\) >= 0/); assert.match(tickets, /\(item\.edge \?\? -1\) >= 0/); assert.doesNotMatch(tickets, /\(item\.expectedValue \?\? -1\) >= 0/);
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
  assert.match(form, /0 of \{failedConversion\.sourceCount\} matched/);
  assert.match(form, /\{transferSelections\.length\} selections were imported/);
  assert.doesNotMatch(form, /selections are ready to copy/);
  assert.match(form, /payload\.warning \|\|/);
  assert.match(worker, /Code created, but account history could not be saved/);
  assert.match(railway, /Code created, but account history could not be saved/);
  assert.match(worker, /decoded\.partial && !allowPartial/);
  assert.match(worker, /sourceSelections: selections/);
  assert.match(railway, /const allowPartial = body\.allowPartial === true/);
  assert.doesNotMatch(form, /Bookmaker adapters|Connection capability|How it works|Source import/);
  assert.match(controller, /stageDetails\("IMPORT"/);
  assert.match(controller, /creationStage/);
});

test("Railway-compatible worker paths do not require Cloudflare bindings for bookmaker operations", async () => {
  const [worker, assistant, navigation, converterPage] = await Promise.all([
    read("worker/index.ts"),
    read("app/assistant/assistant-client.tsx"),
    read("app/product-navigation.tsx"),
    read("app/converter/page.tsx"),
  ]);
  assert.match(worker, /env\.ASSETS\s*\?[^:]+:\s*await fetch\(assetUrl\)/s);
  assert.doesNotMatch(worker, /if \(!identity \|\| !env\.DB\)/);
  assert.match(worker, /if \(!env\.DB\)[\s\S]*?createBookmakerCode/);
  assert.doesNotMatch(assistant, /href="\/converter"/);
  assert.match(assistant, /<ConverterForm embedded/);
  assert.match(navigation, /\/dashboard\?tool=converter/);
  assert.match(converterPage, /redirect\("\/dashboard\?tool=converter"\)/);
});
