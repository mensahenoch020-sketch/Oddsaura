export type ProviderId = "sportybet" | "bet9ja" | "betpawa" | "1xbet" | "betking" | "draftkings";

export type ProviderAdapter = {
  id: ProviderId;
  label: string;
  capability: "booking-code" | "deep-link";
  status: "live" | "integration" | "partial";
  deepLink?: string;
};

export const providerAdapters: ProviderAdapter[] = [
  { id: "sportybet", label: "SportyBet", capability: "booking-code", status: "live" },
  { id: "bet9ja", label: "Bet9ja", capability: "booking-code", status: "live" },
  { id: "betpawa", label: "betPawa", capability: "booking-code", status: "live" },
  { id: "1xbet", label: "1xBet", capability: "booking-code", status: "partial", deepLink: "https://1xbet.ng/" },
  { id: "betking", label: "BetKing", capability: "booking-code", status: "live" },
  { id: "draftkings", label: "DraftKings", capability: "deep-link", status: "partial" },
];

type ProviderSelection = { provider?: string; deepLink?: string | null };

export function inspectProviderSlip(providerId: ProviderId, selections: ProviderSelection[]) {
  const adapter = providerAdapters.find((item) => item.id === providerId) ?? providerAdapters[0];
  const linked = selections.filter((selection) => Boolean(selection.deepLink)).length;
  if (adapter.capability === "booking-code" && adapter.status === "live") {
    return `${adapter.label}: create a code by matching every selection against the bookmaker's live markets, then verifying the returned code.`;
  }
  if (adapter.capability === "deep-link") {
    return `${adapter.label}: ${linked} of ${selections.length} selections have a verified bookmaker link. A combined booking code is not exposed by this feed.`;
  }
  if (adapter.id === "1xbet") return "1xBet requires a signed-in account before it will save or load a booking code. OddsAura keeps the slip ready for account handoff.";
  return `${adapter.label}: all ${selections.length} selections are stored in a provider-neutral format. This bookmaker still requires a verified booking-code endpoint; OddsAura will not invent a code.`;
}

export type BookmakerCodeResponse = {
  provider: ProviderId;
  verified: true;
  code: string;
  deepLink: string;
  resolved: Array<{ fixtureId: string; odds: number | null }>;
  partial: boolean;
  unmatched: Array<{ fixtureId: string; homeTeam: string; awayTeam: string; reason: string }>;
};

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
};

export async function generateBookmakerCode(provider: ProviderId, selections: BookmakerSelection[], allowPartial = true) {
  const response = await fetch(`/api/providers/${encodeURIComponent(provider)}/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selections, allowPartial }),
  });
  const payload = await response.json() as BookmakerCodeResponse & { error?: string };
  if (!response.ok || !payload.verified || !payload.code) throw new Error(payload.error || `${provider} could not create this code.`);
  return payload;
}

export const generateSportyBetCode = (selections: BookmakerSelection[], allowPartial = true) => generateBookmakerCode("sportybet", selections, allowPartial);
export type SportyBetCodeResponse = BookmakerCodeResponse;
