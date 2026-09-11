import type { PredictedPick } from "../data";
import { providerSupportsMarket, type ProviderId } from "./providers";

export type BuildMode = "recommended" | "target";

export type TargetBuild = {
  picks: PredictedPick[];
  target: number;
  estimatedOdds: number;
  averageConfidence: number;
  estimatedWinChance: number;
  exact: boolean;
  risk: "LOW" | "MEDIUM" | "HIGH";
  estimatedPriceCount: number;
  mode: BuildMode;
};

const priceFor = (pick: PredictedPick, priceOverrides?: Record<string, number>) => priceOverrides?.[pick.fixtureId] ?? pick.quotedOdds ?? pick.fairOdds ?? 0;

const normalizeTarget = (requestedTarget: number, fallback = 5) => Number.isFinite(requestedTarget) && requestedTarget >= 1.2 ? requestedTarget : fallback;

function marketFamily(key: string) {
  if (/^MATCH_/.test(key)) return "RESULT";
  if (/^DC_/.test(key)) return "DOUBLE_CHANCE";
  if (/^DNB_/.test(key)) return "DRAW_NO_BET";
  if (/^BTTS_/.test(key)) return "BTTS";
  if (/^(HOME|AWAY)_(OVER|UNDER)_/.test(key)) return "TEAM_GOALS";
  if (/^(OVER|UNDER)_/.test(key)) return "TOTAL_GOALS";
  if (/_(CLEAN|WIN_NIL)$/.test(key)) return "CLEAN_SHEET";
  if (/^HCP_/.test(key)) return "HANDICAP";
  return "OTHER";
}

function predictionScore(pick: PredictedPick, provider: ProviderId) {
  const quality = { HIGH: .08, MEDIUM: .04, LOW: 0 } as const;
  const readiness = provider === "sportybet" && pick.providerMarketId && pick.providerSelectionId ? .05 : 0;
  return pick.confidence + quality[pick.dataQuality ?? "LOW"] + readiness + (pick.marketProbability ?? 0) * .18 + (pick.expectedValue ?? 0) * .25 + (pick.quotedOdds ? .03 : 0);
}

function rankedPredictions(predictions: PredictedPick[], now: number, provider: ProviderId, mode: BuildMode, priceOverrides?: Record<string, number>) {
  return predictions.filter((pick) => {
    const price = priceFor(pick, priceOverrides);
    const minimumPrice = mode === "recommended" ? 1.1 : 1.06;
    if (Date.parse(pick.kickoff) <= now + 30 * 60_000 || price < minimumPrice || price > 3 || !providerSupportsMarket(provider, pick.market.key)) return false;
    if (mode === "recommended") {
      const strongHistory = pick.dataQuality === "HIGH" && (pick.historyMatches == null || pick.historyMatches >= 40);
      const marketConfirmed = pick.quotedOdds != null
        && pick.confidence >= .6
        && pick.probability >= .62
        && (pick.marketProbability ?? 0) >= .58
        && (pick.modelMarketGap ?? 1) <= .1
        && (pick.expectedValue ?? -1) >= -.075;
      const modelOnly = pick.quotedOdds == null && pick.confidence >= .68 && pick.probability >= .7;
      return strongHistory && (marketConfirmed || modelOnly);
    }

    // Manual target mode may use a clearly labelled model-estimate price. It
    // still rejects weak/low-history picks and never repeats a fixture.
    const legacyQuotedPick = pick.quotedOdds != null && pick.marketProbability == null && pick.expectedValue == null;
    return pick.dataQuality !== "LOW"
      && (pick.historyMatches == null || pick.historyMatches >= 6)
      && pick.confidence >= .5
      && pick.probability >= .5
      && (legacyQuotedPick || ((pick.modelMarketGap ?? 0) <= .18 && (pick.expectedValue ?? -.1) >= -.18));
  }).sort((a, b) => predictionScore(b, provider) - predictionScore(a, provider));
}

