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

const priceFor = (pick: PredictedPick) => pick.quotedOdds ?? pick.fairOdds ?? 0;

export function buildTargetSlip(predictions: PredictedPick[], requestedTarget: number, now = Date.now(), provider: ProviderId = "sportybet", mode: BuildMode = "target"): TargetBuild | null {
  const target = Math.max(1.2, Math.min(100, Number.isFinite(requestedTarget) ? requestedTarget : 5));
  const quality = { HIGH: .08, MEDIUM: .04, LOW: 0 } as const;
  const ranked = predictions.filter((pick) => {
    const price = priceFor(pick);
    if (Date.parse(pick.kickoff) <= now + 30 * 60_000 || price < 1.06 || price > 3 || !providerSupportsMarket(provider, pick.market.key)) return false;
    if (mode === "recommended") return pick.quotedOdds != null
      && pick.dataQuality === "HIGH"
      && (pick.historyMatches == null || pick.historyMatches >= 12)
      && pick.confidence >= .6
      && pick.probability >= .62
      && (pick.marketProbability ?? 0) >= .58
      && (pick.modelMarketGap ?? 1) <= .1
      && (pick.expectedValue ?? -1) >= -.075;

    // Manual target mode may use a clearly labelled model-estimate price. It
    // still rejects weak/low-history picks and never repeats a fixture.
    const legacyQuotedPick = pick.quotedOdds != null && pick.marketProbability == null && pick.expectedValue == null;
    return pick.dataQuality !== "LOW"
      && (pick.historyMatches == null || pick.historyMatches >= 6)
      && pick.confidence >= .5
      && pick.probability >= .5
      && (legacyQuotedPick || ((pick.modelMarketGap ?? 0) <= .18 && (pick.expectedValue ?? -.1) >= -.18));
  }).sort((a, b) => {
    const readinessA = provider === "sportybet" && a.providerMarketId && a.providerSelectionId ? .05 : 0;
    const readinessB = provider === "sportybet" && b.providerMarketId && b.providerSelectionId ? .05 : 0;
    const scoreA = a.confidence + quality[a.dataQuality ?? "LOW"] + readinessA + (a.marketProbability ?? 0) * .18 + (a.expectedValue ?? 0) * .25 + (a.quotedOdds ? .03 : 0);
    const scoreB = b.confidence + quality[b.dataQuality ?? "LOW"] + readinessB + (b.marketProbability ?? 0) * .18 + (b.expectedValue ?? 0) * .25 + (b.quotedOdds ? .03 : 0);
    return scoreB - scoreA;
  });
  const candidates = [...new Map(ranked.map((pick) => [pick.fixtureId, pick])).values()].slice(0, 500);
  if (!candidates.length) return null;

  type State = { picks: PredictedPick[]; odds: number; confidence: number; winChance: number };
  let beam: State[] = [{ picks: [], odds: 1, confidence: 0, winChance: 1 }];
  const maxLegs = mode === "target" ? 21 : 8;
  const score = (state: State) => Math.abs(Math.log(Math.max(state.odds, 1.001) / target)) * 3
    + Math.max(0, state.picks.length - (mode === "target" ? 12 : 8)) * .025
    - (state.picks.length ? state.confidence / state.picks.length : 0) * .35;
  for (const pick of candidates) {
    const price = priceFor(pick);
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
  if (mode === "recommended" && (selected.odds < target * .84 || selected.odds > target * 1.18 || selected.winChance < .88 / selected.odds)) return null;
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
