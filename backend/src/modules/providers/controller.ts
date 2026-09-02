import { createSportyBetCode, SportyBetIntegrationError, type SportyBetCodeResult, type SportyBetSelectionInput } from "./sportybet.js";
import { createBetPawaCode, BetPawaIntegrationError } from "./betpawa.js";
import { createBet9jaCode, Bet9jaIntegrationError } from "./bet9ja.js";
import { createBetKingCode, BetKingIntegrationError } from "./betking.js";
import { createBetwayCode, BetwayIntegrationError } from "./betway.js";
import { decodeBookmakerCode, BookmakerDecodeError } from "./decoder.js";

export const BOOKMAKER_IDS = ["sportybet", "betpawa", "bet9ja", "betking", "betway"] as const;
export type BookmakerId = typeof BOOKMAKER_IDS[number];

export const bookmakerCatalog: Record<BookmakerId, { label: string; deepLink: string; status: "live" | "integration" }> = {
  sportybet: { label: "SportyBet", deepLink: "https://www.sportybet.com/ng/", status: "live" },
  betpawa: { label: "betPawa", deepLink: "https://www.betpawa.ng/", status: "live" },
  bet9ja: { label: "Bet9ja", deepLink: "https://sports.bet9ja.com/mobile/", status: "integration" },
  betking: { label: "BetKing", deepLink: "https://m.betking.com/en-ng/sports", status: "live" },
  betway: { label: "Betway", deepLink: "https://www.betway.com.ng/book-a-bet", status: "live" },
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
  if (provider === "betway") {
    try { return await createBetwayCode(selections, fetcher, allowPartial); }
    catch (error) {
      if (error instanceof BetwayIntegrationError) throw new BookmakerIntegrationError(error.message, error.status, error.details);
      throw error;
    }
  }
  throw new BookmakerIntegrationError("This bookmaker code connection is not ready yet. Your selections have not been sent.", 503, { provider });
}

export async function convertBookmakerCode(sourceProvider: BookmakerId, destinationProvider: BookmakerId, code: string, fetcher: typeof fetch = fetch, allowPartial = false) {
  if (sourceProvider === destinationProvider) throw new BookmakerIntegrationError("Choose a different destination bookmaker.", 400);
  try {
    const decoded = await decodeBookmakerCode(sourceProvider, code, fetcher);
    if (decoded.partial && !allowPartial) {
      const firstSkipped = decoded.skippedSelections[0];
      const subject = firstSkipped ? `${firstSkipped.eventName} — ${firstSkipped.marketName}: ${firstSkipped.outcomeName}` : `${decoded.skipped} selection${decoded.skipped === 1 ? "" : "s"}`;
      throw new BookmakerIntegrationError(`Could not safely translate ${subject}. No selections were removed and no partial code was created.`, 422, { skipped: decoded.skipped, skippedSelections: decoded.skippedSelections });
    }
    const result = await createBookmakerCode(destinationProvider, decoded.selections, fetcher, allowPartial);
    return { sourceProvider, destinationProvider, sourceCode: decoded.sourceCode, decoded: decoded.selections.length, importPartial: decoded.partial, sourceIssues: decoded.skippedSelections, sourceSelections: decoded.selections, ...result, partial: Boolean(decoded.partial || result.partial) };
  } catch (error) {
    if (error instanceof BookmakerIntegrationError) throw error;
    if (error instanceof BookmakerDecodeError) throw new BookmakerIntegrationError(error.message, error.status, error.details);
    throw error;
  }
}
