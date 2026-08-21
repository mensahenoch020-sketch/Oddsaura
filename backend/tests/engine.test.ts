import test from "node:test";
import assert from "node:assert/strict";
import { scoreFixture } from "../src/modules/prediction/engine.js";
import { buildTicket } from "../src/modules/prediction/ticket-builder.js";

test("prediction engine favors a strong home side", () => {
  const scored = scoreFixture({
    home: { played: 10, wins: 8, draws: 1, losses: 1, goalsFor: 24, goalsAgainst: 7 },
    away: { played: 10, wins: 2, draws: 2, losses: 6, goalsFor: 9, goalsAgainst: 21 },
    prices: [{ market: "HOME_WIN", selection: "Home win", decimal: 1.55 }],
  });
  const homeWin = scored.find((item) => item.market === "HOME_WIN");
  assert.ok(homeWin);
  assert.ok(homeWin.probability > 0.55);
  assert.ok(homeWin.expectedHomeGoals > homeWin.expectedAwayGoals);
});

test("ticket builder never selects two markets from one fixture", () => {
  const ticket = buildTicket([
    { predictionId: "a", fixtureId: "f1", probability: 0.8, confidence: 0.8, odds: 1.5 },
    { predictionId: "b", fixtureId: "f1", probability: 0.79, confidence: 0.79, odds: 1.5 },
    { predictionId: "c", fixtureId: "f2", probability: 0.76, confidence: 0.76, odds: 1.5 },
  ], "SAFE");
  assert.equal(new Set(ticket.selections.map((item) => item.fixtureId)).size, ticket.selections.length);
  assert.equal(ticket.valid, true);
});
