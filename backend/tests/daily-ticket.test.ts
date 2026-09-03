import test from "node:test";
import assert from "node:assert/strict";
import { activeDailyTicket } from "../../app/daily/active-ticket.js";
import type { Ticket, TicketSelection } from "../../app/data.js";

function selection(id: string, kickoff: string, odds: number): TicketSelection {
  return { id, fixtureId: id, kickoff, odds, confidence: .7, probability: .7, league: { name: "Test" }, homeTeam: { name: "Home" }, awayTeam: { name: "Away" }, market: { key: "MATCH_HOME", name: "Home", category: "RESULT" }, selection: "Home" };
}

test("daily tickets keep valid picks when one match has already started", () => {
  const ticket: Ticket = { id: "daily", title: "Daily", category: "SAFE_2", status: "PUBLISHED", totalOdds: 4, confidence: .7, bookingCodes: [], selections: [selection("old", "2029-01-01T10:00:00Z", 2), selection("future", "2029-01-02T10:00:00Z", 1.8)] };
  const active = activeDailyTicket(ticket, Date.parse("2029-01-01T12:00:00Z"));
  assert.ok(active);
  assert.equal(active.selections.length, 1);
  assert.equal(active.selections[0].id, "future");
  assert.equal(active.totalOdds, 1.8);
  assert.equal(active.trimmed, true);
});
