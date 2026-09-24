import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/assistant/image-import.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parsePredictionImageText, parseTypedPredictionText, matchImageRowsToFixtures } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

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

test("reads paired bookmaker rows and single-team 1UP tip lists", () => {
  const rows = parsePredictionImageText(`
    EUROPE: UEFA NATIONS LEAGUE - LEAGUE A
    Netherlands
    Germany
    Over 2.5
    Norway
    Denmark
    Norway ML
    ✅ 1. Portugal - 1UP
    ✅ 2. France - 1UP
  `);
  assert.deepEqual(rows.slice(0, 2), [
    { homeTeam: "Netherlands", awayTeam: "Germany", marketText: "Over 2.5", odds: null },
    { homeTeam: "Norway", awayTeam: "Denmark", marketText: "Norway ML", odds: null },
  ]);
  assert.equal(rows[2].selectionTeam, "Portugal");
  assert.equal(rows[2].marketText, "1UP");
  assert.equal(rows[3].selectionTeam, "France");
});

test("tolerates OCR output from dark bookmaker screenshots and common 1UP mistakes", () => {
  const rows = parsePredictionImageText(`
    EUROPE: UEFA NATIONS LEAGUE - LEAGUE A
    Netherlands +140
    Germany Over 2.5 +170
    Norway -133
    Denmark Norway ML +333
    ✅ 1. Denmark - 1TUP
    ✅ 2. France - UP
  `);
  assert.deepEqual(rows[0], { homeTeam: "Netherlands", awayTeam: "Germany", marketText: "Over 2.5", odds: null });
  assert.deepEqual(rows[1], { homeTeam: "Norway", awayTeam: "Denmark", marketText: "Norway ML", odds: null });
  assert.equal(rows[2].marketText, "1UP");
  assert.equal(rows[3].marketText, "1UP");
});

test("recovers totals between team lines and standalone moneyline rows", () => {
  const rows = parsePredictionImageText(`
    Serbia +163
    Over 2.5 19:45 +240
    Greece +163
    Portugal Od 556
    KX om. Portugal ML 00
    Austria ML 19s as
  `);
  assert.equal(rows[0].homeTeam, "Serbia");
  assert.equal(rows[0].awayTeam, "Greece");
  assert.equal(rows[0].marketText, "Over 2.5");
  assert.match(rows[1].selectionTeam, /Portugal/);
  assert.match(rows[2].selectionTeam, /Austria/);
});

test("matches OCR rows to fixtures and translates supported markets", () => {
  const fixtures = [{ id: "fixture-1", league: { name: "International Friendly" }, kickoff: "2026-09-24T18:00:00.000Z", status: "SCHEDULED", homeTeam: { name: "Norway" }, awayTeam: { name: "Denmark" }, odds: [] }];
  const result = matchImageRowsToFixtures([{ homeTeam: "Norway", awayTeam: "Denmark", marketText: "Over 1.5", odds: 1.3 }], fixtures);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].selection.marketKey, "OVER_1_5");
  assert.equal(result.matched[0].selection.marketName, "Total goals");
});

test("matches one-team 1UP rows only when the current fixture is unambiguous", () => {
  const fixtures = [{ id: "fixture-1", league: { name: "UEFA Nations League" }, kickoff: "2026-09-24T18:00:00.000Z", status: "SCHEDULED", homeTeam: { name: "Portugal" }, awayTeam: { name: "Wales" }, odds: [] }];
  const row = { homeTeam: "Portugal", awayTeam: "", selectionTeam: "Portugal", marketText: "1UP", odds: null };
  const result = matchImageRowsToFixtures([row], fixtures);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].selection.marketKey, "ONE_UP_HOME");

  const ambiguous = matchImageRowsToFixtures([row], [...fixtures, { ...fixtures[0], id: "fixture-2", kickoff: "2026-09-28T18:00:00.000Z", awayTeam: { name: "Spain" } }]);
  assert.equal(ambiguous.matched.length, 0);
  assert.match(ambiguous.unmatched[0].reason, /More than one current fixture/);
});

test("preserves repeated single-team picks for explicit review", () => {
  const rows = parsePredictionImageText(`
1. Portugal - 1UP
2. Portugal - 1UP
3. France - 1UP
`);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((row) => row.selectionTeam === "Portugal").length, 2);
});

test("turns plainly typed fixtures and markets into neutral selections", () => {
  const rows = parseTypedPredictionText("Chelsea vs Arsenal home 1UP; Liverpool vs Everton away DNB\nInter vs Milan BTTS no");
  assert.deepEqual(rows, [
    { homeTeam: "Chelsea", awayTeam: "Arsenal", selectionTeam: "Chelsea", marketText: "home 1UP", odds: null },
    { homeTeam: "Liverpool", awayTeam: "Everton", selectionTeam: "Everton", marketText: "away DNB", odds: null },
    { homeTeam: "Inter", awayTeam: "Milan", selectionTeam: undefined, marketText: "BTTS no", odds: null },
  ]);
  const fixtures = [
    { id: "c-a", league: { name: "Premier League" }, kickoff: "2026-09-26T14:00:00.000Z", status: "SCHEDULED", homeTeam: { name: "Chelsea" }, awayTeam: { name: "Arsenal" }, odds: [] },
    { id: "l-e", league: { name: "Premier League" }, kickoff: "2026-09-26T16:00:00.000Z", status: "SCHEDULED", homeTeam: { name: "Liverpool" }, awayTeam: { name: "Everton" }, odds: [] },
    { id: "i-m", league: { name: "Serie A" }, kickoff: "2026-09-26T18:00:00.000Z", status: "SCHEDULED", homeTeam: { name: "Inter" }, awayTeam: { name: "Milan" }, odds: [] },
  ];
  const matched = matchImageRowsToFixtures(rows, fixtures);
  assert.deepEqual(matched.matched.map(item => item.selection.marketKey), ["ONE_UP_HOME", "DNB_AWAY", "BTTS_NO"]);
});

test("accepts pasted team-only markets and leaves ambiguous opponents for user review", () => {
  const rows = parseTypedPredictionText("1. Netherlands - 1UP\n2. Malta - 1UP\n3. Portugal - 1UP");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].selectionTeam, "Netherlands");
  const fixtures = [
    { id: "nl-de", league: { name: "UEFA Nations League" }, kickoff: "2026-09-24T18:00:00.000Z", status: "SCHEDULED", homeTeam: { name: "Netherlands" }, awayTeam: { name: "Germany" }, odds: [] },
    { id: "nl-be", league: { name: "UEFA Nations League" }, kickoff: "2026-09-28T18:00:00.000Z", status: "SCHEDULED", homeTeam: { name: "Netherlands" }, awayTeam: { name: "Belgium" }, odds: [] },
  ];
  const matched = matchImageRowsToFixtures([rows[0]], fixtures);
  assert.equal(matched.matched.length, 0);
  assert.match(matched.unmatched[0].reason, /Add the opponent, date or competition/);
});
