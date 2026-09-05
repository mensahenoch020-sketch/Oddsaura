import { verifyCreatedCode, compareSelectionIds } from "./verification.js";
import type { SportyBetCodeResult, SportyBetResolvedSelection, SportyBetSelectionInput } from "./sportybet.js";
import { teamSearchTerms, teamSimilarity } from "./team-matching.js";

type Json = Record<string, unknown>;
type FetchLike = typeof fetch;

const ORIGIN = "https://www.betway.com.ng";
const SPORTS = `${ORIGIN}/sportsapi/br`;
const BETTING = `${ORIGIN}/appsynapse/bet-api-sr02`;
const COUNTRY = "NG";
const CULTURE = "en-US";
const cache = new Map<string, { until: number; bundle: Bundle }>();

type Bundle = { events: Json[]; markets: Json[]; outcomes: Json[]; prices: Json[] };
type Rule = { marketName: string; kind: "HOME" | "DRAW" | "AWAY" | "1X" | "12" | "X2" | "OVER" | "UNDER"; line?: number | null };

export class BetwayIntegrationError extends Error {
  constructor(message: string, readonly status = 422, readonly details?: unknown) {
    super(message); this.name = "BetwayIntegrationError";
  }
}

const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const norm = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/oe/g, "o").replace(/ae/g, "a").replace(/ue/g, "u")
  .replace(/\b(fc|cf|sc|afc|club|football|de|the|calcio)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

function teamScore(left: string, right: string) {
  return teamSimilarity(left, right);
}

async function request(fetcher: FetchLike, url: string, init: RequestInit, failure: string) {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, headers: { accept: "application/json", origin: ORIGIN, referer: `${ORIGIN}/sports/soccer/highlights`, "user-agent": "Mozilla/5.0 OddsAura/1.0", ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new BetwayIntegrationError(failure, 502, { cause: error instanceof Error ? error.message : String(error) });
  }
  const text = await response.text();
  let payload: unknown;
  try { payload = JSON.parse(text.replace(/^\uFEFF/, "").trim()); }
  catch { throw new BetwayIntegrationError("Betway returned an unreadable response. Please try again shortly.", 502, { status: response.status, preview: text.slice(0, 120) }); }
  if (!response.ok) throw new BetwayIntegrationError(failure, response.status === 400 || response.status === 404 ? 422 : 502, payload);
  return payload;
}

function rule(input: SportyBetSelectionInput): Rule | null {
  const fixed: Record<string, Rule> = {
    MATCH_HOME: { marketName: "[Win/Draw/Win]", kind: "HOME" }, MATCH_DRAW: { marketName: "[Win/Draw/Win]", kind: "DRAW" }, MATCH_AWAY: { marketName: "[Win/Draw/Win]", kind: "AWAY" },
    DC_1X: { marketName: "[Double Chance]", kind: "1X" }, DC_12: { marketName: "[Double Chance]", kind: "12" }, DC_X2: { marketName: "[Double Chance]", kind: "X2" },
  };
  if (fixed[input.marketKey]) return fixed[input.marketKey]!;
  if (/^OVER_/.test(input.marketKey)) return { marketName: "[Total Goals]", kind: "OVER", line: input.line };
  if (/^UNDER_/.test(input.marketKey)) return { marketName: "[Total Goals]", kind: "UNDER", line: input.line };
  return null;
}

function safeEventId(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 1000 ? String(number) : "";
}

function collectEventIds(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) return [];
  if (typeof value === "number" || typeof value === "string") {
    const id = safeEventId(value); return id ? [id] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectEventIds(item, depth + 1));
  if (!isRecord(value)) return [];
  const direct = safeEventId(value.eventId ?? value.eventID ?? value.EventId ?? value.EventID);
  const searchEvent = isRecord(value.searchEvent) ? value.searchEvent : null;
  const searchEventId = searchEvent && (str(searchEvent.name ?? searchEvent.eventName ?? searchEvent.homeTeam ?? searchEvent.awayTeam) || searchEvent.expectedStartEpoch != null)
    ? safeEventId(searchEvent.id) : "";
  const nested = Object.entries(value).filter(([key]) => /event|result|data|item|match/i.test(key)).flatMap(([, item]) => collectEventIds(item, depth + 1));
  return [...(direct ? [direct] : []), ...(searchEventId ? [searchEventId] : []), ...nested];
}

