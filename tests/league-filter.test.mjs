import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/leagues.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { leagueFilterFor, leagueMatches } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("classifies national-team competitions without collapsing them into other leagues", () => {
  assert.equal(leagueFilterFor({ id: "uefa.nations", name: "UEFA Nations League", country: "Europe" }), "NATIONS_LEAGUE");
  assert.equal(leagueFilterFor({ id: "concacaf.nations.league", name: "CONCACAF Nations League", country: "International" }), "NATIONS_LEAGUE");
  assert.equal(leagueFilterFor({ id: "caf.nations_qual", name: "Africa Cup of Nations Qualifying", country: "Africa" }), "AFCON");
  assert.equal(leagueFilterFor({ id: "caf.championship", name: "African Nations Championship", country: "Africa" }), "AFCON");
  assert.equal(leagueMatches({ name: "Premier League", country: "England" }, "NATIONS_LEAGUE"), false);
  assert.equal(leagueFilterFor({ id: "eng.1", name: "Premier League", country: "England" }), "PREMIER_LEAGUE");
  assert.equal(leagueFilterFor({ id: "rus-1", name: "Russian Premier League", country: "Russia" }), "OTHER");
  assert.equal(leagueMatches({ id: "rus-1", name: "Russian Premier League", country: "Russia" }, "PREMIER_LEAGUE"), false);
});
