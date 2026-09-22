import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/assistant/plain-language.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { plainPickExplanation, unmetTargetMessage } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("explains protected markets without internal modelling language", () => {
  const explanation = plainPickExplanation({ selection: "Arsenal or draw", market: { key: "DC_1X", name: "Double chance" } }, "BetKing");
  assert.match(explanation, /covers two possible match results/i);
  assert.match(explanation, /available at BetKing/i);
  assert.doesNotMatch(explanation, /model|ensemble|calibrat|edge|ranked/i);
});

test("clearly labels a code that did not reach the requested odds", () => {
  const message = unmetTargetMessage("BetKing", 20, 8.01, true);
  assert.match(message, /couldn.t safely reach 20\.00/i);
  assert.match(message, /closest available BetKing code at 8\.01/i);
});
