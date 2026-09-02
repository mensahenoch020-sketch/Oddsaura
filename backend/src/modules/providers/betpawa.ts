import type { SportyBetCodeResult, SportyBetResolvedSelection, SportyBetSelectionInput } from "./sportybet.js";
import { teamSearchTerms, teamSimilarity } from "./team-matching.js";

type RecordValue = Record<string, unknown>;
type FetchLike = typeof fetch;
const ORIGIN = "https://www.betpawa.ng";
const commonHeaders = {
  accept: "application/json",
  "content-type": "application/json",
  "x-pawa-brand": "betpawa-nigeria",
  devicetype: "web",
  origin: ORIGIN,
  referer: `${ORIGIN}/events/popular`,
};
const cache = new Map<string, { until: number; event: RecordValue }>();

export class BetPawaIntegrationError extends Error {
  constructor(message: string, readonly status = 422, readonly details?: unknown) {
    super(message); this.name = "BetPawaIntegrationError";
  }
}

const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const norm = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\b(fc|cf|sc|afc|club|football|de|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

function score(left: string, right: string) {
  return teamSimilarity(left, right);
}

async function pawaRequest(fetcher: FetchLike, path: string, init: RequestInit, failure: string) {
  let response: Response;
  try {
    response = await fetcher(`${ORIGIN}${path}`, { ...init, headers: { ...commonHeaders, ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new BetPawaIntegrationError(failure, 502, { cause: error instanceof Error ? error.message : String(error) });
  }
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text.replace(/^\uFEFF/, "").trim());
    if (typeof payload === "string" && /^[\[{]/.test(payload.trim())) payload = JSON.parse(payload);
  } catch { throw new BetPawaIntegrationError("betPawa's live service returned an invalid response. Please try again shortly.", 502, { status: response.status, contentType: response.headers.get("content-type"), preview: text.slice(0, 120) }); }
  if (!response.ok) {
    const message = isRecord(payload) ? str(payload.error) : "";
    throw new BetPawaIntegrationError(message || failure, response.status === 400 ? 422 : 502, payload);
  }
  return payload;
}

function payloadEvents(payload: unknown): RecordValue[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.events)) return payload.events.filter(isRecord);
  for (const key of ["data", "results", "content"]) {
    const found = payloadEvents(payload[key]);
    if (found.length) return found;
  }
  return [];
}

const htmlText = (value: string) => value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function publicEventCandidates(fetcher: FetchLike): Promise<RecordValue[]> {
  const found = new Map<string, RecordValue>();
  for (const path of ["/events?categoryId=2&marketId=1X2", "/events/popular?categoryId=2&marketId=1X2"]) {
    try {
      const response = await fetcher(`${ORIGIN}${path}`, { method: "GET", headers: { accept: "text/html", "x-pawa-brand": "betpawa-nigeria", devicetype: "web", "user-agent": "Mozilla/5.0 OddsAura/1.0" }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) continue;
      const html = await response.text();
      const links = html.matchAll(/href=["']\/event\/(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi);
      for (const match of links) found.set(match[1]!, { id: match[1], searchLabel: htmlText(match[2] || "") });
    } catch { /* Search API results remain the primary path. */ }
  }
  return [...found.values()];
}

function teams(event: RecordValue) {
  const list = Array.isArray(event.participants) ? event.participants.filter(isRecord) : [];
  const sorted = [...list].sort((a, b) => Number(a.position) - Number(b.position));
  return { home: str(sorted[0]?.name), away: str(sorted[1]?.name) };
}

function ranked(events: RecordValue[], input: SportyBetSelectionInput) {
  const kickoff = Date.parse(input.kickoff);
  return events.map((event) => {
    const pair = teams(event), label = str(event.searchLabel);
    const names = pair.home && pair.away ? Math.max((score(input.homeTeam, pair.home) + score(input.awayTeam, pair.away)) / 2,
      (score(input.homeTeam, pair.away) + score(input.awayTeam, pair.home)) / 2 * .85) : (score(input.homeTeam, label) + score(input.awayTeam, label)) / 2;
    const start = Date.parse(str(event.startTime));
    const delta = kickoff && start ? Math.abs(kickoff - start) : null;
    return { event, names, delta, total: names * .84 + (delta == null ? .5 : Math.max(0, 1 - delta / 86_400_000)) * .16 };
  }).sort((a, b) => b.total - a.total);
}

async function findEvent(fetcher: FetchLike, input: SportyBetSelectionInput) {
  const key = `${norm(input.homeTeam)}|${norm(input.awayTeam)}|${input.kickoff.slice(0, 10)}`;
  const saved = cache.get(key); if (saved && saved.until > Date.now()) return saved.event;
  const results: RecordValue[] = [];
  const terms = teamSearchTerms(input.homeTeam, input.awayTeam).slice(0, 8);
  for (const term of terms) {
    const payload = await pawaRequest(fetcher, `/api/sportsbook/v3/search?name=${encodeURIComponent(term)}`, { method: "GET" }, "betPawa's fixture search is temporarily unavailable.");
    results.push(...payloadEvents(payload));
    const top = ranked(results, input)[0];
    if (top && top.names >= .9 && (top.delta == null || top.delta <= 28_800_000)) break;
  }
  let match = ranked([...new Map(results.map((event) => [str(event.id), event])).values()], input)[0];
  if (!match || match.names < .7) match = ranked(await publicEventCandidates(fetcher), input)[0];
  if (!match || match.names < .7 || (match.delta != null && match.delta > 259_200_000)) {
    throw new BetPawaIntegrationError(`betPawa does not currently list ${input.homeTeam} vs ${input.awayTeam}.`, 422, { fixtureId: input.fixtureId });
  }
  const eventId = str(match.event.id);
  const payload = await pawaRequest(fetcher, `/api/sportsbook/v4/events/${encodeURIComponent(eventId)}`, { method: "GET" }, "betPawa's market service is temporarily unavailable.");
  const event = isRecord(payload) && isRecord(payload.event) ? payload.event : isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(event)) throw new BetPawaIntegrationError("betPawa did not return the selected fixture.", 502, { eventId });
  cache.set(key, { until: Date.now() + 300_000, event }); return event;
}

type Rule = { market: string; outcome: string; line?: number | null };
function rule(input: SportyBetSelectionInput): Rule | null {
  const k = input.marketKey;
  const fixed: Record<string, [string, string]> = {
    MATCH_HOME: ["3743", "1"], MATCH_DRAW: ["3743", "X"], MATCH_AWAY: ["3743", "2"],
    ONE_UP_HOME: ["28000810", "1"], ONE_UP_AWAY: ["28000810", "2"], TWO_UP_HOME: ["28000850", "1"], TWO_UP_AWAY: ["28000850", "2"],
    DC_1X: ["4693", "1X"], DC_12: ["4693", "12"], DC_X2: ["4693", "X2"], DNB_HOME: ["4703", "1"], DNB_AWAY: ["4703", "2"],
    BTTS_YES: ["3795", "Yes"], BTTS_NO: ["3795", "No"], ODD_GOALS: ["4833", "Odd"], EVEN_GOALS: ["4833", "Even"],
    HOME_CLEAN: ["3816", "Yes"], AWAY_CLEAN: ["3807", "Yes"], HOME_WIN_NIL: ["5051", "Yes"], AWAY_WIN_NIL: ["5042", "Yes"],
    HT_HOME: ["3668", "1"], HT_DRAW: ["3668", "X"], HT_AWAY: ["3668", "2"],
  };
  if (fixed[k]) return { market: fixed[k][0], outcome: fixed[k][1] };
  if (/^OVER_/.test(k)) return { market: "5000", outcome: "Over", line: input.line };
  if (/^UNDER_/.test(k)) return { market: "5000", outcome: "Under", line: input.line };
  if (/^HOME_OVER_/.test(k)) return { market: "5006", outcome: "Over", line: input.line };
  if (/^HOME_UNDER_/.test(k)) return { market: "5006", outcome: "Under", line: input.line };
  if (/^AWAY_OVER_/.test(k)) return { market: "5003", outcome: "Over", line: input.line };
  if (/^AWAY_UNDER_/.test(k)) return { market: "5003", outcome: "Under", line: input.line };
  if (k === "HOME_AND_O15") return { market: "1096755", outcome: "1 - Over", line: 1.5 };
  if (k === "AWAY_AND_O15") return { market: "1096755", outcome: "2 - Over", line: 1.5 };
  if (/^HT_OVER_/.test(k)) return { market: "4958", outcome: "Over", line: input.line };
  if (/^CS_/.test(k)) return { market: "28000869", outcome: input.selection };
  return null;
}

function resolve(event: RecordValue, input: SportyBetSelectionInput): SportyBetResolvedSelection {
  const wanted = rule(input);
  if (!wanted) throw new BetPawaIntegrationError(`The ${input.marketName} market is not supported for automatic betPawa codes yet.`, 422, { marketKey: input.marketKey });
  const markets = Array.isArray(event.markets) ? event.markets.filter(isRecord) : [];
  const market = markets.find((item) => isRecord(item.marketType) && str(item.marketType.id) === wanted.market);
  if (!market) throw new BetPawaIntegrationError(`The ${input.marketName} market is not currently available on betPawa for ${input.homeTeam} vs ${input.awayTeam}.`, 422);
  const rows = Array.isArray(market.row) ? market.row.filter(isRecord) : [];
  const row = rows.find((item) => {
    if (wanted.line == null) return true;
    const spec = isRecord(item.specifier) ? Number(item.specifier.total ?? item.specifier.handicap) : NaN;
    return Number.isFinite(spec) && Math.abs(spec - wanted.line) < .001;
  });
  const prices = row && Array.isArray(row.prices) ? row.prices.filter(isRecord) : [];
  const price = prices.find((item) => norm(str(item.name)) === norm(wanted.outcome));
  if (!price) throw new BetPawaIntegrationError(`The ${input.selection} price is not currently available on betPawa for ${input.homeTeam} vs ${input.awayTeam}.`, 422);
  const pair = teams(event), odds = Number(price.odds), info = isRecord(market.marketType) ? market.marketType : {};
  return { fixtureId: input.fixtureId, eventId: str(event.id), marketId: wanted.market, outcomeId: str(price.id), specifier: wanted.line == null ? null : `total=${wanted.line}`,
    odds: Number.isFinite(odds) ? odds : null, homeTeam: pair.home || input.homeTeam, awayTeam: pair.away || input.awayTeam,
    market: str(info.displayName || info.name) || input.marketName, outcome: str(price.name) || input.selection };
}

async function mapLimit<T, R>(items: T[], mapper: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; output[index] = await mapper(items[index]!); } }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker)); return output;
}

