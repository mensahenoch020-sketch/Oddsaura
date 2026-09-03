import type { PredictedPick } from "../data";

export type TargetBuild = { picks: PredictedPick[]; target: number; estimatedOdds: number };

export function buildTargetSlip(predictions: PredictedPick[], requestedTarget: number, now = Date.now(), preferProviderIds = false): TargetBuild | null {
  const target = Math.max(1.2, Math.min(100, Number.isFinite(requestedTarget) ? requestedTarget : 5));
  const quality = { HIGH: .08, MEDIUM: .04, LOW: 0 } as const;
  const ranked = predictions
    .filter((pick) => Date.parse(pick.kickoff) > now + 10 * 60_000 && pick.quotedOdds && pick.quotedOdds > 1.01 && pick.confidence >= .48)
    .sort((a, b) => {
      const readinessA = preferProviderIds && a.providerMarketId && a.providerSelectionId ? .09 : 0;
      const readinessB = preferProviderIds && b.providerMarketId && b.providerSelectionId ? .09 : 0;
      return (b.confidence + quality[b.dataQuality ?? "LOW"] + readinessB) - (a.confidence + quality[a.dataQuality ?? "LOW"] + readinessA);
    });
  const candidates = [...new Map(ranked.map((pick) => [pick.fixtureId, pick])).values()].slice(0, 500);
  type State = { picks: PredictedPick[]; odds: number; confidence: number; under: number };
  let beam: State[] = [{ picks: [], odds: 1, confidence: 0, under: 0 }];
  const score = (state: State) => Math.abs(Math.log(Math.max(state.odds, 1.001) / target))
    + Math.max(0, state.picks.length - 9) * .045
    - (state.picks.length ? state.confidence / state.picks.length : 0) * .035;
  for (const pick of candidates) {
    const price = pick.quotedOdds!;
    const additions = beam.flatMap((state) => {
      if (state.picks.length >= 15 || state.odds * price > target * 1.4) return [];
      const under = state.under + (pick.market.key.includes("UNDER") ? 1 : 0);
      if (under > Math.max(1, Math.ceil((state.picks.length + 1) * .4))) return [];
      return [{ picks: [...state.picks, pick], odds: state.odds * price, confidence: state.confidence + pick.confidence + quality[pick.dataQuality ?? "LOW"], under }];
    });
    beam = [...beam, ...additions].sort((a, b) => score(a) - score(b)).slice(0, 420);
  }
  const minLegs = target < 2.5 ? 1 : 2;
  const selected = beam.filter((state) => state.picks.length >= minLegs).sort((a, b) => score(a) - score(b))[0];
  return selected ? { picks: selected.picks, target, estimatedOdds: selected.odds } : null;
}
