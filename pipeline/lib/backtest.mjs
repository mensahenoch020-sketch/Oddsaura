import { attachOdds, buildModelContext, scoreEvent } from "./model.mjs";
import { settleSelection } from "./settlement.mjs";
import { buildEngineParameters } from "./calibration.mjs";
import { rankedProbabilityScore, wilsonInterval } from "./statistics.mjs";

const testedKeys = ["BTTS_YES", "BTTS_NO", "OVER_1_5", "OVER_2_5", "UNDER_3_5", "DC_1X", "DC_X2", "DC_12", "DNB_HOME", "DNB_AWAY", "HOME_OVER_0_5", "HOME_OVER_1_5", "AWAY_OVER_0_5", "AWAY_OVER_1_5", "HOME_CLEAN", "AWAY_CLEAN", "HOME_WIN_NIL", "AWAY_WIN_NIL", "HCP_3WAY_HOME", "HCP_3WAY_DRAW", "HCP_3WAY_AWAY", "ASIAN_HOME_P0_5", "ASIAN_AWAY_P0_5", "ASIAN_HOME_P1", "ASIAN_AWAY_P1", "ASIAN_HOME_P1_5", "ASIAN_AWAY_P1_5", "ASIAN_HOME_M0_5", "ASIAN_AWAY_M0_5", "ASIAN_HOME_M1", "ASIAN_AWAY_M1", "ASIAN_HOME_M1_5", "ASIAN_AWAY_M1_5"];
const outcomeFor = (selection, match) => {
  const source = typeof selection === "string" ? { key: selection } : selection;
  return settleSelection({ market: { key: source.key, line: source.line } }, match);
};

const clamp = (value) => Math.max(0.0001, Math.min(0.9999, value));

