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
  reasoning: string;
  oddsProvider?: string | null;
  providerMarketId?: string | null;
  providerSelectionId?: string | null;
  providerDeepLink?: string | null;
};
export type Ticket = { id: string; title: string; category: string; status: string; totalOdds: number; confidence: number; priceStatus?: "QUOTED" | "MODEL_ESTIMATE"; publishedAt?: string; settledAt?: string | null; wonLegs?: number; lostLegs?: number; voidLegs?: number; bookingCodes: Array<{ provider: string; code: string; deepLink?: string }>; selections: TicketSelection[] };
export type Snapshot = {
  version: number;
  generatedAt: string | null;
  stale: boolean;
  status: string;
  message: string;
  sources: Array<{ id: string; label: string; status: string; lastSuccessAt: string | null; records: number; warnings?: string[] }>;
  metrics: { fixtures: number; live: number; completed: number; pricedMarkets: number; predictions: number; selectablePredictions?: number; publishedTickets: number };
  fixtures?: Fixture[];
  liveFixtures?: Fixture[];
  recentResults?: Fixture[];
  predictedPicks?: PredictedPick[];
  marketCatalog: string[];
  watchlist?: WatchlistPick[];
  tickets: Ticket[];
  ticketHistory?: Ticket[];
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
};
export const publicSnapshotUrl = process.env.NEXT_PUBLIC_DATA_URL ?? "https://raw.githubusercontent.com/mensahenoch020-sketch/Oddsaura/main/data/public/snapshot.json";

export async function loadSnapshot() {
  const cacheWindow = Math.floor(Date.now() / 300_000);
  const response = await fetch(`${publicSnapshotUrl}?v=${cacheWindow}`, { cache: "no-store" });
  if (!response.ok) throw new Error("The latest GitHub snapshot could not be reached");
  return response.json() as Promise<Snapshot>;
}
