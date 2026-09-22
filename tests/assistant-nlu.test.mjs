import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/assistant/nlu.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { interpretAssistantRequest } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const lagosReference = Date.parse("2026-09-11T23:30:00.000Z"); // 00:30 on 12 September in Lagos.

test("audit regressions: exact dates, possessive today, ranges, results and market restrictions", () => {
  for (const date of ['2026-09-15', '15/09/2026']) {
    const intent = interpretAssistantRequest(`Give me 20 odds for sporty on ${date}`, lagosReference);
    assert.equal(intent.kind, 'build');
    assert.equal(intent.targetOdds, 20);
    assert.equal(intent.dateWindow.start, '2026-09-14T23:00:00.000Z');
  }
  assert.equal(interpretAssistantRequest('Give me today’s 20 odds for sporty', lagosReference).dateWindow.kind, 'TODAY');
  const range = interpretAssistantRequest('Give me odds for the next 3 days', lagosReference);
  assert.equal(range.kind, 'daily');
  assert.equal(range.dateWindow.kind, 'NEXT_DAYS');
  assert.equal(interpretAssistantRequest('Show results for matches played yesterday', lagosReference).kind, 'results');
  const market = interpretAssistantRequest('Give me over 1.5 only, 20 odds for sporty', lagosReference);
  assert.equal(market.targetOdds, 20);
  assert.deepEqual(market.marketKeys, ['OVER_1_5']);
  assert.equal(interpretAssistantRequest('20 odds sporty on 2026-02-30', lagosReference).kind, 'unknown');
});

test("understands target-odds requests without exact phrasing", () => {
  const pidgin = interpretAssistantRequest("Abeg arrange 20 odd for sporty");
  assert.equal(pidgin.kind, "build");
  assert.equal(pidgin.targetOdds, 20);
  assert.equal(pidgin.provider, "sportybet");
  const typo = interpretAssistantRequest("I need thirty five odds on sporti");
  assert.equal(typo.kind, "build");
  assert.equal(typo.targetOdds, 35);
  assert.equal(typo.provider, "sportybet");
});

test("extracts split instructions", () => {
  const intent = interpretAssistantRequest("Break 100 odds into 3 smaller betpawa codes");
  assert.equal(intent.kind, "split");
  assert.equal(intent.targetOdds, 100);
  assert.equal(intent.parts, 3);
  assert.equal(intent.provider, "betpawa");
});

test("explicitly splits an existing bookmaker code instead of misrouting it to conversion", () => {
  const intent = interpretAssistantRequest("BA12345 split this sporty code into 3");
  assert.equal(intent.kind, "split");
  assert.equal(intent.code, "BA12345");
  assert.equal(intent.parts, 3);
  assert.equal(intent.provider, "sportybet");
  assert.equal(intent.targetOdds, null);
});

test("recognizes slip analysis and selection explanation requests", () => {
  assert.equal(interpretAssistantRequest("What do you think about this odds?").kind, "analyze");
  assert.equal(interpretAssistantRequest("Analyse Sporty code BA12345").kind, "analyze");
  assert.equal(interpretAssistantRequest("Why did you choose this specific option for this match?").kind, "explain");
});

test("does not cap large requested target odds", () => {
  const intent = interpretAssistantRequest("Give me 1,000,000 odds for SportyBet");
  assert.equal(intent.kind, "build");
  assert.equal(intent.targetOdds, 1_000_000);
});

test("understands bookmaker conversion routes and codes", () => {
  assert.equal(interpretAssistantRequest('Convert SportyBet UZJEEP to Betway').code, 'UZJEEP');
  assert.equal(interpretAssistantRequest('Convert code uzjeep from sporty to betway').code, 'UZJEEP');
  assert.equal(interpretAssistantRequest('Convert SportyBet to Betway').code, null);
  const intent = interpretAssistantRequest("Move BW7008D2D3 from Betway to Sporty");
  assert.equal(intent.kind, "convert");
  assert.equal(intent.code, "BW7008D2D3");
  assert.equal(intent.sourceProvider, "betway");
  assert.equal(intent.destinationProvider, "sportybet");
});