export function backtestHistory(events, { sampleSize = 800, minimumTraining = 250 } = {}) {
  const finished = events.filter((event) => event.status === "FINISHED" && event.homeScore != null && event.awayScore != null).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const candidates = finished.slice(Math.max(minimumTraining, finished.length - sampleSize));
  let correct = 0; let brier = 0; let rps = 0; let logLoss = 0; let overCorrect = 0; let evaluated = 0;
  let baselineHomeWins = 0, trainingCursor = 0;
  const counts = new Map(testedKeys.map(key => [key, { wins: 0, settled: 0 }]));
  const markets = new Map(testedKeys.map(key => [key, { key, matches: 0, correct: 0, baselineCorrect: 0, brierSum: 0, voids: 0, selected: 0, wins: 0 }]));
  const leagues = new Map(); const calibration = Array.from({ length: 10 }, (_, index) => ({ from: index / 10, predictions: 0, wins: 0 }));
  const priceModels = [0, .25, 1].map(modelWeight => ({ modelWeight, matches: 0, brier: 0, logLoss: 0 }));
  const favoriteBands = [.55, .6, .65, .7, .75].map(threshold => ({ threshold, picks: 0, wins: 0, returns: 0 }));
  const calibrationRows = [];
  const priceRows = [];
  const resultRows = [];
  for (const match of candidates) {
    while (trainingCursor < finished.length && Date.parse(finished[trainingCursor].kickoff) + 120 * 60_000 < Date.parse(match.kickoff)) {
      const past = finished[trainingCursor++];
      for (const key of testedKeys) {
        const result = outcomeFor(key, past), count = counts.get(key);
        if (result === "WON" || result === "LOST") { count.settled++; count.wins += Number(result === "WON"); }
      }
    }
    // trainingCursor already advances only past results that cleared the
    // two-hour completion buffer. Reuse that chronological prefix instead of
    // rescanning the complete archive for every evaluated fixture.
    const training = finished.slice(0, trainingCursor);
    if (training.length < minimumTraining) continue;
    const context = buildModelContext(training, match.kickoff);
    const scored = scoreEvent(match, training, context);
    for (const key of testedKeys) {
      const pick = scored.find(item => item.key === key), row = markets.get(key), prior = counts.get(key);
      if (!pick || !Number.isFinite(pick.probability)) continue;
      const result = outcomeFor(pick, match);
      if (result === "VOID") { row.voids++; continue; }
      if (result !== "WON" && result !== "LOST") continue;
      const won = result === "WON";
      calibrationRows.push({ key, leagueId: match.league?.id ?? match.league?.name ?? "football", kickoff: match.kickoff, probability: pick.uncalibratedProbability ?? pick.probability, outcome: Number(won) });
      row.matches++;
      row.correct += Number((pick.probability >= .5) === won);
      row.baselineCorrect += Number((prior.settled ? prior.wins / prior.settled >= .5 : true) === won);
      row.brierSum += (pick.probability - Number(won)) ** 2;
      if (pick.probability >= .5) { row.selected++; row.wins += Number(won); }
    }
    const historicallyPriced = attachOdds(scored, match.odds ?? []);
    for (const pick of historicallyPriced) {
      if (pick.quotedOdds == null || pick.marketProbability == null || pick.modelProbability == null || !testedKeys.includes(pick.key)) continue;
      const result = outcomeFor(pick, match);
      if (result !== "WON" && result !== "LOST") continue;
      priceRows.push({ key: pick.key, leagueId: match.league?.id ?? match.league?.name ?? "football", kickoff: match.kickoff, modelProbability: pick.modelProbability, marketProbability: pick.marketProbability, outcome: Number(result === "WON") });
    }
    const resultMarkets = ["MATCH_HOME", "MATCH_DRAW", "MATCH_AWAY"].map((key) => scored.find((item) => item.key === key));
    if (resultMarkets.some((item) => !item)) continue;
    const actualIndex = match.homeScore > match.awayScore ? 0 : match.homeScore === match.awayScore ? 1 : 2;
    const historicPrices = ["home", "draw", "away"].map(id => (match.odds ?? []).find(odd => odd.selectionId === id && Number(odd.odds) > 1));
    if (historicPrices.every(Boolean)) {
      const overround = historicPrices.reduce((total, odd) => total + 1 / odd.odds, 0);
      const marketProbabilities = historicPrices.map(odd => (1 / odd.odds) / overround);
      for (const row of priceModels) {
        const probabilities = resultMarkets.map((item, index) => marketProbabilities[index] * (1 - row.modelWeight) + item.probability * row.modelWeight);
        row.matches++;
        row.brier += probabilities.reduce((total, probability, index) => total + (probability - Number(index === actualIndex)) ** 2, 0) / 3;
        row.logLoss += -Math.log(clamp(probabilities[actualIndex]));
      }
      const favoriteIndex = marketProbabilities.reduce((best, probability, index) => probability > marketProbabilities[best] ? index : best, 0);
      for (const row of favoriteBands) if (marketProbabilities[favoriteIndex] >= row.threshold) {
        row.picks++; row.wins += Number(favoriteIndex === actualIndex); row.returns += favoriteIndex === actualIndex ? historicPrices[favoriteIndex].odds : 0;
      }
    }
    const predictedIndex = resultMarkets.reduce((best, item, index) => item.probability > resultMarkets[best].probability ? index : best, 0);
    const predicted = resultMarkets[predictedIndex];
    correct += predictedIndex === actualIndex ? 1 : 0;
    baselineHomeWins += Number(actualIndex === 0);
    const probabilities = resultMarkets.map((item) => item.probability);
    const matchBrier = probabilities.reduce((sum, probability, index) => sum + Math.pow(probability - (index === actualIndex ? 1 : 0), 2), 0) / 3;
    const matchRps = rankedProbabilityScore(probabilities, actualIndex);
    brier += matchBrier;
    rps += matchRps ?? 0;
    logLoss += -Math.log(clamp(resultMarkets[actualIndex].probability));
    const over = scored.find((item) => item.key === "OVER_2_5");
    if (over) overCorrect += (over.probability >= 0.5) === (match.homeScore + match.awayScore >= 3) ? 1 : 0;
    const bucket = calibration[Math.min(9, Math.floor(predicted.probability * 10))]; bucket.predictions += 1; bucket.wins += predictedIndex === actualIndex ? 1 : 0;
    const leagueId = match.league?.id ?? match.league?.name ?? "football";
    const league = leagues.get(leagueId) ?? { name: match.league?.name ?? leagueId, matches: 0, correct: 0 };
    league.matches += 1; league.correct += predictedIndex === actualIndex ? 1 : 0; leagues.set(leagueId, league);
    evaluated += 1;
    resultRows.push({ kickoff: match.kickoff, correct: Number(predictedIndex === actualIndex), brier: matchBrier, rps: matchRps, logLoss: -Math.log(clamp(resultMarkets[actualIndex].probability)) });
  }
  const holdoutSize = Math.max(1, Math.floor(resultRows.length * .2));
  const holdoutRows = resultRows.slice(-holdoutSize);
  const developmentRows = resultRows.slice(0, -holdoutSize);
  const holdoutStart = holdoutRows[0]?.kickoff ?? null;
  const parameterCalibrationRows = holdoutStart ? calibrationRows.filter((row) => row.kickoff < holdoutStart) : calibrationRows;
  const parameterPriceRows = holdoutStart ? priceRows.filter((row) => row.kickoff < holdoutStart) : priceRows;
  const average = (rows, key) => rows.length ? rows.reduce((sum, row) => sum + (row[key] ?? 0), 0) / rows.length : null;
  const holdoutCorrect = holdoutRows.reduce((sum, row) => sum + row.correct, 0);
  return {
    generatedAt: new Date().toISOString(),
    methodology: "Walk-forward test: every prediction uses only earlier matches with a two-hour completion buffer before kickoff.",
    matches: evaluated,
    oneXTwoAccuracy: evaluated ? correct / evaluated : null,
    over25Accuracy: evaluated ? overCorrect / evaluated : null,
    brierScore: evaluated ? brier / evaluated : null,
    rankedProbabilityScore: evaluated ? rps / evaluated : null,
    logLoss: evaluated ? logLoss / evaluated : null,
    uncertainty: { oneXTwoAccuracy95: wilsonInterval(correct, evaluated) },
    coverage: { eligibleMatches: candidates.length, evaluatedMatches: evaluated, abstainedMatches: Math.max(0, candidates.length - evaluated), pricedMatches: priceModels[0].matches },
    holdout: { methodology: "Final 20% chronological slice; excluded from generated calibration and market-blend parameters.", startsAt: holdoutStart, matches: holdoutRows.length, developmentMatches: developmentRows.length, oneXTwoAccuracy: average(holdoutRows, "correct"), oneXTwoAccuracy95: wilsonInterval(holdoutCorrect, holdoutRows.length), brierScore: average(holdoutRows, "brier"), rankedProbabilityScore: average(holdoutRows, "rps"), logLoss: average(holdoutRows, "logLoss") },
    baseline: { label: "Always predict home win", matches: evaluated, accuracy: evaluated ? baselineHomeWins / evaluated : null },
    pricingAudit: {
      methodology: "Historical 1X2 closing prices are de-margined before comparison. Model weight 0 is bookmaker-only; 1 is OddsAura-only.",
      probabilityModels: priceModels.map(row => ({ modelWeight: row.modelWeight, matches: row.matches, brier: row.matches ? row.brier / row.matches : null, logLoss: row.matches ? row.logLoss / row.matches : null })),
      favoriteBands: favoriteBands.map(row => ({ threshold: row.threshold, picks: row.picks, hitRate: row.picks ? row.wins / row.picks : null, roi: row.picks ? (row.returns - row.picks) / row.picks : null })),
      conclusion: "The bookmaker price is the primary probability baseline. OddsAura acts as a cautious agreement and risk filter; it does not claim a proven pricing edge.",
    },
    markets: [...markets.values()].map(({ brierSum, ...row }) => ({ ...row, status: row.matches ? "TESTED" : "NOT_TESTED", accuracy: row.matches ? row.correct / row.matches : null, baselineAccuracy: row.matches ? row.baselineCorrect / row.matches : null, brier: row.matches ? brierSum / row.matches : null, selectedHitRate: row.selected ? row.wins / row.selected : null })),
    limitations: ["Binary accuracy includes predicting that a selection will lose. It is not ticket win rate.", "Voids are excluded; draw-no-bet and whole-goal Asian handicap results are conditional on a non-void result.", "Asian and European handicap rows test each modelled line separately; historic handicap prices are still required for a reliable ROI test.", "Historical bookmaker quotes and archived prediction-time candidate pools are needed to backtest the actual target builder and ROI.", "Corners, cards, shots, early-payout and first-half markets are not evaluated by this full-time-score report."],
    calibration: calibration.filter((bucket) => bucket.predictions).map((bucket) => ({ ...bucket, actualRate: bucket.wins / bucket.predictions })),
    leagues: [...leagues.entries()].map(([id, value]) => ({ id, ...value, accuracy: value.correct / value.matches })).sort((a, b) => b.matches - a.matches),
    engineParameters: buildEngineParameters(parameterCalibrationRows, parameterPriceRows),
  };
}
