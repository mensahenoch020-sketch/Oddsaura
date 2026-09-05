import { readFile } from "node:fs/promises";
import { buildModelContext, scoreEvent } from "../pipeline/lib/model.mjs";

const source = process.argv[2] || new URL("../data/history/football-data.json", import.meta.url);
const sampleSize = Number(process.argv[3] || 1000);
const all = JSON.parse(await readFile(source, "utf8")).events
  .filter((event) => event.status === "FINISHED" && event.homeScore != null && event.awayScore != null)
  .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
const sample = all.slice(-sampleSize);
const weights = [0, .25, .4, .55, .7, 1];
const rows = weights.map((modelWeight) => ({ modelWeight, matches: 0, brier: 0, logLoss: 0, bets: 0, wins: 0, returns: 0 }));

for (const match of sample) {
  const cutoff = Date.parse(match.kickoff);
  const training = all.filter((event) => Date.parse(event.kickoff) + 120 * 60_000 < cutoff);
  if (training.length < 250) continue;
  const quotes = (match.odds ?? []).filter((odd) => /historical-1x2/.test(String(odd.marketId)) && Number(odd.odds) > 1);
  const quote = {
    MATCH_HOME: quotes.find((odd) => odd.selectionId === "home"),
    MATCH_DRAW: quotes.find((odd) => odd.selectionId === "draw"),
    MATCH_AWAY: quotes.find((odd) => odd.selectionId === "away"),
  };
  if (Object.values(quote).some((item) => !item)) continue;
  const scored = scoreEvent(match, training, buildModelContext(training, match.kickoff));
  const overround = Object.values(quote).reduce((sum, odd) => sum + 1 / odd.odds, 0);
  const actual = match.homeScore > match.awayScore ? "MATCH_HOME" : match.homeScore === match.awayScore ? "MATCH_DRAW" : "MATCH_AWAY";
  for (const row of rows) {
    const options = Object.entries(quote).map(([key, odd]) => {
      const model = scored.find((item) => item.key === key).probability;
      const market = (1 / odd.odds) / overround;
      const probability = market * (1 - row.modelWeight) + model * row.modelWeight;
      return { key, odd: odd.odds, probability, market, edge: probability - market, ev: probability * odd.odds - 1 };
    });
    row.matches++;
    row.brier += options.reduce((sum, option) => sum + (option.probability - Number(option.key === actual)) ** 2, 0) / 3;
    row.logLoss += -Math.log(Math.max(.0001, options.find((option) => option.key === actual).probability));
    const bet = options.filter((option) => option.probability >= .55 && option.odd >= 1.25 && option.odd <= 2.5 && option.edge >= .015 && option.ev >= .015)
      .sort((a, b) => b.ev - a.ev)[0];
    if (bet) { row.bets++; row.wins += Number(bet.key === actual); row.returns += bet.key === actual ? bet.odd : 0; }
  }
}

console.table(rows.map((row) => ({
  modelWeight: row.modelWeight,
  matches: row.matches,
  brier: Number((row.brier / row.matches).toFixed(4)),
  logLoss: Number((row.logLoss / row.matches).toFixed(4)),
  bets: row.bets,
  hitRate: row.bets ? Number((row.wins / row.bets).toFixed(3)) : null,
  roi: row.bets ? Number(((row.returns - row.bets) / row.bets).toFixed(3)) : null,
})));

const safety = [.55, .6, .65, .7, .75].map((threshold) => ({ threshold, picks: 0, wins: 0, returns: 0 }));
for (const match of sample) {
  const quotes = (match.odds ?? []).filter((odd) => /historical-1x2/.test(String(odd.marketId)) && Number(odd.odds) > 1);
  if (quotes.length !== 3) continue;
  const overround = quotes.reduce((sum, odd) => sum + 1 / odd.odds, 0);
  const favorite = quotes.map((odd) => ({ odd: odd.odds, selection: odd.selectionId, probability: (1 / odd.odds) / overround })).sort((a, b) => b.probability - a.probability)[0];
  const actual = match.homeScore > match.awayScore ? "home" : match.homeScore === match.awayScore ? "draw" : "away";
  for (const row of safety) if (favorite.probability >= row.threshold) {
    row.picks++; row.wins += Number(favorite.selection === actual); row.returns += favorite.selection === actual ? favorite.odd : 0;
  }
}
console.table(safety.map((row) => ({ threshold: row.threshold, picks: row.picks, hitRate: row.picks ? Number((row.wins / row.picks).toFixed(3)) : null, roi: row.picks ? Number(((row.returns - row.picks) / row.picks).toFixed(3)) : null })));