test("recognizes Best Bet, Daily Odds and result requests", () => {
  assert.equal(interpretAssistantRequest("Which prediction strong pass?").kind, "best");
  assert.equal(interpretAssistantRequest("Show today's ready made tickets").kind, "daily");
  assert.equal(interpretAssistantRequest("Did the last odds win?").kind, "results");
  assert.equal(interpretAssistantRequest("Best protection for today").strategy, "protection");
  assert.equal(interpretAssistantRequest("Best value for today").strategy, "value");
});

test("understands league-only prediction requests from normal user language", () => {
  const intent = interpretAssistantRequest("Give me predictions from the Premier League and La Liga only.");
  assert.equal(intent.kind, "best");
  assert.deepEqual(intent.leagueFilters, ["PREMIER_LEAGUE", "LA_LIGA"]);
});

test("combines multiple requested market families", () => {
  const intent = interpretAssistantRequest("Build 8 odds using only double chance and draw-no-bet for SportyBet");
  assert.equal(intent.kind, "build");
  assert.deepEqual(intent.marketKeys, ["DC_1X", "DC_X2", "DC_12", "DNB_HOME", "DNB_AWAY"]);
});

test("recognizes conversational slip revision requests", () => {
  assert.deepEqual(interpretAssistantRequest("Nah, make it safer").action, "safer");
  assert.deepEqual(interpretAssistantRequest("Remove the riskiest match").action, "remove");
  assert.deepEqual(interpretAssistantRequest("Replace the weakest selection").action, "replace");
  assert.deepEqual(interpretAssistantRequest("Which selection is the riskiest?").action, "riskiest");
  assert.deepEqual(interpretAssistantRequest("Which is the safest pick?").action, "safest");
});

test("extracts Lagos calendar days and filters date numbers out of target odds", () => {
  const today = interpretAssistantRequest("Give me matches for today", lagosReference);
  assert.equal(today.kind, "daily");
  assert.equal(today.dateWindow.label, "today");
  assert.equal(today.dateWindow.start, "2026-09-11T23:00:00.000Z");
  assert.equal(today.dateWindow.end, "2026-09-12T23:00:00.000Z");

  const tomorrow = interpretAssistantRequest("I need 20 odds for Sporty tomorrow", lagosReference);
  assert.equal(tomorrow.kind, "build");
  assert.equal(tomorrow.targetOdds, 20);
  assert.equal(tomorrow.dateWindow.label, "tomorrow");
  assert.equal(tomorrow.dateWindow.start, "2026-09-12T23:00:00.000Z");

  const dated = interpretAssistantRequest("September 15 give me 5 odds on betPawa", lagosReference);
  assert.equal(dated.kind, "build");
  assert.equal(dated.targetOdds, 5);
  assert.equal(dated.dateWindow.start, "2026-09-14T23:00:00.000Z");
});

test("recognizes tomorrow, weekends, future windows and dated results", () => {
  const tomorrow = interpretAssistantRequest("Show tomorrow matches", lagosReference);
  assert.equal(tomorrow.kind, "daily");
  assert.equal(tomorrow.dateWindow.kind, "TOMORROW");

  const weekend = interpretAssistantRequest("best bets this weekend", lagosReference);
  assert.equal(weekend.kind, "best");
  assert.equal(weekend.dateWindow.kind, "WEEKEND");

  const future = interpretAssistantRequest("show upcoming games", lagosReference);
  assert.equal(future.kind, "daily");
  assert.equal(future.dateWindow.kind, "NEXT_DAYS");

  const results = interpretAssistantRequest("show yesterday results", lagosReference);
  assert.equal(results.kind, "results");
  assert.equal(results.dateWindow.label, "yesterday");
});
