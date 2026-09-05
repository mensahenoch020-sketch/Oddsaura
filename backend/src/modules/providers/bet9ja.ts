import { verifyCreatedCode, compareSelectionIds } from "./verification.js";
import type { SportyBetCodeResult, SportyBetResolvedSelection, SportyBetSelectionInput } from "./sportybet.js";
import { teamSearchTerms, teamSimilarity } from "./team-matching.js";

type Json = Record<string, unknown>;
type FetchLike = typeof fetch;
const SEARCH_URL = "https://web.bet9ja.com/Controls/ControlsWS.asmx";
const CREATE_URL = "https://apigw.bet9ja.com/sportsbook/placebet/BookABetV2";
const VERIFY_URL = "https://sports.bet9ja.com/desktop/feapi/CouponAjax/GetBookABetCouponV2";
const SITE_URL = "https://sports.bet9ja.com/";
const LOAD_URL = "https://sports.bet9ja.com/mobile";
const cache = new Map<string, { until: number; event: Json }>();
let sessionCookie = "";

export class Bet9jaIntegrationError extends Error {
  constructor(message: string, readonly status = 422, readonly details?: unknown) {
    super(message); this.name = "Bet9jaIntegrationError";
  }
}

const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const norm = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\b(?:utd|united)\b/g, " united ")
  .replace(/\b(fc|cf|sc|afc|club|football|de|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

function teamScore(left: string, right: string) {
  return teamSimilarity(left, right);
}

function parsePayload(text: string): unknown {
  let value: unknown = JSON.parse(text.replace(/^\uFEFF/, "").replace(/^\)\]\}',?\s*/, "").trim());
  if (typeof value === "string" && /^[\[{]/.test(value.trim())) value = JSON.parse(value);
  return value;
}

async function bootstrapSession(fetcher: FetchLike) {
  if (sessionCookie) return;
  try {
    const response = await fetcher("https://web.bet9ja.com/Sport/Odds", { method: "GET", headers: { accept: "text/html", "user-agent": "Mozilla/5.0 OddsAura/1.0" }, signal: AbortSignal.timeout(15_000) });
    const raw = response.headers.get("set-cookie") || "";
    sessionCookie = raw.split(/,(?=[^;,]+=)/).map((part) => part.split(";", 1)[0]?.trim()).filter(Boolean).join("; ");
    await response.text();
  } catch { /* The JSON endpoint may still work without a bootstrap cookie. */ }
}

async function request(fetcher: FetchLike, url: string, init: RequestInit, failure: string, retried = false): Promise<unknown> {
  let response: Response;
  const searchRequest = url.startsWith(SEARCH_URL);
  try {
    response = await fetcher(url, { ...init, headers: { accept: "application/json, text/plain, */*", origin: searchRequest ? "https://web.bet9ja.com" : SITE_URL.slice(0, -1), referer: searchRequest ? "https://web.bet9ja.com/Sport/Odds" : SITE_URL, "x-requested-with": "XMLHttpRequest", "user-agent": "Mozilla/5.0 OddsAura/1.0", ...(searchRequest && sessionCookie ? { cookie: sessionCookie } : {}), ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new Bet9jaIntegrationError(failure, 502, { cause: error instanceof Error ? error.message : String(error) });
  }
  const text = await response.text();
  let payload: unknown = null;
  try { payload = parsePayload(text); }
  catch {
    if (!retried && url.startsWith(SEARCH_URL)) {
      await bootstrapSession(fetcher);
      return request(fetcher, url, init, failure, true);
    }
    throw new Bet9jaIntegrationError("Bet9ja's website did not accept the booking request. Please try again shortly.", 502, { status: response.status, contentType: response.headers.get("content-type"), preview: text.slice(0, 120) });
  }
  if (!response.ok) throw new Bet9jaIntegrationError(failure, 502, payload);
  return payload;
}

function unwrap(payload: unknown) {
  const wrapped = isRecord(payload) ? payload.D ?? payload.d : null;
  if (isRecord(wrapped)) return wrapped;
  if (typeof wrapped === "string") {
    try { return parsePayload(wrapped); } catch { return wrapped; }
  }
  return payload;
}

function splitTeams(name: string) {
  const parts = name.split(/\s+-\s+|\s+(?:vs\.?|v)\s+/i);
  return { home: parts[0]?.trim() ?? "", away: parts[1]?.trim() ?? "" };
}

function dotNetTime(value: unknown) {
  const match = str(value).match(/Date\((\d+)/);
  return match ? Number(match[1]) : Date.parse(str(value));
}

async function findEvent(fetcher: FetchLike, input: SportyBetSelectionInput) {
  const key = `${norm(input.homeTeam)}|${norm(input.awayTeam)}|${input.kickoff.slice(0, 10)}`;
  const saved = cache.get(key); if (saved && saved.until > Date.now()) return saved.event;
  const terms = teamSearchTerms(input.homeTeam, input.awayTeam).slice(0, 8);
  const rows: Json[] = [];
  for (const term of terms) {
    const payload = unwrap(await request(fetcher, `${SEARCH_URL}/GetSearchBoxData`, {
      method: "POST", headers: { "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ textToSearch: term, showMatches: true, showCompetitions: false, pageSize: 100, startRowIndex: 0, getTotals: true }),
    }, "Bet9ja's fixture search is temporarily unavailable."));
    if (isRecord(payload) && Array.isArray(payload.SearchResults)) rows.push(...payload.SearchResults.filter(isRecord));
  }
  const wantedTime = Date.parse(input.kickoff);
  const ranked = [...new Map(rows.map((row) => [str(row.ID), row])).values()].filter((row) => str(row.Type) === "SE" && !str(row.Area).startsWith("("))
    .map((row) => {
      const pair = splitTeams(str(row.Area));
      const names = Math.max((teamScore(input.homeTeam, pair.home) + teamScore(input.awayTeam, pair.away)) / 2,
        (teamScore(input.homeTeam, pair.away) + teamScore(input.awayTeam, pair.home)) / 2 * .85);
      const time = dotNetTime(row.DataInizio), delta = wantedTime && time ? Math.abs(wantedTime - time) : null;
      return { row, names, delta, total: names * .84 + (delta == null ? .5 : Math.max(0, 1 - delta / 86_400_000)) * .16 };
    }).sort((a, b) => b.total - a.total);
  const match = ranked[0];
  if (!match || match.names < .7 || (match.delta != null && match.delta > 259_200_000)) {
    throw new Bet9jaIntegrationError(`Bet9ja does not currently list ${input.homeTeam} vs ${input.awayTeam}.`, 422, { fixtureId: input.fixtureId });
  }
  const detail = unwrap(await request(fetcher, `${SEARCH_URL}/GetSubEventDetails`, {
    method: "POST", headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ IDSottoEvento: Number(match.row.ID), IsGoalscorer: false }),
  }, "Bet9ja's market service is temporarily unavailable."));
  if (!isRecord(detail)) throw new Bet9jaIntegrationError("Bet9ja did not return the selected fixture.", 502);
  cache.set(key, { until: Date.now() + 300_000, event: detail }); return detail;
}

type Rule = { className: string; sign: string; market: string; line?: number | null };
function rule(input: SportyBetSelectionInput): Rule | null {
  const fixed: Record<string, Rule> = {
    MATCH_HOME: { className: "1X2", sign: "1", market: "S_1X2" }, MATCH_DRAW: { className: "1X2", sign: "X", market: "S_1X2" }, MATCH_AWAY: { className: "1X2", sign: "2", market: "S_1X2" },
    ONE_UP_HOME: { className: "1X2 1UP", sign: "1", market: "S_1X21" }, ONE_UP_AWAY: { className: "1X2 1UP", sign: "2", market: "S_1X21" },
    TWO_UP_HOME: { className: "1X2 2UP", sign: "1", market: "S_1X22" }, TWO_UP_AWAY: { className: "1X2 2UP", sign: "2", market: "S_1X22" },
    DC_1X: { className: "Double Chance", sign: "1X", market: "S_DC" }, DC_12: { className: "Double Chance", sign: "12", market: "S_DC" }, DC_X2: { className: "Double Chance", sign: "X2", market: "S_DC" },
    DNB_HOME: { className: "DNB", sign: "1 DNB", market: "S_DNB" }, DNB_AWAY: { className: "DNB", sign: "2 DNB", market: "S_DNB" },
    BTTS_YES: { className: "GG/NG", sign: "GG", market: "S_GGNG" }, BTTS_NO: { className: "GG/NG", sign: "NG", market: "S_GGNG" },
    ODD_GOALS: { className: "Odd/Even", sign: "Odd", market: "S_OE" }, EVEN_GOALS: { className: "Odd/Even", sign: "Even", market: "S_OE" },
    HT_HOME: { className: "Half Time", sign: "1", market: "S_1X21T" }, HT_DRAW: { className: "Half Time", sign: "X", market: "S_1X21T" }, HT_AWAY: { className: "Half Time", sign: "2", market: "S_1X21T" },
  };
  if (fixed[input.marketKey]) return fixed[input.marketKey]!;
  if (/^OVER_/.test(input.marketKey)) return { className: `O/U ${input.line}`, sign: "Over", market: "S_OU", line: input.line };
  if (/^UNDER_/.test(input.marketKey)) return { className: `O/U ${input.line}`, sign: "Under", market: "S_OU", line: input.line };
  return null;
}

function resolve(event: Json, input: SportyBetSelectionInput): SportyBetResolvedSelection & { oddsKey: string; eventCode: string; startDate: string; league: string; sport: string } {
  const wanted = rule(input);
  if (!wanted) throw new Bet9jaIntegrationError(`The ${input.marketName} market is not supported for automatic Bet9ja codes yet.`, 422, { marketKey: input.marketKey });
  const classes = Array.isArray(event.ClassiQuotaList) ? event.ClassiQuotaList.filter(isRecord) : [];
  const market = classes.find((item) => norm(str(item.ClasseQuota)).replace(/\s+/g, " ") === norm(wanted.className).replace(/\s+/g, " ") ||
    (wanted.line != null && norm(str(item.ClasseQuota)).includes(`o u ${wanted.line}`) && Number(item.ValoreHND) === wanted.line));
  if (!market) throw new Bet9jaIntegrationError(`The ${input.marketName} market is not currently available on Bet9ja for ${input.homeTeam} vs ${input.awayTeam}.`, 422);
  const quotes = Array.isArray(market.QuoteList) ? market.QuoteList.filter(isRecord) : [];
  const quote = quotes.find((item) => norm(str(item.TipoQuotaBreve)) === norm(wanted.sign) && (wanted.line == null || Math.abs(Number(item.hnd) - wanted.line) < .001));
  if (!quote || Number(quote.Giocabilita) !== 1) throw new Bet9jaIntegrationError(`The ${input.selection} price is not currently available on Bet9ja for ${input.homeTeam} vs ${input.awayTeam}.`, 422);
  const eventId = str(event.IDSottoEvento), eventCode = str(event.CodPubblicazione), pair = splitTeams(str(event.SottoEvento));
  const sign = str(quote.TipoQuotaBreve).replace(/\s+DNB$/i, "").trim();
  const suffix = wanted.line == null ? `_${sign}` : `@${wanted.line}_${sign.slice(0, 1).toUpperCase()}`;
  const oddsKey = `${eventId}$${wanted.market}${suffix}`;
  const odds = Number(quote.QuotaValore);
  return { fixtureId: input.fixtureId, eventId, marketId: str(market.IDClasseQuota), outcomeId: oddsKey, specifier: wanted.line == null ? null : `total=${wanted.line}`,
    odds: Number.isFinite(odds) ? odds : null, homeTeam: pair.home || input.homeTeam, awayTeam: pair.away || input.awayTeam,
    market: str(market.ClasseQuota) || input.marketName, outcome: str(quote.TipoQuotaBreve) || input.selection,
    oddsKey, eventCode, startDate: new Date(dotNetTime(event.DataInizio)).toISOString().replace("T", " ").slice(0, 19).replace(/-/g, "/"), league: str(event.Evento), sport: str(event.Sport) || "Soccer" };
}

async function mapLimit<T, R>(items: T[], mapper: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length); let cursor = 0;
  async function worker() { while (cursor < items.length) { const index = cursor++; output[index] = await mapper(items[index]!); } }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker)); return output;
}

export async function createBet9jaCode(selections: SportyBetSelectionInput[], fetcher: FetchLike = fetch, allowPartial = false): Promise<SportyBetCodeResult> {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 50) throw new Bet9jaIntegrationError("Choose between 1 and 50 selections.", 400);
  const attempts = await mapLimit(selections, async (input) => {
    try { return { input, resolved: resolve(await findEvent(fetcher, input), input), error: null }; }
    catch (error) { if (!allowPartial) throw error; return { input, resolved: null, error: error instanceof Error ? error.message : "Bet9ja could not match this selection." }; }
  });
  const resolved = attempts.flatMap((attempt) => attempt.resolved ? [attempt.resolved] : []);
  const unmatched = attempts.flatMap((attempt) => attempt.error ? [{ fixtureId: attempt.input.fixtureId, homeTeam: attempt.input.homeTeam, awayTeam: attempt.input.awayTeam, reason: attempt.error }] : []);
  if (!resolved.length) throw new Bet9jaIntegrationError(unmatched[0]?.reason || "None of these selections are currently available on Bet9ja.", 422, { unmatched });
  const events = new Set<string>();
  for (const selection of resolved) if (events.has(selection.eventId)) throw new Bet9jaIntegrationError("Choose only one prediction from each Bet9ja match.", 422); else events.add(selection.eventId);
  const odds = Object.fromEntries(resolved.map((item) => [item.oddsKey, item.odds]));
  const product = resolved.reduce((value, item) => value * (item.odds ?? 1), 1);
  const bet = { BSTYPE: resolved.length === 1 ? 3 : 2, TAB: resolved.length === 1 ? 3 : 2, NUMLINES: resolved.length, COMB: 1, TYPE: resolved.length,
    STAKE: 0, POTWINMIN: 0, POTWINMAX: 0, BONUSMIN: 0, BONUSMAX: 0, ODDMIN: product, ODDMAX: product, ODDS: odds, FIXED: {} };
  const evs = Object.fromEntries(resolved.map((item) => [item.oddsKey, { id: item.oddsKey, eventId: Number(item.eventId), eventCode: item.eventCode,
    eventName: `${item.homeTeam} v ${item.awayTeam}`, market: item.market, sid: item.marketId, sign: item.outcome, GN: item.league, leagueName: item.league,
    SG: "", startdate: item.startDate, oddValue: item.odds, hnd: item.specifier ? item.specifier.split("=")[1] : "", sportName: item.sport }]));
  const form = new URLSearchParams({ BETSLIP: JSON.stringify({ BETS: [bet], EVS: evs, IMPERSONIZE: 0 }), IS_PASSBET: "0", LIVE: "0" });
  const created = await request(fetcher, CREATE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-source": "desktop" }, body: form.toString() }, "Bet9ja's booking-code service is temporarily unavailable.");
  const first = isRecord(created) && Array.isArray(created.data) && isRecord(created.data[0]) ? created.data[0] : null;
  const code = first ? str(first.RIS) : "";
  if (!isRecord(created) || Number(created.status) !== 1 || !/^[A-Z0-9]{5,12}$/i.test(code)) {
    const message = isRecord(created) && isRecord(created.error) ? str(created.error.message) : "";
    throw new Bet9jaIntegrationError(message || "Bet9ja rejected one or more selections.", 422, created);
  }
  const verificationState = await verifyCreatedCode(async () => {
  const checked = unwrap(await request(fetcher, `${VERIFY_URL}?couponCode=${encodeURIComponent(code)}`, { method: "GET" }, "Bet9ja created a code but did not confirm it. Please try again."));
  if (!isRecord(checked) || !isRecord(checked.O)) return null;
  return compareSelectionIds(resolved.map(item => item.oddsKey), Object.keys(checked.O));
  });
  return { ...verificationState, code, deepLink: `${LOAD_URL}?bookABetCode=${encodeURIComponent(code)}`, resolved, partial: unmatched.length > 0, unmatched };
}
