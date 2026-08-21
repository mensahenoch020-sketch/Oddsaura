import { config } from "../../config.js";

type MarketType = "HOME_WIN" | "DRAW" | "AWAY_WIN" | "HOME_OR_DRAW" | "AWAY_OR_DRAW" | "OVER_1_5" | "OVER_2_5" | "UNDER_2_5" | "BTTS_YES" | "BTTS_NO";

type ApiEnvelope<T> = { response: T[]; errors?: Record<string, unknown> };

export type ProviderFixture = {
  fixture: { id: number; date: string; status: { short: string }; venue?: { name?: string } };
  league: { id: number; name: string; country: string; season: number; logo?: string; round?: string };
  teams: { home: { id: number; name: string; logo?: string }; away: { id: number; name: string; logo?: string } };
  goals: { home: number | null; away: number | null };
};

type ProviderOdds = {
  fixture: { id: number };
  bookmakers: Array<{ name: string; bets: Array<{ name: string; values: Array<{ value: string; odd: string }> }> }>;
};

async function get<T>(path: string, params: Record<string, string | number>) {
  if (!config.FOOTBALL_API_KEY) return [] as T[];
  const url = new URL(path, config.FOOTBALL_API_BASE_URL);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, { headers: { "x-apisports-key": config.FOOTBALL_API_KEY } });
  if (!response.ok) throw new Error(`Football API request failed: ${response.status} ${response.statusText}`);
  const body = await response.json() as ApiEnvelope<T>;
  if (body.errors && Object.keys(body.errors).length) throw new Error(`Football API error: ${JSON.stringify(body.errors)}`);
  return body.response;
}

export async function fetchFixtures(league: number, season: number, from: string, to: string) {
  return get<ProviderFixture>("/fixtures", { league, season, from, to });
}

export async function fetchFixtureOdds(fixtureId: number) {
  return get<ProviderOdds>("/odds", { fixture: fixtureId });
}

const marketMap: Record<string, Record<string, MarketType>> = {
  "Match Winner": { Home: "HOME_WIN", Draw: "DRAW", Away: "AWAY_WIN" },
  "Double Chance": { "Home or Draw": "HOME_OR_DRAW", "Draw or Away": "AWAY_OR_DRAW", "1X": "HOME_OR_DRAW", "X2": "AWAY_OR_DRAW" },
  "Goals Over/Under": { "Over 1.5": "OVER_1_5", "Over 2.5": "OVER_2_5", "Under 2.5": "UNDER_2_5" },
  "Both Teams Score": { Yes: "BTTS_YES", No: "BTTS_NO" },
};

export function normalizeOdds(response: ProviderOdds[]) {
  const rows: Array<{ provider: string; bookmaker: string; market: MarketType; selection: string; decimal: number }> = [];
  for (const item of response) {
    for (const bookmaker of item.bookmakers ?? []) {
      for (const bet of bookmaker.bets ?? []) {
        const selections = marketMap[bet.name];
        if (!selections) continue;
        for (const value of bet.values ?? []) {
          const market = selections[value.value];
          const decimal = Number(value.odd);
          if (!market || !Number.isFinite(decimal) || decimal <= 1) continue;
          rows.push({ provider: "api-football", bookmaker: bookmaker.name, market, selection: value.value, decimal });
        }
      }
    }
  }
  return rows;
}
