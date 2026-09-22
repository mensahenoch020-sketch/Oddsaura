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
  bet9ja: { label: "Bet9ja", deepLink: "https://sports.bet9ja.com/mobile/", status: "live" },
  betking: { label: "BetKing", deepLink: "https://m.betking.com/en-ng/sports", status: "live" },
  betway: { label: "Betway", deepLink: "https://www.betway.com.ng/book-a-bet", status: "live" },
};

export class BookmakerIntegrationError extends Error {
  constructor(message: string, readonly status = 422, readonly details?: unknown) {
    super(message);
    this.name = "BookmakerIntegrationError";
  }
}

type ProviderOperation = { status: "AVAILABLE" | "DEGRADED" | "UNTESTED" | "ASSISTED"; stage: "IMPORT" | "CREATE" | null; checkedAt: string | null; message: string };
const providerOperations = new Map<BookmakerId, ProviderOperation>();

function recordProviderOperation(provider: BookmakerId, status: "AVAILABLE" | "DEGRADED", stage: "IMPORT" | "CREATE", message: string) {
  providerOperations.set(provider, { status, stage, checkedAt: new Date().toISOString(), message });
}

export function providerHealthReport() {
  return BOOKMAKER_IDS.map((provider) => {
    const catalog = bookmakerCatalog[provider];
    const observed = providerOperations.get(provider);
    return {
      provider,
      label: catalog.label,
      integration: catalog.status,
      capabilities: { importCode: true, createCode: catalog.status === "live", reloadVerification: true },
      ...(observed ?? { status: catalog.status === "integration" ? "ASSISTED" : "UNTESTED", stage: null, checkedAt: null, message: catalog.status === "integration" ? "Automatic code creation is not dependable yet." : "No bookmaker operation has run on this server instance yet." }),
    };
  });
}

export async function inspectBookmakerCode(provider: BookmakerId, code: string, fetcher: typeof fetch = fetch) {
  try {
    const decoded = await decodeBookmakerCode(provider, code, fetcher);
    recordProviderOperation(provider, "AVAILABLE", "IMPORT", "The latest booking code was imported successfully.");
    return decoded;
  } catch (error) {
    recordProviderOperation(provider, "DEGRADED", "IMPORT", error instanceof Error ? error.message : "The latest booking-code import failed.");
    if (error instanceof BookmakerDecodeError) throw new BookmakerIntegrationError(error.message, error.status, stageDetails("IMPORT", error.details));
    throw new BookmakerIntegrationError(`${bookmakerCatalog[provider].label} could not load that code right now.`, 502, stageDetails("IMPORT", { cause: error instanceof Error ? error.message : String(error) }));
  }
}

export type ConversionStage = "INPUT" | "IMPORT" | "TRANSLATE" | "MATCH" | "CREATE" | "VERIFY";

function stageDetails(stage: ConversionStage, details?: unknown) {
  const existing = details && typeof details === "object" && !Array.isArray(details) ? details : {};
  return { ...existing, stage };
}

function creationStage(details?: unknown): ConversionStage {
  if (!details || typeof details !== "object" || Array.isArray(details)) return "CREATE";
  const value = details as { unmatched?: unknown[]; fixtureId?: unknown };
  return value.fixtureId || value.unmatched?.length ? "MATCH" : "CREATE";
}

async function createBookmakerCodeInternal(provider: BookmakerId, selections: SportyBetSelectionInput[], fetcher: typeof fetch, allowPartial: boolean): Promise<SportyBetCodeResult> {
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

export async function createBookmakerCode(provider: BookmakerId, selections: SportyBetSelectionInput[], fetcher: typeof fetch = fetch, allowPartial = false): Promise<SportyBetCodeResult> {
  try {
    const result = await createBookmakerCodeInternal(provider, selections, fetcher, allowPartial);
    recordProviderOperation(provider, "AVAILABLE", "CREATE", result.verificationStatus === "VERIFIED" ? "The latest code was created and reload-verified." : "The latest code was created; reload verification was incomplete.");
    return result;
  } catch (error) {
    recordProviderOperation(provider, "DEGRADED", "CREATE", error instanceof Error ? error.message : "The latest code-creation request failed.");
    throw error;
  }
}

export async function convertBookmakerCode(sourceProvider: BookmakerId, destinationProvider: BookmakerId, code: string, fetcher: typeof fetch = fetch, allowPartial = false) {
  if (sourceProvider === destinationProvider) throw new BookmakerIntegrationError("Choose a different destination bookmaker.", 400, { stage: "INPUT" });
  let decoded: Awaited<ReturnType<typeof decodeBookmakerCode>> | null = null;
  try {
    try {
      decoded = await decodeBookmakerCode(sourceProvider, code, fetcher);
      recordProviderOperation(sourceProvider, "AVAILABLE", "IMPORT", "The latest booking code was imported successfully.");
    } catch (error) {
      recordProviderOperation(sourceProvider, "DEGRADED", "IMPORT", error instanceof Error ? error.message : "The latest booking-code import failed.");
      if (error instanceof BookmakerDecodeError) throw new BookmakerIntegrationError(error.message, error.status, stageDetails("IMPORT", error.details));
      throw new BookmakerIntegrationError(`${bookmakerCatalog[sourceProvider].label} could not load that code right now.`, 502, stageDetails("IMPORT", { cause: error instanceof Error ? error.message : String(error) }));
    }
    if (decoded.partial && !allowPartial) {
      const firstSkipped = decoded.skippedSelections[0];
      const subject = firstSkipped ? `${firstSkipped.eventName} — ${firstSkipped.marketName}: ${firstSkipped.outcomeName}` : `${decoded.skipped} selection${decoded.skipped === 1 ? "" : "s"}`;
      throw new BookmakerIntegrationError(`Could not safely translate ${subject}. No selections were removed and no partial code was created.`, 422, { stage: "TRANSLATE", skipped: decoded.skipped, skippedSelections: decoded.skippedSelections, sourceSelections: decoded.selections });
    }
    let result: SportyBetCodeResult;
    try {
      result = await createBookmakerCode(destinationProvider, decoded.selections, fetcher, allowPartial);
    } catch (error) {
      if (error instanceof BookmakerIntegrationError) {
        const existing = error.details && typeof error.details === "object" && !Array.isArray(error.details) ? error.details : {};
        throw new BookmakerIntegrationError(error.message, error.status, { ...existing, stage: creationStage(existing), sourceSelections: decoded.selections });
      }
      throw new BookmakerIntegrationError(`${bookmakerCatalog[destinationProvider].label} could not create a booking code right now.`, 502, { stage: "CREATE", sourceSelections: decoded.selections, cause: error instanceof Error ? error.message : String(error) });
    }
    return { sourceProvider, destinationProvider, sourceCode: decoded.sourceCode, decoded: decoded.selections.length, importPartial: decoded.partial, sourceIssues: decoded.skippedSelections, sourceSelections: decoded.selections, conversionStage: result.verificationStatus === "VERIFIED" ? "VERIFY" : "CREATE", ...result, partial: Boolean(decoded.partial || result.partial) };
  } catch (error) {
    if (error instanceof BookmakerIntegrationError) throw error;
    throw new BookmakerIntegrationError("The booking code could not be converted.", 502, { stage: decoded ? "CREATE" : "IMPORT", cause: error instanceof Error ? error.message : String(error) });
  }
}
