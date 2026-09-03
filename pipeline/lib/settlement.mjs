const normalizedTeam = (value = "") => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\b(?:utd|united)\b/g, " united ").replace(/\b(fc|cf|sc|afc|club|football|de|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

function teamScore(left, right) {
  const a = new Set(normalizedTeam(left).split(" ").filter(Boolean));
  const b = new Set(normalizedTeam(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const x = [...a].join(" "), y = [...b].join(" ");
  return Math.max([...a].filter((word) => b.has(word)).length / new Set([...a, ...b]).size, x === y ? 1 : x.includes(y) || y.includes(x) ? .92 : 0);
}

function marketLine(selection) {
  if (selection.market?.line != null && Number.isFinite(Number(selection.market.line))) return Number(selection.market.line);
  const match = String(selection.market?.key ?? "").match(/_(\d+)_(\d+)$/);
  return match ? Number(`${match[1]}.${match[2]}`) : NaN;
}

export function settleSelection(selection, fixture) {
  if (fixture && ["CANCELLED", "POSTPONED"].includes(fixture.status)) return "VOID";
  if (!fixture || fixture.status !== "FINISHED" || fixture.homeScore == null || fixture.awayScore == null) return "PENDING";
  const home = Number(fixture.homeScore), away = Number(fixture.awayScore), total = home + away;
  const key = selection.market.key, line = marketLine(selection);
  if (key === "MATCH_HOME") return home > away ? "WON" : "LOST";
  if (key === "MATCH_DRAW") return home === away ? "WON" : "LOST";
  if (key === "MATCH_AWAY") return away > home ? "WON" : "LOST";
  if (key === "DC_1X") return home >= away ? "WON" : "LOST";
  if (key === "DC_X2") return away >= home ? "WON" : "LOST";
  if (key === "DC_12") return home !== away ? "WON" : "LOST";
  if (key === "DNB_HOME") return home === away ? "VOID" : home > away ? "WON" : "LOST";
  if (key === "DNB_AWAY") return home === away ? "VOID" : away > home ? "WON" : "LOST";
  if (key === "BTTS_YES") return home > 0 && away > 0 ? "WON" : "LOST";
  if (key === "BTTS_NO") return home === 0 || away === 0 ? "WON" : "LOST";
  if (key === "HOME_CLEAN") return away === 0 ? "WON" : "LOST";
  if (key === "AWAY_CLEAN") return home === 0 ? "WON" : "LOST";
  if (key === "HOME_WIN_NIL") return home > away && away === 0 ? "WON" : "LOST";
  if (key === "AWAY_WIN_NIL") return away > home && home === 0 ? "WON" : "LOST";
  if (key === "HOME_AND_O15") return home > away && total > 1.5 ? "WON" : "LOST";
  if (key === "AWAY_AND_O15") return away > home && total > 1.5 ? "WON" : "LOST";
  if (key === "ODD_GOALS") return total % 2 === 1 ? "WON" : "LOST";
  if (key === "EVEN_GOALS") return total % 2 === 0 ? "WON" : "LOST";
  const correctScore = key.match(/^CS_(\d+)_(\d+)$/);
  if (correctScore) return home === Number(correctScore[1]) && away === Number(correctScore[2]) ? "WON" : "LOST";
  const compare = (value, direction) => value === line ? "VOID" : direction === "OVER" ? value > line ? "WON" : "LOST" : value < line ? "WON" : "LOST";
  if (key.startsWith("HOME_OVER_")) return compare(home, "OVER");
  if (key.startsWith("HOME_UNDER_")) return compare(home, "UNDER");
  if (key.startsWith("AWAY_OVER_")) return compare(away, "OVER");
  if (key.startsWith("AWAY_UNDER_")) return compare(away, "UNDER");
  if (key.startsWith("OVER_")) return compare(total, "OVER");
  if (key.startsWith("UNDER_")) return compare(total, "UNDER");
  return "UNVERIFIED";
}

export function resultForSelection(selection, events) {
  const exact = events.find((event) => event.id === selection.fixtureId || (selection.providerId && event.providerId === selection.providerId));
  if (exact) return exact;
  const kickoff = Date.parse(selection.kickoff);
  return events.map((event) => {
    const direct = (teamScore(selection.homeTeam?.name, event.homeTeam?.name) + teamScore(selection.awayTeam?.name, event.awayTeam?.name)) / 2;
    const reversed = (teamScore(selection.homeTeam?.name, event.awayTeam?.name) + teamScore(selection.awayTeam?.name, event.homeTeam?.name)) / 2 * .82;
    const names = Math.max(direct, reversed);
    const delta = kickoff ? Math.abs(kickoff - Date.parse(event.kickoff)) : null;
    return { event, names, delta, score: names * .9 + (delta == null ? .5 : Math.max(0, 1 - delta / 86_400_000)) * .1 };
  }).filter((row) => row.names >= .7 && (row.delta == null || row.delta <= 86_400_000)).sort((a, b) => b.score - a.score)[0]?.event;
}

export function trackTicket(ticket, events, settledAt = new Date().toISOString()) {
  const selections = ticket.selections.map((selection) => ({ ...selection, result: settleSelection(selection, resultForSelection(selection, events)) }));
  const lost = selections.filter((selection) => selection.result === "LOST").length;
  const pending = selections.filter((selection) => selection.result === "PENDING").length;
  const unverified = selections.filter((selection) => selection.result === "UNVERIFIED").length;
  const voids = selections.filter((selection) => selection.result === "VOID").length;
  const status = lost ? "LOST" : pending ? "PENDING" : unverified ? "CHECK_BOOKMAKER" : voids === selections.length ? "VOID" : "WON";
  return { ...ticket, status, settledAt: status === "PENDING" ? null : ticket.settledAt ?? settledAt,
    wonLegs: selections.filter((selection) => selection.result === "WON").length, lostLegs: lost,
    voidLegs: voids, selections };
}
