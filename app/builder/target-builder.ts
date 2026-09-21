import type { PredictedPick } from "../data";
import { providerSupportsMarket, type ProviderId } from "./providers";

export type RecommendationMode = "protection" | "value";
export type BuildMode = RecommendationMode | "recommended" | "target";

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

const priceFor = (pick: PredictedPick, priceOverrides?: Record<string, number>) => priceOverrides?.[pick.fixtureId] ?? pick.quotedOdds ?? 0;

// Only markets with usable historical price evidence are eligible for public
// recommendations. The wider model catalog remains available for research,
// but it must not be promoted merely to make the screen look varied.
const publishedMarket = /^(MATCH_(HOME|DRAW|AWAY)|DC_(1X|X2|12)|DNB_(HOME|AWAY)|BTTS_(YES|NO)|ASIAN_(HOME|AWAY)_[PM](0_5|1|1_5)|(HOME|AWAY)_OVER_(0_5|1_5)|OVER_1_5|UNDER_3_5)$/;
export const isPublishedMarket = (key: string) => publishedMarket.test(key);

const normalizeTarget = (requestedTarget: number, fallback = 5) => Number.isFinite(requestedTarget) && requestedTarget >= 1.2 ? requestedTarget : fallback;

function protectionBonus(key: string) {
  if (/^ASIAN_(HOME|AWAY)_P/.test(key)) return .07;
  if (/^DNB_/.test(key)) return .055;
  if (/^DC_/.test(key)) return .045;
  if (/^(HOME|AWAY)_OVER_0_5$/.test(key)) return .035;
  if (key === "BTTS_NO") return .02;
  return 0;
}

function predictionScore(pick: PredictedPick, provider: ProviderId, mode: BuildMode) {
  const quality = { HIGH: .08, MEDIUM: .04, LOW: 0 } as const;
  const readiness = provider === "sportybet" && pick.providerMarketId && pick.providerSelectionId ? .05 : 0;
  const base = pick.confidence * .55 + quality[pick.dataQuality ?? "LOW"] + readiness + (pick.marketProbability ?? 0) * .22 + (pick.quotedOdds ? .03 : 0);
  if (mode === "value") return base + Math.max(-.05, pick.edge ?? 0) * 1.6 + Math.max(-.08, pick.expectedValue ?? 0) * .8;
  if (mode === "protection" || mode === "recommended") return base + pick.probability * .28 + protectionBonus(pick.market.key) - Math.max(0, (pick.quotedOdds ?? 1) - 2.1) * .04;
  return base + Math.max(-.04, pick.expectedValue ?? 0) * .25;
}

