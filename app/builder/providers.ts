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
  { id: "bet9ja", label: "Bet9ja", capability: "booking-code", status: "integration", deepLink: "https://sports.bet9ja.com/mobile/" },
  { id: "betpawa", label: "betPawa", capability: "booking-code", status: "live" },
  { id: "betway", label: "Betway", capability: "booking-code", status: "live", deepLink: "https://www.betway.com.ng/book-a-bet" },
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

export async function generateBookmakerCode(provider: ProviderId, selections: BookmakerSelection[], allowPartial = false) {
  const response = await fetch(`/api/providers/${encodeURIComponent(provider)}/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selections, allowPartial }),
  });
  const payload = await response.json() as BookmakerCodeResponse & { error?: string };
  if (!response.ok || !payload.code) throw new Error(payload.error || `${provider} could not create this code.`);
  return payload;
}

export const generateSportyBetCode = (selections: BookmakerSelection[], allowPartial = false) => generateBookmakerCode("sportybet", selections, allowPartial);
export type SportyBetCodeResponse = BookmakerCodeResponse;
