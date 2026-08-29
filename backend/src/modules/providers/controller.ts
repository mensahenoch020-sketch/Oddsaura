import { createSportyBetCode, SportyBetIntegrationError, type SportyBetCodeResult, type SportyBetSelectionInput } from "./sportybet.js";
import { createBetPawaCode, BetPawaIntegrationError } from "./betpawa.js";
import { createBet9jaCode, Bet9jaIntegrationError } from "./bet9ja.js";
import { createBetKingCode, BetKingIntegrationError } from "./betking.js";

export const BOOKMAKER_IDS = ["sportybet", "betpawa", "bet9ja", "betking", "1xbet"] as const;
export type BookmakerId = typeof BOOKMAKER_IDS[number];

export const bookmakerCatalog: Record<BookmakerId, { label: string; deepLink: string; status: "live" | "integration" }> = {
  sportybet: { label: "SportyBet", deepLink: "https://www.sportybet.com/ng/", status: "live" },
  betpawa: { label: "betPawa", deepLink: "https://www.betpawa.ng/", status: "live" },
  bet9ja: { label: "Bet9ja", deepLink: "https://sports.bet9ja.com/", status: "live" },
  betking: { label: "BetKing", deepLink: "https://m.betking.com/en-ng/sports", status: "live" },
  "1xbet": { label: "1xBet", deepLink: "https://1xbet.ng/", status: "integration" },
};

export class BookmakerIntegrationError extends Error {
  constructor(message: string, readonly status = 422, readonly details?: unknown) {
    super(message);
    this.name = "BookmakerIntegrationError";
  }
}

export async function createBookmakerCode(provider: BookmakerId, selections: SportyBetSelectionInput[], fetcher: typeof fetch = fetch, allowPartial = false): Promise<SportyBetCodeResult> {
  if (provider === "sportybet") {
    try { return await createSportyBetCode(selections, fetcher, allowPartial); }
    catch (error) {
      if (error instanceof SportyBetIntegrationError) throw new BookmakerIntegrationError(error.message, error.status, error.details);
      throw error;
    }
  }
  if (provider === "betpawa") {
    try { return await createBetPawaCode(selections, fetcher, allowPartial); }
    catch (error) {
      if (error instanceof BetPawaIntegrationError) throw new BookmakerIntegrationError(error.message, error.status, error.details);
      throw error;
    }
  }
  if (provider === "bet9ja") {
    try { return await createBet9jaCode(selections, fetcher, allowPartial); }
    catch (error) {
      if (error instanceof Bet9jaIntegrationError) throw new BookmakerIntegrationError(error.message, error.status, error.details);
      throw error;
    }
  }
  if (provider === "betking") {
    try { return await createBetKingCode(selections, fetcher, allowPartial); }
    catch (error) {
      if (error instanceof BetKingIntegrationError) throw new BookmakerIntegrationError(error.message, error.status, error.details);
      throw error;
    }
  }
  const bookmaker = bookmakerCatalog[provider];
  throw new BookmakerIntegrationError(`${bookmaker.label} code verification is not ready yet. Your selections have not been sent to the bookmaker.`, 503, { provider });
}
