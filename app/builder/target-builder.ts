import type { PredictedPick } from "../data";

export type TargetBuild = {
  picks: PredictedPick[];
  target: number;
  estimatedOdds: number;
  averageConfidence: number;
  estimatedWinChance: number;
};

export function buildTargetSlip(predictions: PredictedPick[], requestedTarget: number, now = Date.now(), preferProviderIds = false): TargetBuild | null {
  const target = Math.max(1.2, Math.min(100, Number.isFinite(requestedTarget) ? requestedTarget : 5));
  const quality = { HIGH: .08, MEDIUM: .04, LOW: 0 } as const;
  const ranked = predictions
    .filter((pick) => {
      const price = pick.quotedOdds ?? 0;
      return Date.parse(pick.kickoff) > now + 30 * 60_000
        && price >= 1.08 && price <= 2
        && pick.dataQuality === "HIGH"
        && (pick.historyMatches == null || pick.historyMatches >= 12)
        && pick.confidence >= .58
        && pick.probability >= .65
        && (pick.edge == null || pick.edge >= -.02);
    })
    .sort((a, b) => {
      const readinessA = preferProviderIds && a.providerMarketId && a.providerSelectionId ? .09 : 0;
      const readinessB = preferProviderIds && b.providerMarketId && b.providerSelectionId ? .09 : 0;
      return (b.confidence + quality[b.dataQuality ?? "LOW"] + readinessB) - (a.confidence + quality[a.dataQuality ?? "LOW"] + readinessA);
    });
  const candidates = [...new Map(ranked.map((pick) => [pick.fixtureId, pick])).values()].slice(0, 500);
  type State = { picks: PredictedPick[]; odds: number; confidence: number; winChance: number };
  let beam: State[] = [{ picks: [], odds: 1, confidence: 0, winChance: 1 }];
  const score = (state: State) => Math.abs(Math.log(Math.max(state.odds, 1.001) / target)) * 2.4
    + Math.max(0, state.picks.length - 10) * .06
    - (state.picks.length ? state.confidence / state.picks.length : 0) * .45
    - Math.log(Math.max(state.winChance, .000001)) * .08;
  for (const pick of candidates) {
    const price = pick.quotedOdds!;
    const additions = beam.flatMap((state) => {
      if (state.picks.length >= 15 || state.odds * price > target * 1.4) return [];
      return [{ picks: [...state.picks, pick], odds: state.odds * price, confidence: state.confidence + pick.confidence, winChance: state.winChance * pick.probability }];
    });
    beam = [...beam, ...additions].sort((a, b) => score(a) - score(b)).slice(0, 420);
  }
  const minLegs = target < 2.5 ? 1 : 2;
  const selected = beam
    .filter((state) => state.picks.length >= minLegs && state.odds >= target * .84 && state.odds <= target * 1.18)
    .sort((a, b) => score(a) - score(b))[0];
  return selected ? {
    picks: selected.picks,
    target,
    estimatedOdds: selected.odds,
    averageConfidence: selected.confidence / selected.picks.length,
    estimatedWinChance: selected.winChance,
  } : null;
}
