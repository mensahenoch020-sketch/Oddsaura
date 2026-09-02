import test from "node:test";
import assert from "node:assert/strict";
import { teamSearchTerms, teamSimilarity } from "../src/modules/providers/team-matching.js";

test("matches common bookmaker team aliases", () => {
  assert.equal(teamSimilarity("Wolves", "Wolverhampton Wanderers FC"), 1);
  assert.equal(teamSimilarity("Man Utd", "Manchester United"), 1);
  assert.equal(teamSimilarity("Inter Milan", "Internazionale"), 1);
  assert.equal(teamSimilarity("Bayern München", "Bayern Munich"), 1);
});

test("searches bookmakers with both short and official team names", () => {
  const terms = teamSearchTerms("PSG", "Sporting CP");
  assert.ok(terms.includes("paris saint germain"));
  assert.ok(terms.includes("sporting clube de portugal"));
});
