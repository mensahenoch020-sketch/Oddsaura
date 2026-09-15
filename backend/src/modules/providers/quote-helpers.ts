import type { SportyBetResolvedSelection, SportyBetSelectionInput } from "./sportybet.js";

export type MarketQuote = SportyBetResolvedSelection & {
  marketKey: string;
  line: number | null;
};

// Read existing event markets without creating a coupon or booking code.
export function availableQuotes(inputs: SportyBetSelectionInput[], resolve: (input: SportyBetSelectionInput) => SportyBetResolvedSelection): MarketQuote[] {
  return inputs.flatMap(input => {
    try {
      const quote = resolve(input);
      if (!quote.eventId || !quote.marketId || !quote.outcomeId || quote.odds == null || !Number.isFinite(quote.odds) || quote.odds <= 1) return [];
      return [{ ...quote, marketKey: input.marketKey, line: input.line ?? null }];
    } catch {
      // Missing or unsupported outcome: never substitute another line.
      return [];
    }
  });
}