function bundle(payload: unknown): Bundle {
  const rows = Array.isArray(payload) ? payload.filter(isRecord) : isRecord(payload) ? [payload] : [];
  return {
    events: rows.flatMap((row) => isRecord(row.event) ? [row.event] : Array.isArray(row.events) ? row.events.filter(isRecord) : []),
    markets: rows.flatMap((row) => Array.isArray(row.markets) ? row.markets.filter(isRecord) : []),
    outcomes: rows.flatMap((row) => Array.isArray(row.outcomes) ? row.outcomes.filter(isRecord) : []),
    prices: rows.flatMap((row) => Array.isArray(row.prices) ? row.prices.filter(isRecord) : []),
  };
}

function merge(parts: Bundle[]): Bundle {
  const unique = (rows: Json[], key: string) => [...new Map(rows.map((row) => [str(row[key]), row])).values()];
  return {
    events: unique(parts.flatMap((part) => part.events), "eventId"),
    markets: unique(parts.flatMap((part) => part.markets), "marketId"),
    outcomes: unique(parts.flatMap((part) => part.outcomes), "outcomeId"),
    prices: unique(parts.flatMap((part) => part.prices), "outcomeId"),
  };
}

async function fetchEmop(fetcher: FetchLike, eventIds: string[], marketName: string) {
  if (!eventIds.length) return { events: [], markets: [], outcomes: [], prices: [] } satisfies Bundle;
  const query = new URLSearchParams({ countryCode: COUNTRY, cultureCode: CULTURE, marketNames: marketName });
  for (const id of eventIds.slice(0, 20)) query.append("eventIds", id);
  return bundle(await request(fetcher, `${SPORTS}/v3/Feeds/EMOP?${query}`, { method: "GET" }, "Betway's market service is temporarily unavailable."));
}

async function fallbackUpcoming(fetcher: FetchLike, marketName: string) {
  const parts: Bundle[] = [];
  for (let skip = 0; skip < 400; skip += 100) {
    const query = new URLSearchParams({ countryCode: COUNTRY, sportId: "soccer", Skip: String(skip), Take: "100", cultureCode: CULTURE, isEsport: "false", boostedOnly: "false" });
    query.append("marketTypes", marketName);
    const part = bundle(await request(fetcher, `${SPORTS}/v1/BetBook/Upcoming/?${query}`, { method: "GET" }, "Betway's fixture service is temporarily unavailable."));
    parts.push(part);
    if (part.events.length < 100) break;
  }
  return merge(parts);
}

function eventTime(event: Json) {
  const raw = Number(event.expectedStartEpoch ?? event.startEpoch ?? event.startTime);
  if (Number.isFinite(raw) && raw > 0) return raw > 10_000_000_000 ? raw : raw * 1000;
  return Date.parse(str(event.kickoff ?? event.startDate ?? event.scheduled));
}

async function findBundle(fetcher: FetchLike, input: SportyBetSelectionInput, wanted: Rule) {
  const key = `${norm(input.homeTeam)}|${norm(input.awayTeam)}|${input.kickoff.slice(0, 10)}|${wanted.marketName}`;
  const saved = cache.get(key); if (saved && saved.until > Date.now()) return saved.bundle;
  const ids = new Set<string>();
  const terms = teamSearchTerms(input.homeTeam, input.awayTeam).slice(0, 8);
  for (const term of terms) {
    const query = new URLSearchParams({ query: term, countryCode: COUNTRY, sportId: "soccer" });
    const payload = await request(fetcher, `${SPORTS}/v1/FeedsSearch/EventSearch?${query}`, { method: "GET" }, "Betway's fixture search is temporarily unavailable.");
    for (const id of collectEventIds(payload)) ids.add(id);
    if (ids.size >= 20) break;
  }
  let found = await fetchEmop(fetcher, [...ids], wanted.marketName);
  if (!found.events.length) found = await fallbackUpcoming(fetcher, wanted.marketName);
  cache.set(key, { until: Date.now() + 120_000, bundle: found }); return found;
}