export function rankBestBets(predictions: PredictedPick[], now = Date.now(), provider: ProviderId = "sportybet") {
  const ranked = rankedPredictions(predictions, now, provider, "recommended");
  if (!ranked.length) return [];

  // Keep every published recommendation inside the same evidence gates, then
  // rotate through competitive market families so one market cannot occupy
  // the whole visible Best Bet or Daily Odds list.
  const strongestScore = predictionScore(ranked[0], provider);
  const competitive = ranked.filter((pick) => predictionScore(pick, provider) >= strongestScore - .12);
  const familyOrder = [...new Set(competitive.map((pick) => marketFamily(pick.market.key)))];
  const buckets = new Map(familyOrder.map((family) => [family, competitive.filter((pick) => marketFamily(pick.market.key) === family)]));
  const usedFixtures = new Set<string>();
  const usedPicks = new Set<string>();
  const diversified: PredictedPick[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const family of familyOrder) {
      const bucket = buckets.get(family) ?? [];
      let pick = bucket.shift();
      while (pick && usedFixtures.has(pick.fixtureId)) pick = bucket.shift();
      if (!pick) continue;
      diversified.push(pick);
      usedFixtures.add(pick.fixtureId);
      usedPicks.add(pick.id);
      added = true;
    }
  }
  for (const pick of ranked) {
    if (usedFixtures.has(pick.fixtureId) || usedPicks.has(pick.id)) continue;
    diversified.push(pick);
    usedFixtures.add(pick.fixtureId);
  }
  return diversified;
}

export function correctedSearchTarget(requestedTarget: number, verifiedTotal: number) {
  const requested = normalizeTarget(requestedTarget);
  if (!Number.isFinite(verifiedTotal) || verifiedTotal <= 1) return requested;
  const correction = Math.max(.75, Math.min(1.6, requested / verifiedTotal));
  const corrected = requested * correction;
  return Number.isFinite(corrected) ? corrected : requested;
}

export function buildTargetSlip(predictions: PredictedPick[], requestedTarget: number, now = Date.now(), provider: ProviderId = "sportybet", mode: BuildMode = "target", priceOverrides?: Record<string, number>): TargetBuild | null {
  const target = normalizeTarget(requestedTarget);
  const ranked = rankedPredictions(predictions, now, provider, mode, priceOverrides);
  const candidates = [...new Map(ranked.map((pick) => [pick.fixtureId, pick])).values()].slice(0, 500);
  if (!candidates.length) return null;

  type State = { picks: PredictedPick[]; odds: number; confidence: number; winChance: number };
  let beam: State[] = [{ picks: [], odds: 1, confidence: 0, winChance: 1 }];
  const maxLegs = mode === "target" ? 21 : 8;
  const score = (state: State) => Math.abs(Math.log(Math.max(state.odds, 1.001) / target)) * 3
    + Math.max(0, state.picks.length - (mode === "target" ? 12 : 8)) * .025
    - (state.picks.length ? state.confidence / state.picks.length : 0) * .35;
  for (const pick of candidates) {
    const price = priceFor(pick, priceOverrides);
    const additions = beam.flatMap((state) => state.picks.length >= maxLegs || state.odds * price > target * 1.18 ? [] : [{
      picks: [...state.picks, pick],
      odds: state.odds * price,
      confidence: state.confidence + pick.confidence,
      winChance: state.winChance * pick.probability,
    }]);
    beam = [...beam, ...additions].sort((a, b) => score(a) - score(b)).slice(0, mode === "target" ? 1200 : 420);
  }
  const minLegs = target < 2.5 ? 1 : 2;
  const selected = beam.filter((state) => state.picks.length >= minLegs).sort((a, b) => score(a) - score(b))[0];
  if (!selected) return null;
  const distance = Math.abs(selected.odds - target) / target;
  return {
    picks: selected.picks,
    target,
    estimatedOdds: selected.odds,
    averageConfidence: selected.confidence / selected.picks.length,
    estimatedWinChance: selected.winChance,
    exact: distance <= .05,
    risk: target >= 20 || selected.picks.length >= 9 ? "HIGH" : target >= 5 || selected.picks.length >= 5 ? "MEDIUM" : "LOW",
    estimatedPriceCount: selected.picks.filter((pick) => pick.quotedOdds == null).length,
    mode,
  };
}
