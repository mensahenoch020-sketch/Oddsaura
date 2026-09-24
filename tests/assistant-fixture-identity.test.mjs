import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/assistant/fixture-identity.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { canonicalFixtureIdentity } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("deduplicates the same cross-feed fixture despite alternate names and kickoff times", () => {
  const base = {
    id: "",
    league: { id: "eng.1", name: "Premier League", country: "England" },
    status: "FINISHED",
    odds: [],
  };
  const espn = { ...base, id: "espn-740630", kickoff: "2025-09-14T15:30:00.000Z", homeTeam: { id: "manchester-city", name: "Manchester City" }, awayTeam: { id: "manchester-united", name: "Manchester United" } };
  const history = { ...base, id: "fd-E0-2025-09-14-manchester-city-manchester-united", kickoff: "2025-09-14T16:30:00.000Z", homeTeam: { id: "manchester-city", name: "Man City" }, awayTeam: { id: "manchester-united", name: "Man United" } };
  assert.equal(canonicalFixtureIdentity(espn, "PREMIER_LEAGUE"), canonicalFixtureIdentity(history, "PREMIER_LEAGUE"));
  assert.notEqual(canonicalFixtureIdentity(espn, "PREMIER_LEAGUE"), canonicalFixtureIdentity(history, "OTHER"));
});