function findEvent(rows: Json[], input: SportyBetSelectionInput) {
  const wantedTime = Date.parse(input.kickoff);
  const ranked = rows.filter((event) => str(event.regionId).toLowerCase() !== "esoccer" && event.isFinished !== true && event.isLive !== true).map((event) => {
    const home = str(event.homeTeam), away = str(event.awayTeam);
    const names = Math.max((teamScore(input.homeTeam, home) + teamScore(input.awayTeam, away)) / 2,
      (teamScore(input.homeTeam, away) + teamScore(input.awayTeam, home)) / 2 * .84);
    const start = eventTime(event), delta = wantedTime && start ? Math.abs(wantedTime - start) : null;
    return { event, names, delta, total: names * .86 + (delta == null ? .5 : Math.max(0, 1 - delta / 86_400_000)) * .14 };
  }).sort((a, b) => b.total - a.total)[0];
  if (!ranked || ranked.names < .68 || (ranked.delta != null && ranked.delta > 259_200_000)) throw new BetwayIntegrationError(`Betway could not match ${input.homeTeam} vs ${input.awayTeam} to its current fixture list.`, 422, { fixtureId: input.fixtureId });
  if (eventTime(ranked.event) <= Date.now()) throw new BetwayIntegrationError(`${input.homeTeam} vs ${input.awayTeam} has already started on Betway.`, 422);
  return ranked.event;
}

function lineFrom(input: SportyBetSelectionInput) {
  if (input.line != null && Number.isFinite(Number(input.line))) return Number(input.line);
  const match = input.marketKey.match(/_(\d+)_(\d+)$/); return match ? Number(`${match[1]}.${match[2]}`) : null;
}

function resolve(data: Bundle, event: Json, input: SportyBetSelectionInput, wanted: Rule): SportyBetResolvedSelection {
  const eventId = str(event.eventId);
  const line = lineFrom(input);
  const markets = data.markets.filter((item) => str(item.eventId) === eventId && item.isActive !== false && item.isSuspended !== true && (str(item.name) === wanted.marketName || str(item.displayName) === wanted.marketName.replace(/[\[\]]/g, "")));
  const marketIds = new Set(markets.flatMap((item) => [str(item.marketId), ...(Array.isArray(item.squashedMarketIds) ? item.squashedMarketIds.map(str) : [])]));
  const candidates = data.outcomes.filter((item) => str(item.eventId) === eventId && item.isTradingActive !== false && item.shouldDisplay !== false && (marketIds.has(str(item.marketId)) || marketIds.has(str(item.originalMarketId))));
  const home = str(event.homeTeam), away = str(event.awayTeam);
  const outcome = candidates.find((item) => {
    const name = norm(`${str(item.displayName ?? item.name)} ${str(item.sbv)}`);
    const handicap = Number(item.handicap);
    if ((wanted.kind === "OVER" || wanted.kind === "UNDER") && (line == null || Math.abs(handicap - line) > .001)) return false;
    if (wanted.kind === "HOME") return teamScore(name, home) >= .7 && !/\bor\b/.test(name);
    if (wanted.kind === "AWAY") return teamScore(name, away) >= .7 && !/\bor\b/.test(name);
    if (wanted.kind === "DRAW") return /^draw$/.test(name);
    if (wanted.kind === "1X") return name.includes(norm(home)) && /\bor draw\b/.test(name);
    if (wanted.kind === "X2") return name.includes(norm(away)) && /draw or/.test(name);
    if (wanted.kind === "12") return name.includes(norm(home)) && name.includes(norm(away)) && /\bor\b/.test(name);
    return wanted.kind === "OVER" ? /^over\b/.test(name) : /^under\b/.test(name);
  });
  if (!outcome) throw new BetwayIntegrationError(`The ${input.marketName}: ${input.selection} pick is not currently priced on Betway for ${input.homeTeam} vs ${input.awayTeam}.`, 422, { fixtureId: input.fixtureId, marketKey: input.marketKey });
  const price = data.prices.find((item) => str(item.outcomeId) === str(outcome.outcomeId));
  const odds = Number(price?.priceDecimal);
  if (!Number.isFinite(odds) || odds <= 1) throw new BetwayIntegrationError(`Betway has suspended the ${input.selection} price for ${input.homeTeam} vs ${input.awayTeam}.`, 422);
  const marketId = str(outcome.originalMarketId) || str(outcome.marketId);
  return { fixtureId: input.fixtureId, eventId, marketId, outcomeId: str(outcome.outcomeId), specifier: line == null ? null : `total=${line}`,
    odds, homeTeam: home || input.homeTeam, awayTeam: away || input.awayTeam, market: str(markets[0]?.displayName) || input.marketName,
    outcome: `${str(outcome.displayName ?? outcome.name)}${str(outcome.sbv)}`.trim() || input.selection };
}

