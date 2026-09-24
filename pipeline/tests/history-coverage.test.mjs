import assert from "node:assert/strict";
import test from "node:test";
import { historyFamily, summarizeHistory } from "../lib/history-coverage.mjs";

const event = (id, name) => ({
  id,
  source: "test",
  status: "FINISHED",
  kickoff: `2026-09-${id.padStart(2, "0")}T18:00:00.000Z`,
  league: { id: name.toLowerCase().replaceAll(" ", "."), name },
  homeTeam: { id: `home-${id}` },
  awayTeam: { id: `away-${id}` },
});

test("priority international history is reported separately", () => {
  const rows = [event("01", "UEFA Nations League"), event("02", "Africa Cup of Nations Qualifying"), event("03", "International Friendly"), event("04", "Club Friendly")];
  assert.equal(historyFamily(rows[0]), "NATIONS_LEAGUE");
  const coverage = summarizeHistory(rows);
  assert.equal(coverage.version, 2);
  for (const family of coverage.priorityFamilies) assert.equal(family.matches, 1);
});
