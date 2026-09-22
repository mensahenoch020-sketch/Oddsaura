export type ProviderId = "sportybet" | "bet9ja" | "betpawa" | "betway" | "betking" | "draftkings";

export type ProviderAdapter = {
  id: ProviderId;
  label: string;
  capability: "booking-code" | "deep-link";
  status: "live" | "integration" | "partial";
  deepLink?: string;
};

export const providerAdapters: ProviderAdapter[] = [
  { id: "sportybet", label: "SportyBet", capability: "booking-code", status: "live" },
  { id: "bet9ja", label: "Bet9ja", capability: "booking-code", status: "live", deepLink: "https://sports.bet9ja.com/mobile/" },
  { id: "betpawa", label: "betPawa", capability: "booking-code", status: "live" },
  { id: "betway", label: "Betway", capability: "booking-code", status: "live", deepLink: "https://www.betway.com.ng/book-a-bet" },
  { id: "betking", label: "BetKing", capability: "booking-code", status: "live" },
  { id: "draftkings", label: "DraftKings", capability: "deep-link", status: "partial" },
];

const automaticMarketPatterns: Record<Exclude<ProviderId, "draftkings">, RegExp> = {
  sportybet: /^(MATCH_(HOME|DRAW|AWAY)|ONE_UP_(HOME|AWAY)|TWO_UP_(HOME|AWAY)|DC_(1X|X2|12)|DNB_(HOME|AWAY)|BTTS_(YES|NO)|ASIAN_(HOME|AWAY)_|ODD_GOALS|EVEN_GOALS|HOME_(OVER|UNDER)_|AWAY_(OVER|UNDER)_|OVER_|UNDER_|HOME_CLEAN|AWAY_CLEAN|HOME_WIN_NIL|AWAY_WIN_NIL|HOME_AND_O15|AWAY_AND_O15|DC1X_AND_O15|DCX2_AND_O15|BTTS_AND_O25|HT_(HOME|DRAW|AWAY)|HT_OVER_|HCP_3WAY_(HOME|DRAW|AWAY)|CS_)/,
  betpawa: /^(MATCH_(HOME|DRAW|AWAY)|ONE_UP_(HOME|AWAY)|TWO_UP_(HOME|AWAY)|DC_(1X|X2|12)|DNB_(HOME|AWAY)|BTTS_(YES|NO)|ASIAN_(HOME|AWAY)_|ODD_GOALS|EVEN_GOALS|HOME_(OVER|UNDER)_|AWAY_(OVER|UNDER)_|OVER_|UNDER_|HOME_CLEAN|AWAY_CLEAN|HOME_WIN_NIL|AWAY_WIN_NIL|HOME_AND_O15|AWAY_AND_O15|HT_(HOME|DRAW|AWAY)|HT_OVER_|CS_)/,
  betway: /^(MATCH_(HOME|DRAW|AWAY)|DC_(1X|X2|12)|DNB_(HOME|AWAY)|BTTS_(YES|NO)|ASIAN_(HOME|AWAY)_|HOME_(OVER|UNDER)_|AWAY_(OVER|UNDER)_|OVER_|UNDER_)/,
  betking: /^(MATCH_(HOME|DRAW|AWAY)|ONE_UP_(HOME|AWAY)|TWO_UP_(HOME|AWAY)|DC_(1X|X2|12)|DNB_(HOME|AWAY)|BTTS_(YES|NO)|ASIAN_(HOME|AWAY)_|HOME_(OVER|UNDER)_|AWAY_(OVER|UNDER)_|OVER_|UNDER_)/,
  // Bet9ja is an assisted workflow until its server accepts automatic creation.
  bet9ja: /^(MATCH_(HOME|DRAW|AWAY)|DC_(1X|X2|12)|DNB_(HOME|AWAY)|BTTS_(YES|NO)|ASIAN_(HOME|AWAY)_|HOME_(OVER|UNDER)_|AWAY_(OVER|UNDER)_|OVER_|UNDER_)/,
};

export function providerSupportsMarket(providerId: ProviderId, marketKey: string) {
  if (providerId === "draftkings") return false;
  return automaticMarketPatterns[providerId].test(marketKey);
}

type ProviderSelection = { provider?: string; deepLink?: string | null };

