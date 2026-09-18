import { collectBookmakerMarkets, type QuoteProvider } from "./market-collection.js";
import type { SportyBetSelectionInput } from "./sportybet.js";

export type ExpansionCandidate = {
  id: string;
  fixtureId: string;
  league: { id?: string; name: string; country?: string };
  kickoff: string;
  homeTeam: { id?: string; name: string; shortName?: string; logo?: string | null };
  awayTeam: { id?: string; name: string; shortName?: string; logo?: string | null };
  key: string;
  name: string;
  category: string;
  line?: number | null;
  selection: string;
  probability: number;
  confidence: number;
  fairOdds: number;
  dataQuality: "HIGH" | "MEDIUM";
  historyMatches: number;
  homeHistoryMatches?: number;
  awayHistoryMatches?: number;
  recentHistoryMatches?: number;
  engineVersion?: string;
  calibrated?: boolean;
  calibrationSamples?: number;
  calibrationGain?: number;
  marketModelWeight?: number;
  marketWeightLearned?: boolean;
  marketWeightSamples?: number;
};

const family = (key: string) => {
  if (key.startsWith("MATCH_")) return ["MATCH_HOME", "MATCH_DRAW", "MATCH_AWAY"];
  if (key.startsWith("DNB_")) return ["DNB_HOME", "DNB_AWAY"];
  if (key.startsWith("DC_")) return ["DC_1X", "DC_X2", "DC_12"];
  if (key.startsWith("BTTS_")) return ["BTTS_YES", "BTTS_NO"];
  if (/^(HOME_|AWAY_)?(OVER|UNDER)_/.test(key)) return [key.replace("UNDER_", "OVER_"), key.replace("OVER_", "UNDER_")];
  return [];
};

export async function expandProviderMarkets(provider: QuoteProvider, candidates: ExpansionCandidate[], fetcher: typeof fetch = fetch, fixtureLimit = 40) {
  const now = Date.now();
  const valid = candidates.filter(candidate => Number.isFinite(Date.parse(candidate.kickoff)) && Date.parse(candidate.kickoff) > now + 30 * 60_000);
  const byFixture = new Map<string, ExpansionCandidate[]>();
  for (const candidate of valid) byFixture.set(candidate.fixtureId, [...(byFixture.get(candidate.fixtureId) ?? []), candidate]);
  const groups = [...byFixture.values()].slice(0, Math.max(1, Math.min(80, fixtureLimit)));
  const inputs: SportyBetSelectionInput[][] = groups.map(rows => rows.map(candidate => ({
    fixtureId: candidate.fixtureId,
    homeTeam: candidate.homeTeam.name,
    awayTeam: candidate.awayTeam.name,
    kickoff: candidate.kickoff,
    marketKey: candidate.key,
    marketName: candidate.name,
    selection: candidate.selection,
    line: candidate.line ?? null,
  })));
  const collected = await collectBookmakerMarkets(inputs, { fetcher, providers: [provider], timeoutMs: 150_000, workers: groups.length > 40 ? 4 : 2 });
  const pricingNow = Date.now();
  const fresh = collected.quotes.filter(quote => quote.provider === provider && typeof quote.odds === "number" && Number.isFinite(quote.odds) && quote.odds > 1 && pricingNow - Date.parse(quote.observedAt) >= 0 && pricingNow - Date.parse(quote.observedAt) <= 30 * 60_000);
  const quoteIndex = new Map(fresh.map(quote => [`${quote.fixtureId}|${quote.marketKey}|${quote.line ?? ""}`, quote]));
  const candidateIndex = new Map(valid.map(candidate => [`${candidate.fixtureId}|${candidate.key}|${candidate.line ?? ""}`, candidate]));
  const picks = fresh.flatMap(quote => {
    const candidate = candidateIndex.get(`${quote.fixtureId}|${quote.marketKey}|${quote.line ?? ""}`);
    const price = Number(quote.odds);
    if (!candidate || !Number.isFinite(price) || price <= 1) return [];
    const keys = family(quote.marketKey);
    const siblings = keys.map(key => quoteIndex.get(`${quote.fixtureId}|${key}|${quote.line ?? ""}`));
    if (!keys.length || siblings.some(item => !item)) return [];
    const totalImplied = siblings.reduce((sum, item) => sum + 1 / Number(item!.odds), 0);
    const marketProbability = (1 / price) / totalImplied * (quote.marketKey.startsWith("DC_") ? 2 : 1);
    if (!(marketProbability > 0 && marketProbability < 1)) return [];
    const quality = candidate.dataQuality === "HIGH" ? 1 : .5;
    const modelWeight = Math.max(0, Math.min(.4, candidate.marketModelWeight ?? (.05 + quality * .05)));
    const probability = candidate.probability * modelWeight + marketProbability * (1 - modelWeight);
    return [{
      ...candidate,
      id: `${provider}-${candidate.fixtureId}-${candidate.key}-${candidate.line ?? "none"}`,
      market: { key: candidate.key, name: candidate.name, category: candidate.category, line: candidate.line ?? null },
      probability,
      confidence: probability * (.85 + quality * .15),
      fairOdds: Number((1 / probability).toFixed(2)),
      quotedOdds: price,
      oddsProvider: provider,
      oddsSource: `bookmaker-${provider}`,
      quoteObservedAt: quote.observedAt,
      providerEventId: quote.eventId,
      providerMarketId: quote.marketId,
      providerSelectionId: quote.outcomeId,
      providerSpecifier: quote.specifier,
      marketProbability,
      impliedProbability: 1 / price,
      modelProbability: candidate.probability,
      edge: probability - marketProbability,
      modelMarketGap: Math.abs(candidate.probability - marketProbability),
      expectedValue: probability * price - 1,
      tier: "BALANCED" as const,
      priceStatus: "QUOTED" as const,
      reasoning: `${candidate.engineVersion ?? "structural model"} · ${candidate.historyMatches} historical matches · fresh ${provider} market price · model contribution ${Math.round(modelWeight * 100)}%`,
    }];
  });
  return { generatedAt: collected.completedAt, provider, fixturesAvailable: byFixture.size, fixturesChecked: groups.length, picks, coverage: collected.providers[0] };
}
