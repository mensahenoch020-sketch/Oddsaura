export type TicketCandidate = {
  predictionId: string;
  fixtureId: string;
  probability: number;
  confidence: number;
  odds: number;
};

export type TicketBand = "SAFE" | "BALANCED" | "HIGH_RISK";

const bands: Record<TicketBand, { targetMin: number; targetMax: number; minConfidence: number; minOdds: number; maxOdds: number; maxSelections: number }> = {
  SAFE: { targetMin: 2, targetMax: 3, minConfidence: 0.72, minOdds: 1.12, maxOdds: 1.7, maxSelections: 4 },
  BALANCED: { targetMin: 5, targetMax: 10, minConfidence: 0.64, minOdds: 1.2, maxOdds: 2.35, maxSelections: 7 },
  HIGH_RISK: { targetMin: 10, targetMax: 35, minConfidence: 0.54, minOdds: 1.45, maxOdds: 4.5, maxSelections: 8 },
};

export function buildTicket(candidates: TicketCandidate[], band: TicketBand) {
  const config = bands[band];
  const filtered = candidates
    .filter((item) => item.confidence >= config.minConfidence && item.odds >= config.minOdds && item.odds <= config.maxOdds)
    .sort((a, b) => (b.confidence + Math.max(0, b.probability - 1 / b.odds)) - (a.confidence + Math.max(0, a.probability - 1 / a.odds)));

  const selected: TicketCandidate[] = [];
  const fixtures = new Set<string>();
  let totalOdds = 1;
  for (const item of filtered) {
    if (fixtures.has(item.fixtureId)) continue;
    if (selected.length >= config.maxSelections) break;
    if (totalOdds >= config.targetMin) break;
    selected.push(item);
    fixtures.add(item.fixtureId);
    totalOdds *= item.odds;
  }
  const valid = totalOdds >= config.targetMin && totalOdds <= config.targetMax && selected.length >= 2;
  const confidence = selected.length ? selected.reduce((sum, item) => sum + item.confidence, 0) / selected.length : 0;
  return { band, valid, totalOdds: Number(totalOdds.toFixed(2)), confidence, selections: selected };
}
