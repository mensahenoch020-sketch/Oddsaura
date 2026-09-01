import type { SportyBetCodeResult, SportyBetResolvedSelection, SportyBetSelectionInput } from "./sportybet.js";

type Json = Record<string, unknown>;
type FetchLike = typeof fetch;
const ORIGIN = "https://m.betking.com";
const FEEDS = ["/en-ng/sports/main-bets/popular", "/en-ng/sports/main-bets/today", "/en-ng/sports/main-bets/competition"];
const cache = new Map<string, { until: number; events: Json[] }>();

export class BetKingIntegrationError extends Error {
  constructor(message: string, readonly status = 422, readonly details?: unknown) {
    super(message); this.name = "BetKingIntegrationError";
  }
}

const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const norm = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\b(fc|cf|sc|afc|club|football|de|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

function score(left: string, right: string) {
  const a = new Set(norm(left).split(" ").filter(Boolean)), b = new Set(norm(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const x = [...a].join(" "), y = [...b].join(" ");
  return Math.max([...a].filter((word) => b.has(word)).length / new Set([...a, ...b]).size, x === y ? 1 : x.includes(y) || y.includes(x) ? .92 : 0);
}

async function response(fetcher: FetchLike, path: string, init: RequestInit, failure: string, allowErrorPage = false) {
  let res: Response;
  try { res = await fetcher(`${ORIGIN}${path}`, { ...init, headers: { accept: "application/json,text/html", ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) }); }
  catch (error) { throw new BetKingIntegrationError(failure, 502, { cause: error instanceof Error ? error.message : String(error) }); }
  const text = await res.text();
  if (!res.ok && !allowErrorPage) throw new BetKingIntegrationError(failure, 502, { status: res.status, body: text.slice(0, 500) });
  return text;
}

async function json(fetcher: FetchLike, path: string, init: RequestInit, failure: string) {
  const text = await response(fetcher, path, init, failure);
  try { return JSON.parse(text) as unknown; }
  catch { throw new BetKingIntegrationError("BetKing returned an unreadable response.", 502); }
}

async function events(fetcher: FetchLike) {
  const saved = cache.get("events"); if (saved && saved.until > Date.now()) return saved.events;
  const payloads = await Promise.all(FEEDS.map((path) => json(fetcher, path, { method: "GET" }, "BetKing's event service is temporarily unavailable.")));
  const rows = payloads.flatMap((payload) => isRecord(payload) && Array.isArray(payload.events) ? payload.events.filter(isRecord) : []);
  const unique = [...new Map(rows.map((event) => [str(event.id), event])).values()];
  cache.set("events", { until: Date.now() + 120_000, events: unique }); return unique;
}

function teams(event: Json) {
  const listed = Array.isArray(event.teams) ? event.teams.filter(isRecord).sort((a, b) => Number(a.itemOrder) - Number(b.itemOrder)) : [];
  return { home: str(event.homeTeam) || str(listed[0]?.name), away: str(event.awayTeam) || str(listed[1]?.name) };
}

function findEvent(rows: Json[], input: SportyBetSelectionInput) {
  const kickoff = Date.parse(input.kickoff);
  const ranked = rows.map((event) => {
    const pair = teams(event);
    const names = Math.max((score(input.homeTeam, pair.home) + score(input.awayTeam, pair.away)) / 2,
      (score(input.homeTeam, pair.away) + score(input.awayTeam, pair.home)) / 2 * .85);
    const start = Date.parse(str(event.date)), delta = kickoff && start ? Math.abs(kickoff - start) : null;
    return { event, names, delta, total: names * .86 + (delta == null ? .5 : Math.max(0, 1 - delta / 86_400_000)) * .14 };
  }).sort((a, b) => b.total - a.total)[0];
  if (!ranked || ranked.names < .7 || (ranked.delta != null && ranked.delta > 259_200_000)) throw new BetKingIntegrationError(`BetKing does not currently list ${input.homeTeam} vs ${input.awayTeam} in its public booking feed.`, 422, { fixtureId: input.fixtureId });
  return ranked.event;
}

type Rule = { typeId: number; outcome: string; line?: number | null };
function rule(input: SportyBetSelectionInput): Rule | null {
  const fixed: Record<string, Rule> = {
    MATCH_HOME: { typeId: 110, outcome: "1" }, MATCH_DRAW: { typeId: 110, outcome: "X" }, MATCH_AWAY: { typeId: 110, outcome: "2" },
    ONE_UP_HOME: { typeId: 10974, outcome: "1" }, ONE_UP_AWAY: { typeId: 10974, outcome: "2" },
    TWO_UP_HOME: { typeId: 10975, outcome: "1" }, TWO_UP_AWAY: { typeId: 10975, outcome: "2" },
    DC_1X: { typeId: 146, outcome: "1X" }, DC_12: { typeId: 146, outcome: "12" }, DC_X2: { typeId: 146, outcome: "X2" },
    BTTS_YES: { typeId: 302, outcome: "Yes" }, BTTS_NO: { typeId: 302, outcome: "No" },
  };
  if (fixed[input.marketKey]) return fixed[input.marketKey]!;
  if (/^OVER_/.test(input.marketKey)) return { typeId: 160, outcome: "Over", line: input.line };
  if (/^UNDER_/.test(input.marketKey)) return { typeId: 160, outcome: "Under", line: input.line };
  if (/^HOME_(?:OVER|UNDER)_/.test(input.marketKey)) return { typeId: 10283, outcome: input.marketKey.includes("OVER") ? "Over" : "Under", line: input.line };
  if (/^AWAY_(?:OVER|UNDER)_/.test(input.marketKey)) return { typeId: 10284, outcome: input.marketKey.includes("OVER") ? "Over" : "Under", line: input.line };
  return null;
}

function resolve(event: Json, input: SportyBetSelectionInput): SportyBetResolvedSelection {
  const wanted = rule(input);
  if (!wanted) throw new BetKingIntegrationError(`The ${input.marketName} market is not supported for automatic BetKing codes yet.`, 422, { marketKey: input.marketKey });
  const markets = Array.isArray(event.markets) ? event.markets.filter(isRecord) : [];
  const market = markets.find((item) => Number(item.typeId) === wanted.typeId && (wanted.line == null || Math.abs(Number(item.specialValue) - wanted.line) < .001));
  if (!market) throw new BetKingIntegrationError(`The ${input.marketName} market is not currently available on BetKing for ${input.homeTeam} vs ${input.awayTeam}.`, 422);
  const prices = Array.isArray(market.selections) ? market.selections.filter(isRecord) : [];
  const price = prices.find((item) => norm(str(item.name)) === norm(wanted.outcome) && str(item.status) === "VALID" && isRecord(item.odd));
  if (!price) throw new BetKingIntegrationError(`The ${input.selection} price is not currently available on BetKing for ${input.homeTeam} vs ${input.awayTeam}.`, 422);
  const pair = teams(event), odd = isRecord(price.odd) ? Number(price.odd.value) : NaN;
  return { fixtureId: input.fixtureId, eventId: str(event.id), marketId: str(market.id), outcomeId: str(price.id), specifier: wanted.line == null ? null : `total=${wanted.line}`,
    odds: Number.isFinite(odd) ? odd : null, homeTeam: pair.home || input.homeTeam, awayTeam: pair.away || input.awayTeam,
    market: str(market.name) || input.marketName, outcome: str(price.name) || input.selection };
}

function form(data: unknown) { return new URLSearchParams({ data: JSON.stringify(data) }).toString(); }

export async function createBetKingCode(selections: SportyBetSelectionInput[], fetcher: FetchLike = fetch, allowPartial = false): Promise<SportyBetCodeResult> {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 50) throw new BetKingIntegrationError("Choose between 1 and 50 selections.", 400);
  const rows = await events(fetcher);
  const attempts = selections.map((input) => { try { return { input, resolved: resolve(findEvent(rows, input), input), error: null }; } catch (error) { if (!allowPartial) throw error; return { input, resolved: null, error: error instanceof Error ? error.message : "BetKing could not match this selection." }; } });
  const resolved: SportyBetResolvedSelection[] = [], used = new Set<string>();
  const unmatched = attempts.flatMap((attempt) => attempt.error ? [{ fixtureId: attempt.input.fixtureId, homeTeam: attempt.input.homeTeam, awayTeam: attempt.input.awayTeam, reason: attempt.error }] : []);
  for (const attempt of attempts) {
    if (!attempt.resolved) continue;
    if (used.has(attempt.resolved.eventId)) { if (!allowPartial) throw new BetKingIntegrationError("Choose only one prediction from each BetKing match.", 422); unmatched.push({ fixtureId: attempt.input.fixtureId, homeTeam: attempt.input.homeTeam, awayTeam: attempt.input.awayTeam, reason: "Another selected prediction already uses this BetKing match." }); continue; }
    used.add(attempt.resolved.eventId); resolved.push(attempt.resolved);
  }
  if (!resolved.length) throw new BetKingIntegrationError(unmatched[0]?.reason || "None of these selections are currently available on BetKing.", 422, { unmatched });
  const coupon = await json(fetcher, "/en-ng/sports/betslip/action/createcoupon", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ selections: resolved.map((item) => ({ selectionId: Number(item.outcomeId) })) }) }, "BetKing's coupon service is temporarily unavailable.");
  if (!isRecord(coupon) || !Array.isArray(coupon.odds) || coupon.odds.length !== resolved.length) throw new BetKingIntegrationError("BetKing rejected one or more selections.", 422, coupon);
  const booked = await json(fetcher, "/en-ng/sports/action/bookbet", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ betCoupon: coupon, requestTransactionId: crypto.randomUUID() }) }, "BetKing's booking-code service is temporarily unavailable.");
  const code = isRecord(booked) ? str(booked.bookedCouponCode) : "";
  if (!isRecord(booked) || Number(booked.responseStatus) !== 1 || !/^[A-Z0-9]{5,12}$/i.test(code)) throw new BetKingIntegrationError("BetKing did not create a valid booking code.", 422, booked);
  const verifiedHtml = await response(fetcher, "/en-ng/widgets/bookBet", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ requestType: "load_booking_code", bookingCode: code }) }, "BetKing created a code but did not confirm it. Please try again.", true);
  const match = verifiedHtml.match(/window\.__remixContext\s*=\s*([\s\S]*?);<\/script>/);
  let confirmed = 0;
  try { const context = match ? JSON.parse(match[1]!) as Json : null; const state = context && isRecord(context.state) ? context.state : null; const action = state && isRecord(state.actionData) ? state.actionData : null; const route = action && isRecord(action["routes/($locale).widgets.bookBet"]) ? action["routes/($locale).widgets.bookBet"] : null; const checked = route && isRecord(route.bookedCoupon) ? route.bookedCoupon : null; confirmed = checked && Array.isArray(checked.odds) ? checked.odds.length : 0; }
  catch { confirmed = 0; }
  if (confirmed !== resolved.length) throw new BetKingIntegrationError("BetKing did not confirm every selection in the generated code.", 502, { code, expected: resolved.length, confirmed });
  return { code, deepLink: `${ORIGIN}/en-ng/sports/book-bet/${encodeURIComponent(code)}`, resolved, partial: unmatched.length > 0, unmatched };
}
