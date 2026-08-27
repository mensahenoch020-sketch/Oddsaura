import { buildModelContext, scoreEvent } from "./model.mjs";

const clamp = (value) => Math.max(0.0001, Math.min(0.9999, value));

export function backtestHistory(events, { sampleSize = 800, minimumTraining = 250 } = {}) {
  const finished = events.filter((event) => event.status === "FINISHED" && event.homeScore != null && event.awayScore != null).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const candidates = finished.slice(Math.max(minimumTraining, finished.length - sampleSize));
  let correct = 0; let brier = 0; let logLoss = 0; let overCorrect = 0; let evaluated = 0;
  const leagues = new Map(); const calibration = Array.from({ length: 10 }, (_, index) => ({ from: index / 10, predictions: 0, wins: 0 }));
  for (const match of candidates) {
    const training = finished.filter((event) => event.kickoff < match.kickoff);
    if (training.length < minimumTraining) continue;
    const context = buildModelContext(training, match.kickoff);
    const scored = scoreEvent(match, training, context);
    const resultMarkets = ["MATCH_HOME", "MATCH_DRAW", "MATCH_AWAY"].map((key) => scored.find((item) => item.key === key));
    if (resultMarkets.some((item) => !item)) continue;
    const actualIndex = match.homeScore > match.awayScore ? 0 : match.homeScore === match.awayScore ? 1 : 2;
    const predictedIndex = resultMarkets.reduce((best, item, index) => item.probability > resultMarkets[best].probability ? index : best, 0);
    const predicted = resultMarkets[predictedIndex];
    correct += predictedIndex === actualIndex ? 1 : 0;
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
    calibration: calibration.filter((bucket) => bucket.predictions).map((bucket) => ({ ...bucket, actualRate: bucket.wins / bucket.predictions })),
    leagues: [...leagues.entries()].map(([id, value]) => ({ id, ...value, accuracy: value.correct / value.matches })).sort((a, b) => b.matches - a.matches),
  };
}
