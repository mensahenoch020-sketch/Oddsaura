import type { Ticket } from "../data";

export type ActiveDailyTicket = Ticket & { trimmed: boolean };

export function activeDailyTicket(ticket: Ticket, now = Date.now()): ActiveDailyTicket | null {
  const selections = ticket.selections.filter((selection) => Date.parse(selection.kickoff) > now + 5 * 60_000);
  if (!selections.length) return null;
  const totalOdds = selections.reduce((total, selection) => total * selection.odds, 1);
  const confidence = selections.reduce((total, selection) => total + selection.confidence, 0) / selections.length;
  return { ...ticket, selections, totalOdds: Number(totalOdds.toFixed(2)), confidence, trimmed: selections.length !== ticket.selections.length };
}
