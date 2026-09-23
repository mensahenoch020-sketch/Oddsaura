import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/assistant/image-import.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parsePredictionImageText, matchImageRowsToFixtures } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("reads common prediction-card text layouts", () => {
  const rows = parsePredictionImageText(`
    PREDICTIONS OF THE DAY
    Academico Viseu
    vs Estoril Praia
    Over 1.5
    1.16
    Concord Rangers vs Buckhurst Hill
    Both Teams To Score: No
    1.80
  `);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { homeTeam: "Academico Viseu", awayTeam: "Estoril Praia", marketText: "Over 1.5", odds: 1.16 });
  assert.equal(rows[1].marketText, "Both Teams To Score: No");
});

test("matches OCR rows to fixtures and translates supported markets", () => {
  const fixtures = [{ id: "fixture-1", league: { name: "International Friendly" }, kickoff: "2026-09-24T18:00:00.000Z", status: "SCHEDULED", homeTeam: { name: "Norway" }, awayTeam: { name: "Denmark" }, odds: [] }];
  const result = matchImageRowsToFixtures([{ homeTeam: "Norway", awayTeam: "Denmark", marketText: "Over 1.5", odds: 1.3 }], fixtures);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].selection.marketKey, "OVER_1_5");
  assert.equal(result.matched[0].selection.marketName, "Total goals");
});