async function mapLimit<T, R>(items: T[], mapper: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; output[index] = await mapper(items[index]!); } }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker)); return output;
}

export async function createBetwayCode(selections: SportyBetSelectionInput[], fetcher: FetchLike = fetch, allowPartial = false): Promise<SportyBetCodeResult> {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 50) throw new BetwayIntegrationError("Choose between 1 and 50 selections.", 400);
  const attempts = await mapLimit(selections, async (input) => {
    try {
      const wanted = rule(input);
      if (!wanted) throw new BetwayIntegrationError(`The ${input.marketName} market is not supported for automatic Betway codes yet.`, 422, { marketKey: input.marketKey });
      const data = await findBundle(fetcher, input, wanted);
      return { input, resolved: resolve(data, findEvent(data.events, input), input, wanted), error: null };
    } catch (error) {
      if (!allowPartial) throw error;
      return { input, resolved: null, error: error instanceof Error ? error.message : "Betway could not match this selection." };
    }
  });
  const resolved = attempts.flatMap((attempt) => attempt.resolved ? [attempt.resolved] : []);
  const unmatched = attempts.flatMap((attempt) => attempt.error ? [{ fixtureId: attempt.input.fixtureId, homeTeam: attempt.input.homeTeam, awayTeam: attempt.input.awayTeam, reason: attempt.error }] : []);
  if (!resolved.length) throw new BetwayIntegrationError(unmatched[0]?.reason || "None of these selections are currently available on Betway.", 422, { unmatched });
  const used = new Set<string>();
  for (const item of resolved) if (used.has(item.eventId)) throw new BetwayIntegrationError("Choose only one prediction from each Betway match.", 422); else used.add(item.eventId);
  const outcomes = resolved.map((item) => ({ outcomeId: item.outcomeId, eventId: Number(item.eventId), marketId: item.marketId, payment: 1, value: 0, selected: true }));
  const created = await request(fetcher, `${BETTING}/v1/Betting/BookABet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cultureCode: CULTURE, countryCode: COUNTRY, isSingleBet: resolved.length === 1, outcomes }) }, "Betway's booking-code service is temporarily unavailable.");
  const code = isRecord(created) ? str(created.bookingCode) : "";
  if (!/^[A-Z0-9]{6,16}$/i.test(code)) throw new BetwayIntegrationError("Betway rejected one or more selections.", 422, created);
  const verificationState = await verifyCreatedCode(async () => {
  const checked = await request(fetcher, `${BETTING}/v2/Betting/FindBookABet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ countryCode: COUNTRY, bookingCode: code, cultureCode: CULTURE }) }, "Betway created a code but did not confirm it. Please try again.");
  const confirmed = isRecord(checked) && Array.isArray(checked.selections) ? checked.selections.filter(isRecord) : [];
  return compareSelectionIds(resolved.map(item => item.outcomeId), confirmed.map(item => isRecord(item.outcome) ? str(item.outcome.outcomeId) : str(item.outcomeId)));
  });
  return { ...verificationState, code, deepLink: `${ORIGIN}/book-a-bet`, resolved, partial: unmatched.length > 0, unmatched };
}
