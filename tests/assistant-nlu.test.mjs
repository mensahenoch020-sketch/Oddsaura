import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/assistant/nlu.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { interpretAssistantRequest } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

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

test("understands bookmaker conversion routes and codes", () => {
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
});
