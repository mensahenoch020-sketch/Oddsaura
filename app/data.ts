export type Team = { id?: string; name: string; shortName?: string; logo?: string | null };
export type League = { id?: string; name: string; country?: string; season?: string };
export type FixtureOdd = { marketId: string; market: string; selectionId: string; selection: string; line?: number | null; odds: number; source: string; provider?: string; deepLink?: string | null };
export type Fixture = { id: string; providerId?: string; source?: string; league: League; kickoff: string; status: string; homeTeam: Team; awayTeam: Team; homeScore?: number | null; awayScore?: number | null; odds: FixtureOdd[] };
export type TicketSelection = {
  id: string;
  fixtureId: string;
  league: League;
  kickoff: string;
  homeTeam: Team;
  awayTeam: Team;
  market: { key: string; name: string; category: string; line?: number | null };
  selection: string;
  odds: number;
  probability: number;
  confidence: number;
  edge?: number | null;
  expectedValue?: number | null;
  marketProbability?: number | null;
  modelProbability?: number | null;
  modelMarketGap?: number | null;
  oddsSource?: string | null;
  priceStatus?: "QUOTED" | "MODEL_ESTIMATE";
  result?: "PENDING" | "WON" | "LOST" | "VOID" | "UNVERIFIED";
};
export type WatchlistPick = Omit<TicketSelection, "odds" | "edge"> & {
  fairOdds: number;
  quotedOdds?: number | null;
};
export type PredictedPick = Omit<TicketSelection, "odds"> & {
  quotedOdds: number | null;
  fairOdds: number;
  tier: "SAFE" | "BALANCED" | "HIGH_RISK";
  dataQuality?: "LOW" | "MEDIUM" | "HIGH";
  historyMatches?: number;
  homeHistoryMatches?: number;
  awayHistoryMatches?: number;
  recentHistoryMatches?: number;
  reasoning: string;
  oddsProvider?: string | null;
  providerMarketId?: string | null;
  providerSelectionId?: string | null;
  providerDeepLink?: string | null;
};
export type Ticket = { id: string; title: string; category: string; status: string; totalOdds: number; confidence: number; estimatedWinChance?: number; breakEvenChance?: number; strategyVersion?: string; paper?: boolean; priceStatus?: "QUOTED" | "MODEL_ESTIMATE"; publishedAt?: string; settledAt?: string | null; wonLegs?: number; lostLegs?: number; voidLegs?: number; bookingCodes: Array<{ provider: string; code: string; deepLink?: string }>; selections: TicketSelection[] };
export type PaperTrial = TicketSelection & { predictedAt: string; settledAt: string | null; trialTier?: "OBSERVATION" };
export type PaperMetrics = { recorded: number; settled: number; won: number; lost: number; hitRate: number | null; flatStakeRoi: number | null };
export type Snapshot = {
  version: number;
  generatedAt: string | null;
  stale: boolean;
  status: string;
  message: string;
  sources: Array<{ id: string; label: string; status: string; lastSuccessAt: string | null; records: number; warnings?: string[] }>;
  metrics: { fixtures: number; live: number; completed: number; pricedMarkets: number; predictions: number; selectablePredictions?: number; publishedTickets: number; historicalMatches?: number; historicalTeams?: number; teamsWithDeepHistory?: number; noBetCategories?: string[]; strategyVersion?: string; paperTrials?: PaperMetrics };
  fixtures?: Fixture[];
  liveFixtures?: Fixture[];
  recentResults?: Fixture[];
  predictedPicks?: PredictedPick[];
  marketCatalog: string[];
  watchlist?: WatchlistPick[];
  tickets: Ticket[];
  ticketHistory?: Ticket[];
  paperTrials?: PaperTrial[];
  modelPerformance?: { matches: number; oneXTwoAccuracy: number; over25Accuracy: number; brierScore: number; generatedAt: string } | null;
};

export const fallbackSnapshot: Snapshot = {
  version: 4,
  generatedAt: null,
  stale: true,
  status: "waiting",
  message: "Loading the latest football snapshot…",
  sources: [],
  metrics: { fixtures: 0, live: 0, completed: 0, pricedMarkets: 0, predictions: 0, selectablePredictions: 0, publishedTickets: 0 },
  fixtures: [],
  liveFixtures: [],
  recentResults: [],
  predictedPicks: [],
  marketCatalog: [],
  watchlist: [],
  tickets: [],
  ticketHistory: [],
  paperTrials: [],
};
export type SnapshotScope = "snapshot" | "builder" | "matches" | "daily" | "results" | "admin";
const publicDataBase = "https://raw.githubusercontent.com/mensahenoch020-sketch/Oddsaura/main/data/public";

async function fetchSnapshot(url: string, timeout = 6_000, cache: RequestCache = "force-cache") {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { cache, signal: controller.signal });
    if (!response.ok) throw new Error(`Football data returned ${response.status}`);
    return await response.json() as Snapshot;
  } finally {
    window.clearTimeout(timer);
  }
}

function remoteSnapshotUrl(scope: SnapshotScope, cacheWindow: number) {
  const configured = process.env.NEXT_PUBLIC_DATA_URL;
  if (configured && scope === "snapshot") return `${configured}?v=${cacheWindow}`;
  return `${publicDataBase}/${scope}.json?v=${cacheWindow}`;
}

export async function loadSnapshot(scope: SnapshotScope = "snapshot") {
  const cacheWindow = Math.floor(Date.now() / 300_000);
  const configured = process.env.NEXT_PUBLIC_DATA_URL;
  const remoteUrl = configured && scope === "snapshot" ? configured : `${publicDataBase}/${scope}.json`;
  // Route-sized files are built into every deployment. Loading them first
  // avoids a slow GitHub 404 and a multi-megabyte snapshot download.
  if (scope === "snapshot") return fetchSnapshot(`${remoteUrl}?v=${cacheWindow}`);
  try { return await fetchSnapshot(`/data/${scope}.json?v=${cacheWindow}`, 3_500); }
  catch {
    try { return await fetchSnapshot(`${remoteUrl}?v=${cacheWindow}`); }
    catch { return fetchSnapshot(`${configured ?? `${publicDataBase}/snapshot.json`}?v=${cacheWindow}`); }
  }
}

/** Fetch the newest generated data without waiting for another site deployment. */
export async function refreshSnapshot(scope: SnapshotScope) {
  const cacheWindow = Math.floor(Date.now() / 60_000);
  try { return await fetchSnapshot(remoteSnapshotUrl(scope, cacheWindow), 8_000, "no-store"); }
  catch { return fetchSnapshot(`${publicDataBase}/snapshot.json?v=${cacheWindow}`, 8_000, "no-store"); }
}