function rankedPredictions(predictions: PredictedPick[], now: number, provider: ProviderId, mode: BuildMode, priceOverrides?: Record<string, number>) {
  return predictions.filter((pick) => {
    // A different bookmaker's price cannot fulfil this bookmaker's request.
    if (pick.oddsProvider && pick.oddsProvider.toLowerCase() !== provider) return false;
    if (pick.quoteObservedAt) {
      const quoteTime = Date.parse(pick.quoteObservedAt);
      // A request-time expansion starts before the bookmaker replies, so its
      // fresh quote can be a few seconds newer than the request timestamp.
      // Reject genuinely future or stale prices, not normal network latency.
      if (!Number.isFinite(quoteTime) || now - quoteTime > 30 * 60_000 || quoteTime - now > 2 * 60_000) return false;
    }
    const price = priceFor(pick, priceOverrides);
    const recommendationMode = mode === "recommended" ? "protection" : mode;
    const minimumPrice = recommendationMode === "protection" || recommendationMode === "value" ? 1.1 : 1.06;
    const hasVerifiedPrice = priceOverrides?.[pick.fixtureId] != null || pick.quotedOdds != null;
    if (!hasVerifiedPrice || !Number.isFinite(price) || !Number.isFinite(Date.parse(pick.kickoff)) || !isPublishedMarket(pick.market.key) || Date.parse(pick.kickoff) <= now + 30 * 60_000 || price < minimumPrice || price > 3 || !providerSupportsMarket(provider, pick.market.key)) return false;
    if (recommendationMode === "protection" || recommendationMode === "value") {
      const strongHistory = pick.dataQuality === "HIGH" && (pick.historyMatches == null || pick.historyMatches >= 40);
      const marketConfirmed = pick.quotedOdds != null
        && (pick.modelMarketGap ?? 1) <= .1;
      if (!strongHistory || !marketConfirmed) return false;
      if (recommendationMode === "value") return pick.confidence >= .58
        && pick.probability >= .56
        && (pick.marketProbability ?? 0) >= .5
        && (pick.edge ?? -1) >= .01
        && (pick.expectedValue ?? -1) >= .015;
      return pick.confidence >= .62
        && pick.probability >= .65
        && (pick.marketProbability ?? 0) >= .59
        && (pick.edge ?? -1) >= -.015;
    }

    // Target mode answers an explicit accumulator request. It still requires
    // a fresh bookmaker quote, sufficient history and model/market agreement,
    // but it must not require positive model edge on every leg. The stricter
    // positive-edge rule remains above for Best Bet and Daily Odds.
    const legacyQuotedPick = pick.quotedOdds != null && pick.marketProbability == null && pick.expectedValue == null;
    return pick.dataQuality !== "LOW"
      && (pick.historyMatches == null || pick.historyMatches >= 6)
      && pick.confidence >= .5
      && pick.probability >= .5
      && (legacyQuotedPick || (pick.marketProbability != null && (pick.modelMarketGap ?? 1) <= .12));
  }).sort((a, b) => predictionScore(b, provider, mode) - predictionScore(a, provider, mode));
}

export function rankBestBets(predictions: PredictedPick[], now = Date.now(), provider: ProviderId = "sportybet", mode: RecommendationMode = "protection") {
  const ranked = rankedPredictions(predictions, now, provider, mode);
  if (!ranked.length) return [];

  // This is the core Best Market for Each Match decision: compare every
  // eligible, actually quoted market for the same bookmaker and fixture, then
  // retain only the strongest one for the requested strategy.
  const bestByFixture = new Map<string, PredictedPick>();
  for (const pick of ranked) if (!bestByFixture.has(pick.fixtureId)) bestByFixture.set(pick.fixtureId, pick);
  return [...bestByFixture.values()].sort((a, b) => predictionScore(b, provider, mode) - predictionScore(a, provider, mode));
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
  // Keep alternative markets during the search. A fixture is still limited
  // to one final leg below, but collapsing it here prevented the solver from
  // finding a closer target with another qualified market on the same match.
  const candidates = ranked.slice(0, 500);
  if (!candidates.length) return null;
  const fixtureGroups = [...new Map(candidates.map((pick) => [pick.fixtureId, [] as PredictedPick[]])).entries()];
  const groupMap = new Map(fixtureGroups);
  for (const pick of candidates) groupMap.get(pick.fixtureId)!.push(pick);

  type State = { picks: PredictedPick[]; odds: number; confidence: number; winChance: number };
  let beam: State[] = [{ picks: [], odds: 1, confidence: 0, winChance: 1 }];
  // Target odds are not capped by OddsAura. Use as many distinct live fixtures
  // as the destination bookmaker request can carry (the provider API accepts
  // at most 50 selections); evidence-based recommendations remain compact.
  const maxLegs = mode === "target" ? Math.min(50, groupMap.size) : 8;
  const score = (state: State) => Math.abs(Math.log(Math.max(state.odds, 1.001) / target)) * 3
    + Math.max(0, state.picks.length - (mode === "target" ? 12 : 8)) * .025
    - (state.picks.length ? state.confidence / state.picks.length : 0) * .35;
  for (const alternatives of groupMap.values()) {
    const additions = beam.flatMap((state) => state.picks.length >= maxLegs ? [] : alternatives.flatMap((pick) => {
      const price = priceFor(pick, priceOverrides);
      return state.odds * price > target * 1.18 ? [] : [{
        picks: [...state.picks, pick],
        odds: state.odds * price,
        confidence: state.confidence + pick.confidence,
        winChance: state.winChance * pick.probability,
      }];
    }));
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
    estimatedPriceCount: 0,
    mode,
  };
}
