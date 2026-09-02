import test from "node:test";
import assert from "node:assert/strict";
import { resultForSelection, trackTicket } from "../lib/settlement.mjs";

const selection = { id: "pick", fixtureId: "espn-42", kickoff: "2026-09-01T18:00:00Z", homeTeam: { name: "Leeds United" }, awayTeam: { name: "Chelsea" }, market: { key: "MATCH_HOME", name: "Match result" }, selection: "Leeds United", odds: 2 };
const finished = { id: "espn-42", kickoff: selection.kickoff, status: "FINISHED", homeTeam: { name: "Leeds Utd" }, awayTeam: { name: "Chelsea FC" }, homeScore: 2, awayScore: 1 };

test("matches a finished result by its actual fixture id", () => {
  assert.equal(resultForSelection(selection, [finished]), finished);
  const ticket = trackTicket({ id: "ticket", status: "PENDING", totalOdds: 2, selections: [selection] }, [finished], "2026-09-01T20:00:00Z");
  assert.equal(ticket.status, "WON");
  assert.equal(ticket.selections[0].result, "WON");
});

test("settles a losing ticket as soon as one finished leg loses", () => {
  const ticket = trackTicket({ id: "ticket", status: "PENDING", totalOdds: 2, selections: [{ ...selection, market: { key: "MATCH_AWAY", name: "Match result" }, selection: "Chelsea" }] }, [finished]);
  assert.equal(ticket.status, "LOST");
  assert.equal(ticket.lostLegs, 1);
});
