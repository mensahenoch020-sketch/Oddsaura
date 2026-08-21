export type ProviderId = "sportybet" | "bet9ja" | "betpawa" | "1xbet" | "draftkings";

export type ProviderAdapter = {
  id: ProviderId;
  label: string;
  capability: "booking-code" | "deep-link";
  status: "endpoint-required" | "partial";
};

export const providerAdapters: ProviderAdapter[] = [
  { id: "sportybet", label: "SportyBet", capability: "booking-code", status: "endpoint-required" },
  { id: "bet9ja", label: "Bet9ja", capability: "booking-code", status: "endpoint-required" },
  { id: "betpawa", label: "BetPawa", capability: "booking-code", status: "endpoint-required" },
  { id: "1xbet", label: "1xBet", capability: "booking-code", status: "endpoint-required" },
  { id: "draftkings", label: "DraftKings", capability: "deep-link", status: "partial" },
];

type ProviderSelection = { provider?: string; deepLink?: string | null };

export function inspectProviderSlip(providerId: ProviderId, selections: ProviderSelection[]) {
  const adapter = providerAdapters.find((item) => item.id === providerId) ?? providerAdapters[0];
  const linked = selections.filter((selection) => Boolean(selection.deepLink)).length;
  if (adapter.capability === "deep-link") {
    return `${adapter.label}: ${linked} of ${selections.length} selections have a verified bookmaker link. A combined booking code is not exposed by this feed.`;
  }
  return `${adapter.label}: all ${selections.length} selections are stored in a provider-neutral format. Its verified booking-code endpoint is still required; OddsAura will not invent a code.`;
}
