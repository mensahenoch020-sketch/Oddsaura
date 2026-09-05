import { buildModelContext, scoreEvent } from "./model.mjs";
import { settleSelection } from "./settlement.mjs";

const testedKeys = ["BTTS_YES", "OVER_1_5", "OVER_2_5", "UNDER_3_5", "DC_1X", "DC_X2", "DC_12", "DNB_HOME", "DNB_AWAY", "HOME_OVER_0_5", "HOME_OVER_1_5", "AWAY_OVER_0_5", "AWAY_OVER_1_5", "HOME_CLEAN", "AWAY_CLEAN", "HOME_WIN_NIL", "AWAY_WIN_NIL"];
const outcomeFor = (key, match) => settleSelection({ market: { key } }, match);

const clamp = (value) => Math.max(0.0001, Math.min(0.9999, value));

export function backtestHistory(events, { sampleSize = 800, minimumTraining = 250 } = {}) {
  const finished = events.filter((event) => event.status === "FINISHED" && event.homeScore != null && event.awayScore != null).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const candidates = finished.slice(Math.max(minimumTraining, finished.length - sampleSize));
  let correct = 0; let brier = 0; let logLoss = 0; let overCorrect = 0; let evaluated = 0;
  let baselineHomeWins = 0, trainingCursor = 0;
  const counts = new Map(testedKeys.map(key => [key, { wins: 0, settled: 0 }]));
  const markets = new Map(testedKeys.map(key => [key, { key, matches: 0, correct: 0, baselineCorrect: 0, brierSum: 0, voids: 0, selected: 0, wins: 0 }]));
  const leagues = new Map(); const calibration = Array.from({ length: 10 }, (_, index) => ({ from: index / 10, predictions: 0, wins: 0 }));
  for (const match of candidates) {
    while (trainingCursor < finished.length && finished[trainingCursor].kickoff < match.kickoff) {
      const past = finished[trainingCursor++];
      for (const key of testedKeys) {
        const result = outcomeFor(key, past), count = counts.get(key);
        if (result === "WON" || result === "LOST") { count.settled++; count.wins += Number(result === "WON"); }
      }
    }
    const training = finished.filter((event) => event.kickoff < match.kickoff);
    if (training.length < minimumTraining) continue;
    const context = buildModelContext(training, match.kickoff);
    const scored = scoreEvent(match, training, context);
    for (const key of testedKeys) {
      const pick = scored.find(item => item.key === key), row = markets.get(key), prior = counts.get(key);
      if (!pick || !Number.isFinite(pick.probability)) continue;
      const result = outcomeFor(key, match);
      if (result === "VOID") { row.voids++; continue; }
      if (result !== "WON" && result !== "LOST") continue;
      const won = result === "WON";
      row.matches++;
      row.correct += Number((pick.probability >= .5) === won);
      row.baselineCorrect += Number((prior.settled ? prior.wins / prior.settled >= .5 : true) === won);
      row.brierSum += (pick.probability - Number(won)) ** 2;
      if (pick.probability >= .5) { row.selected++; row.wins += Number(won); }
    }
    const resultMarkets = ["MATCH_HOME", "MATCH_DRAW", "MATCH_AWAY"].map((key) => scored.find((item) => item.key === key));
    if (resultMarkets.some((item) => !item)) continue;
    const actualIndex = match.homeScore > match.awayScore ? 0 : match.homeScore === match.awayScore ? 1 : 2;
    const predictedIndex = resultMarkets.reduce((best, item, index) => item.probability > resultMarkets[best].probability ? index : best, 0);
    const predicted = resultMarkets[predictedIndex];
    correct += predictedIndex === actualIndex ? 1 : 0;
    baselineHomeWins += Number(actualIndex === 0);
    brier += resultMarkets.reduce((sum, item, index) => sum + Math.pow(item.probability - (index === actualIndex ? 1 : 0), 2), 0) / 3;
    logLoss += -Math.log(clamp(resultMarkets[actualIndex].probability));
    const over = scored.find((item) => item.key === "OVER_2_5");
    if (over) overCorrect += (over.probability >= 0.5) === (match.homeScore + match.awayScore >= 3) ? 1 : 0;
    const bucket = calibration[Math.min(9, Math.floor(predicted.probability * 10))]; bucket.predictions += 1; bucket.wins += predictedIndex === actualIndex ? 1 : 0;
    const leagueId = match.league?.id ?? match.league?.name ?? "football";
    const league = leagues.get(leagueId) ?? { name: match.league?.name ?? leagueId, matches: 0, correct: 0 };
    league.matches += 1; league.correct += predictedIndex === actualIndex ? 1 : 0; leagues.set(leagueId, league);
    evaluated += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    methodology: "Walk-forward test: every prediction uses only matches completed before kickoff.",
    matches: evaluated,
    oneXTwoAccuracy: evaluated ? correct / evaluated : null,
    over25Accuracy: evaluated ? overCorrect / evaluated : null,
    brierScore: evaluated ? brier / evaluated : null,
    logLoss: evaluated ? logLoss / evaluated : null,
    baseline: { label: "Always predict home win", matches: evaluated, accuracy: evaluated ? baselineHomeWins / evaluated : null },
    markets: [...markets.values()].map(({ brierSum, ...row }) => ({ ...row, status: row.matches ? "TESTED" : "NOT_TESTED", accuracy: row.matches ? row.correct / row.matches : null, baselineAccuracy: row.matches ? row.baselineCorrect / row.matches : null, brier: row.matches ? brierSum / row.matches : null, selectedHitRate: row.selected ? row.wins / row.selected : null })),
    limitations: ["Binary accuracy includes predicting that a selection will lose. It is not ticket win rate.", "Voids are excluded; draw-no-bet results are conditional on a non-draw.", "Historical bookmaker quotes and archived prediction-time candidate pools are needed to backtest the actual target builder and ROI.", "Corners, cards, shots, early-payout and first-half markets are not evaluated by this full-time-score report."],
    calibration: calibration.filter((bucket) => bucket.predictions).map((bucket) => ({ ...bucket, actualRate: bucket.wins / bucket.predictions })),
    leagues: [...leagues.entries()].map(([id, value]) => ({ id, ...value, accuracy: value.correct / value.matches })).sort((a, b) => b.matches - a.matches),
  };
}
