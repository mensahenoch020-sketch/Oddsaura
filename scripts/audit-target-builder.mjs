import { readFile, writeFile } from "node:fs/promises";
import { buildModelContext, scoreEvent, attachOdds } from "../pipeline/lib/model.mjs";
import { settleSelection } from "../pipeline/lib/settlement.mjs";
import { buildTargetSlip } from "../app/builder/target-builder.ts";

const history = JSON.parse(await readFile(process.argv[2] || new URL("../data/history/football-data.json", import.meta.url), "utf8"));
const finished = history.events.filter(e => e.status === "FINISHED" && e.homeScore != null && e.awayScore != null).sort((a,b) => a.kickoff.localeCompare(b.kickoff));
const sample = finished.slice(-2000);
const days = [...new Set(sample.map(e => e.kickoff.slice(0,10)))];
const rows = [2,5,10,20,50].map(target => ({target, days: days.length, built: 0, noTicket: 0, won: 0, lost: 0, unverified: 0}));
for (const day of days) {
  const now = Date.parse(`${day}T00:00:00Z`);
  // Two-hour buffer: a match that kicked off earlier may not have finished yet.
  const training = finished.filter(e => Date.parse(e.kickoff) + 120*60_000 < now);
  const context = buildModelContext(training, new Date(now).toISOString());
  const events = sample.filter(e => e.kickoff.startsWith(day));
  const predictions = events.flatMap(event => attachOdds(scoreEvent(event, training, context), event.odds ?? []).map(pick => {
    const historyMatches = (pick.factors?.homePlayed ?? 0) + (pick.factors?.awayPlayed ?? 0);
    return {...pick, id: `${event.id}-${pick.key}`, kickoff: event.kickoff, homeTeam: event.homeTeam, awayTeam: event.awayTeam, league: event.league, market: {key: pick.key, name: pick.name, category: pick.category, line: pick.line}, dataQuality: historyMatches >= 14 ? "HIGH" : historyMatches >= 6 ? "MEDIUM" : "LOW", historyMatches, tier: "BALANCED", reasoning: "Historical audit"};
  }));
  for (const row of rows) {
    const ticket = buildTargetSlip(predictions, row.target, now);
    if (!ticket) {row.noTicket++; continue;}
    row.built++;
    const outcomes = ticket.picks.map(pick => settleSelection(pick, events.find(e => e.id === pick.fixtureId)));
    if (outcomes.includes("LOST")) row.lost++;
    else if (outcomes.every(o => o === "WON" || o === "VOID")) row.won++;
    else row.unverified++;
  }
}
const path = new URL("../data/public/model-performance.json", import.meta.url);
const report = JSON.parse(await readFile(path,"utf8"));
report.builderAudit = {generatedAt: new Date().toISOString(), matches: sample.length, rows, limitation: "Retrospective same-day reconstruction using historical 1X2 prices only, not archived full-market candidate pools. Quote collection times are unknown. This is a limited algorithm audit, not a production win-rate or ROI claim."};
await writeFile(path, JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report.builderAudit));