export function inspectProviderSlip(providerId: ProviderId, selections: ProviderSelection[]) {
  const adapter = providerAdapters.find((item) => item.id === providerId) ?? providerAdapters[0]!;
  const linked = selections.filter((selection) => Boolean(selection.deepLink)).length;
  if (adapter.capability === "booking-code" && adapter.status === "live") {
    return `${adapter.label}: create a code by matching every selection against the bookmaker's live markets, then verifying the returned code.`;
  }
  if (adapter.capability === "deep-link") {
    return `${adapter.label}: ${linked} of ${selections.length} selections have a verified bookmaker link. A combined booking code is not exposed by this feed.`;
  }
  return `${adapter.label}: all ${selections.length} selections are stored in a provider-neutral format. This bookmaker still requires a verified booking-code endpoint; OddsAura will not invent a code.`;
}

export type BookmakerCodeResponse = {
  provider: ProviderId;
  verified: boolean;
  verificationStatus?: "VERIFIED" | "UNVERIFIED" | "MISMATCH";
  warning?: string;
  code: string;
  deepLink: string;
  resolved: Array<{ fixtureId: string; odds: number | null }>;
  partial: boolean;
  unmatched: Array<{ fixtureId: string; homeTeam: string; awayTeam: string; reason: string }>;
  decoded?: number;
  sourceSelections?: BookmakerSelection[];
  sourceIssues?: Array<{ eventName?: string; marketName?: string; outcomeName?: string; reason?: string }>;
  conversionStage?: "INPUT" | "IMPORT" | "TRANSLATE" | "MATCH" | "CREATE" | "VERIFY";
};

export class BookmakerCodeError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "BookmakerCodeError";
  }
}

export function unavailableFixtureId(error: unknown) {
  if (!(error instanceof BookmakerCodeError) || !error.details || typeof error.details !== "object") return null;
  const details = error.details as { fixtureId?: unknown; unmatched?: Array<{ fixtureId?: unknown }> };
  if (typeof details.fixtureId === "string") return details.fixtureId;
  const unmatched = Array.isArray(details.unmatched) ? details.unmatched.find((item) => typeof item?.fixtureId === "string") : null;
  return typeof unmatched?.fixtureId === "string" ? unmatched.fixtureId : null;
}

export type BookmakerSelection = {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  marketKey: string;
  marketName: string;
  selection: string;
  line?: number | null;
  providerEventId?: string | null;
  providerMarketId?: string | null;
  providerOutcomeId?: string | null;
  providerSpecifier?: string | null;
  quotedOdds?: number | null;
};

export type DecodedBookmakerCode = {
  sourceProvider: ProviderId;
  sourceCode: string;
  selections: BookmakerSelection[];
  partial: boolean;
  skipped: number;
  skippedSelections: Array<{ eventName?: string; marketName?: string; outcomeName?: string; reason?: string }>;
};

export async function decodeBookmakerCode(provider: ProviderId, code: string) {
  const response = await fetch(`/api/providers/${encodeURIComponent(provider)}/decode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const payload = await response.json() as DecodedBookmakerCode & { error?: string; details?: unknown };
  if (!response.ok || !payload.selections) throw new BookmakerCodeError(payload.error || `${provider} could not load this code.`, payload.details);
  return payload;
}

export async function generateBookmakerCode(provider: ProviderId, selections: BookmakerSelection[], allowPartial = false) {
  const response = await fetch(`/api/providers/${encodeURIComponent(provider)}/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selections, allowPartial }),
  });
  const payload = await response.json() as BookmakerCodeResponse & { error?: string; details?: unknown };
  if (!response.ok || !payload.code) throw new BookmakerCodeError(payload.error || `${provider} could not create this code.`, payload.details);
  return payload;
}

export const generateSportyBetCode = (selections: BookmakerSelection[], allowPartial = false) => generateBookmakerCode("sportybet", selections, allowPartial);
export type SportyBetCodeResponse = BookmakerCodeResponse;

export async function expandBookmakerMarkets(provider: ProviderId, start: string, end: string, marketKeys?: string[], fixtureLimit?: number) {
  const response = await fetch(`/api/providers/${encodeURIComponent(provider)}/expand`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ start, end, ...(marketKeys?.length ? { marketKeys } : {}), ...(fixtureLimit ? { fixtureLimit } : {}) }),
  });
  const payload = await response.json() as { picks?: import("../data").PredictedPick[]; error?: string };
  if (!response.ok) throw new BookmakerCodeError(payload.error || `${provider} could not expand its live match pool.`);
  return payload.picks ?? [];
}