export async function createBetPawaCode(selections: SportyBetSelectionInput[], fetcher: FetchLike = fetch, allowPartial = false): Promise<SportyBetCodeResult> {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 50) throw new BetPawaIntegrationError("Choose between 1 and 50 selections.", 400);
  const attempts = await mapLimit(selections, async (input) => {
    try { return { input, resolved: resolve(await findEvent(fetcher, input), input), error: null }; }
    catch (error) { if (!allowPartial) throw error; return { input, resolved: null, error: error instanceof Error ? error.message : "betPawa could not match this selection." }; }
  });
  const resolved: SportyBetResolvedSelection[] = [];
  const unmatched = attempts.flatMap((attempt) => attempt.error ? [{ fixtureId: attempt.input.fixtureId, homeTeam: attempt.input.homeTeam, awayTeam: attempt.input.awayTeam, reason: attempt.error }] : []);
  const events = new Set<string>();
  for (const attempt of attempts) {
    if (!attempt.resolved) continue;
    if (events.has(attempt.resolved.eventId)) {
      if (!allowPartial) throw new BetPawaIntegrationError("Choose only one prediction from each betPawa match.", 422);
      unmatched.push({ fixtureId: attempt.input.fixtureId, homeTeam: attempt.input.homeTeam, awayTeam: attempt.input.awayTeam, reason: "Another selected prediction already uses this betPawa match." }); continue;
    }
    events.add(attempt.resolved.eventId); resolved.push(attempt.resolved);
  }
  if (!resolved.length) throw new BetPawaIntegrationError(unmatched[0]?.reason || "None of these selections are currently available on betPawa.", 422, { unmatched });
  const created = await pawaRequest(fetcher, "/api/sportsbook/v3/booking-number", { method: "POST", body: JSON.stringify({ selections: { selections: resolved.map((item) => ({ type: "SINGLE", selections: [Number(item.outcomeId)] })) } }) }, "betPawa's booking-code service is temporarily unavailable.");
  const code = isRecord(created) ? str(created.code) : "";
  if (!/^[A-Z0-9]{4,12}$/i.test(code)) throw new BetPawaIntegrationError("betPawa rejected one or more selections.", 422, created);
  const checked = await pawaRequest(fetcher, `/api/sportsbook/v3/booking-number/${encodeURIComponent(code)}`, { method: "GET" }, "betPawa created a code but did not confirm it. Please try again.");
  const confirmed = isRecord(checked) && Array.isArray(checked.items) ? checked.items.length : 0;
  if (confirmed !== resolved.length) throw new BetPawaIntegrationError("betPawa did not confirm every selection in the generated code.", 502, { code, expected: resolved.length, confirmed });
  return { code, deepLink: ORIGIN, resolved, partial: unmatched.length > 0, unmatched };
}
