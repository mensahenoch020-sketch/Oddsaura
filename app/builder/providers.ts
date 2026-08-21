export type ProviderId = "sportybet" | "bet9ja" | "betpawa" | "1xbet" | "draftkings";

export type ProviderAdapter = {
  id: ProviderId;
  label: string;
  capability: "booking-code" | "deep-link";
  status: "live" | "endpoint-required" | "partial";
};

export const providerAdapters: ProviderAdapter[] = [
  { id: "sportybet", label: "SportyBet", capability: "booking-code", status: "live" },
  { id: "bet9ja", label: "Bet9ja", capability: "booking-code", status: "endpoint-required" },
  { id: "betpawa", label: "BetPawa", capability: "booking-code", status: "endpoint-required" },
  { id: "1xbet", label: "1xBet", capability: "booking-code", status: "endpoint-required" },
  { id: "draftkings", label: "DraftKings", capability: "deep-link", status: "partial" },
];

type ProviderSelection = { provider?: string; deepLink?: string | null };

export function inspectProviderSlip(providerId: ProviderId, selections: ProviderSelection[]) {
  const adapter = providerAdapters.find((item) => item.id === providerId) ?? providerAdapters[0];
  const linked = selections.filter((selection) => Boolean(selection.deepLink)).length;
  if (adapter.id === "sportybet" && adapter.status === "live") {
    return `${adapter.label}: choose Create SportyBet code to match every selection against the live bookmaker markets and return a verified code.`;
  }
  if (adapter.capability === "deep-link") {
    return `${adapter.label}: ${linked} of ${selections.length} selections have a verified bookmaker link. A combined booking code is not exposed by this feed.`;
  }
  return `${adapter.label}: all ${selections.length} selections are stored in a provider-neutral format. This bookmaker still requires a verified booking-code endpoint; OddsAura will not invent a code.`;
}

export type SportyBetCodeResponse = {
  provider: "sportybet";
  verified: true;
  code: string;
  deepLink: string;
  resolved: Array<{ fixtureId: string; odds: number | null }>;
};

export async function generateSportyBetCode(selections: Array<{
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
}>) {
  const response = await fetch("/api/sportybet/code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selections }),
  });
  const payload = await response.json() as SportyBetCodeResponse & { error?: string };
  if (!response.ok || !payload.verified || !payload.code) throw new Error(payload.error || "SportyBet could not create this code.");
  return payload;
}
