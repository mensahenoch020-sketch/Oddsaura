import type { SportyBetSelectionInput } from "./sportybet.js";

type Json = Record<string, unknown>;
type FetchLike = typeof fetch;
export type DecodableBookmaker = "sportybet" | "betpawa" | "bet9ja" | "betking" | "betway";

const SPORTY_ORIGIN = "https://www.sportybet.com";
const PAWA_ORIGIN = "https://www.betpawa.ng";
const BET9JA_VERIFY = "https://sports.bet9ja.com/desktop/feapi/CouponAjax/GetBookABetCouponV2";
const BETKING_ORIGIN = "https://m.betking.com";
const BETWAY_FIND = "https://www.betway.com.ng/appsynapse/bet-api-sr02/v2/Betting/FindBookABet";

export class BookmakerDecodeError extends Error {
  constructor(message: string, readonly status = 422, readonly details?: unknown) {
    super(message); this.name = "BookmakerDecodeError";
  }
}

const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const norm = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
const first = (rows: Json[], keys: string[]) => { for (const row of rows) for (const key of keys) { const value = str(row[key]); if (value) return value; } return ""; };

function unwrap(value: unknown): unknown {
  let current = value;
  for (let index = 0; index < 4 && isRecord(current); index += 1) {
    const wrapped = current.D ?? current.d;
    if (wrapped == null) break;
    if (typeof wrapped === "string") {
      try { current = JSON.parse(wrapped); continue; } catch { return wrapped; }
    }
    current = wrapped;
  }
  return current;
}

function splitTeams(value: string) {
  const parts = value.split(/\s+-\s+|\s+(?:vs\.?|v)\s+/i);
  return parts.length > 1 ? { home: parts[0]!.trim(), away: parts[1]!.trim() } : { home: "", away: "" };
}

function lineFrom(...values: string[]) {
  for (const value of values) {
    const match = value.match(/(?:total|hcp)?\s*[=@:]?\s*(-?\d+(?:[.,]\d+)?)/i);
    if (match) return Number(match[1]!.replace(",", "."));
  }
  return null;
}

function lineKey(prefix: string, line: number) {
  return `${prefix}_${String(line).replace(".", "_")}`;
}

function inferMarket(marketName: string, outcomeName: string, home: string, away: string, specifier: string) {
  const market = norm(marketName), outcome = norm(outcomeName), combined = `${market} ${outcome}`;
  const line = lineFrom(specifier, outcomeName, marketName);
  const homeNorm = norm(home), awayNorm = norm(away);
  const homeOutcome = outcome === "1" || outcome === "home" || homeNorm === outcome || Boolean(homeNorm && outcome.includes(homeNorm));
  const awayOutcome = outcome === "2" || outcome === "away" || awayNorm === outcome || Boolean(awayNorm && outcome.includes(awayNorm));
  if (/2up|2 up/.test(market)) return homeOutcome ? { marketKey: "TWO_UP_HOME", marketName: "2UP", selection: home } : awayOutcome ? { marketKey: "TWO_UP_AWAY", marketName: "2UP", selection: away } : null;
  if (/1up|1 up/.test(market)) return homeOutcome ? { marketKey: "ONE_UP_HOME", marketName: "1UP", selection: home } : awayOutcome ? { marketKey: "ONE_UP_AWAY", marketName: "1UP", selection: away } : null;
  if (/double chance|\bdc\b/.test(market) || /^(1x|x2|12)$/.test(outcome.replace(/\s/g, ""))) {
    const compact = outcome.replace(/\s/g, "").toUpperCase();
    if (compact === "1X" || /home.*draw|draw.*home/.test(outcome)) return { marketKey: "DC_1X", marketName: "Double chance", selection: `${home} or draw` };
    if (compact === "X2" || /away.*draw|draw.*away/.test(outcome)) return { marketKey: "DC_X2", marketName: "Double chance", selection: `Draw or ${away}` };
    if (compact === "12" || /home.*away|away.*home/.test(outcome)) return { marketKey: "DC_12", marketName: "Double chance", selection: `${home} or ${away}` };
  }
  if (/draw no bet|\bdnb\b/.test(combined)) return homeOutcome ? { marketKey: "DNB_HOME", marketName: "Draw no bet", selection: home } : awayOutcome ? { marketKey: "DNB_AWAY", marketName: "Draw no bet", selection: away } : null;
  if (/both teams.*score|gg.?ng|\bbtts\b/.test(market)) {
    if (/yes|gg/.test(outcome)) return { marketKey: "BTTS_YES", marketName: "Both teams to score", selection: "Yes" };
    if (/no|ng/.test(outcome)) return { marketKey: "BTTS_NO", marketName: "Both teams to score", selection: "No" };
  }
  if (/odd.?even/.test(market)) {
    if (/odd/.test(outcome)) return { marketKey: "ODD_GOALS", marketName: "Odd or even goals", selection: "Odd" };
    if (/even/.test(outcome)) return { marketKey: "EVEN_GOALS", marketName: "Odd or even goals", selection: "Even" };
  }
  if (line != null && /over|under|total|o u/.test(combined)) {
    const side = /under|\bu\b/.test(outcome) ? "UNDER" : /over|\bo\b/.test(outcome) ? "OVER" : null;
    if (side) {
      const teamPrefix = /home team|team 1/.test(market) ? "HOME_" : /away team|team 2/.test(market) ? "AWAY_" : /half time|1st half/.test(market) ? "HT_" : "";
      return { marketKey: lineKey(`${teamPrefix}${side}`, line), marketName: marketName || "Total goals", selection: `${side === "OVER" ? "Over" : "Under"} ${line}`, line };
    }
  }
  if (/half time|1st half/.test(market) && /result|1x2|winner/.test(market)) {
    if (homeOutcome) return { marketKey: "HT_HOME", marketName: "Half-time result", selection: home };
    if (outcome === "x" || /draw/.test(outcome)) return { marketKey: "HT_DRAW", marketName: "Half-time result", selection: "Draw" };
    if (awayOutcome) return { marketKey: "HT_AWAY", marketName: "Half-time result", selection: away };
  }
  if (/1x2|match result|match winner|full time result|winner/.test(market)) {
    if (homeOutcome) return { marketKey: "MATCH_HOME", marketName: "Match result", selection: home };
    if (outcome === "x" || /draw/.test(outcome)) return { marketKey: "MATCH_DRAW", marketName: "Match result", selection: "Draw" };
    if (awayOutcome) return { marketKey: "MATCH_AWAY", marketName: "Match result", selection: away };
  }
  return null;
}

function inferSportyIds(row: Json, home: string, away: string) {
  const marketId = str(row.marketId ?? row.marketID ?? row.MID ?? row.sid);
  const outcomeId = str(row.outcomeId ?? row.outcomeID ?? row.OID);
  const specifier = str(row.specifier ?? row.specialValue ?? row.handicap ?? row.hnd ?? row.H);
  const line = lineFrom(specifier);
  if (marketId === "1") return outcomeId === "1" ? { marketKey: "MATCH_HOME", marketName: "Match result", selection: home } : outcomeId === "2" ? { marketKey: "MATCH_DRAW", marketName: "Match result", selection: "Draw" } : outcomeId === "3" ? { marketKey: "MATCH_AWAY", marketName: "Match result", selection: away } : null;
  if (marketId === "10") return outcomeId === "9" ? { marketKey: "DC_1X", marketName: "Double chance", selection: `${home} or draw` } : outcomeId === "10" ? { marketKey: "DC_12", marketName: "Double chance", selection: `${home} or ${away}` } : outcomeId === "11" ? { marketKey: "DC_X2", marketName: "Double chance", selection: `Draw or ${away}` } : null;
  if (marketId === "11") return outcomeId === "4" ? { marketKey: "DNB_HOME", marketName: "Draw no bet", selection: home } : outcomeId === "5" ? { marketKey: "DNB_AWAY", marketName: "Draw no bet", selection: away } : null;
  if (marketId === "60200") return outcomeId === "1" ? { marketKey: "ONE_UP_HOME", marketName: "1UP", selection: home } : outcomeId === "3" ? { marketKey: "ONE_UP_AWAY", marketName: "1UP", selection: away } : null;
  if (marketId === "60100") return outcomeId === "1" ? { marketKey: "TWO_UP_HOME", marketName: "2UP", selection: home } : outcomeId === "3" ? { marketKey: "TWO_UP_AWAY", marketName: "2UP", selection: away } : null;
  if (marketId === "18" && line != null) return outcomeId === "12" ? { marketKey: lineKey("OVER", line), marketName: "Total goals", selection: `Over ${line}`, line } : outcomeId === "13" ? { marketKey: lineKey("UNDER", line), marketName: "Total goals", selection: `Under ${line}`, line } : null;
  if (marketId === "19" && line != null) return outcomeId === "12" ? { marketKey: lineKey("HOME_OVER", line), marketName: "Home team total", selection: `Over ${line}`, line } : outcomeId === "13" ? { marketKey: lineKey("HOME_UNDER", line), marketName: "Home team total", selection: `Under ${line}`, line } : null;
  if (marketId === "20" && line != null) return outcomeId === "12" ? { marketKey: lineKey("AWAY_OVER", line), marketName: "Away team total", selection: `Over ${line}`, line } : outcomeId === "13" ? { marketKey: lineKey("AWAY_UNDER", line), marketName: "Away team total", selection: `Under ${line}`, line } : null;
  return null;
}

function toInput(row: Json, provider: DecodableBookmaker, index: number): SportyBetSelectionInput | null {
  const nested = [row, row.event, row.eventInfo, row.fixture, row.match, row.market, row.selection, row.selectionInfo, row.outcome].filter(isRecord);
  const eventName = first(nested, ["eventName", "matchName", "fixtureName", "name", "E_NAME", "N", "SE"]);
  const pair = splitTeams(eventName);
  const homeTeam = first(nested, ["homeTeamName", "homeName", "homeTeam", "team1Name", "competitor1Name", "T1"]) || pair.home;
  const awayTeam = first(nested, ["awayTeamName", "awayName", "awayTeam", "team2Name", "competitor2Name", "T2"]) || pair.away;
  const marketRows = [row.market, ...nested].filter(isRecord);
  const outcomeRows = [row.selection, row.selectionInfo, row.outcome, ...nested].filter(isRecord);
  const marketName = first(marketRows, ["marketName", "market", "marketLabel", "marketTypeName", "groupName", "M_NAME", "M", "displayName", "name"]);
  const outcomeName = first(outcomeRows, ["outcomeName", "selectionName", "selection", "outcome", "sign", "signName", "pickName", "SGN", "S", "displayName", "name"]);
  const specifier = first(nested, ["specifier", "specialValue", "handicap", "hnd", "H"]);
  const inferred = inferMarket(marketName, outcomeName, homeTeam, awayTeam, specifier) || (provider === "sportybet" ? inferSportyIds(row, homeTeam, awayTeam) : null);
  if (!homeTeam || !awayTeam || !inferred) return null;
  const rawKickoff = first(nested, ["startTime", "startDate", "startdate", "STARTDATEUTC", "STARTDATE", "kickoff", "scheduled", "eventDate"]);
  const numericTime = Number(rawKickoff);
  const timestamp = Number.isFinite(numericTime) && numericTime > 0 ? (numericTime > 10_000_000_000 ? numericTime : numericTime * 1000) : Date.parse(rawKickoff);
  const eventId = first(nested, ["eventId", "fixtureId", "matchId", "E_ID", "id", "E"]);
  const input: SportyBetSelectionInput = { fixtureId: `${provider}-${eventId || index + 1}`, homeTeam, awayTeam, kickoff: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(), ...inferred };
  if (provider === "sportybet") {
    input.providerEventId = eventId || null;
    input.providerMarketId = first(nested, ["marketId", "marketID", "MID", "sid"]) || null;
    input.providerOutcomeId = first(nested, ["outcomeId", "outcomeID", "OID"]) || null;
    input.providerSpecifier = specifier || null;
  }
  return input;
}

function selectionRows(provider: DecodableBookmaker, payload: unknown): Json[] {
  const unwrapped = unwrap(payload);
  if (!isRecord(unwrapped)) return [];
  const data = isRecord(unwrapped.data) ? unwrapped.data : unwrapped;
  if (provider === "sportybet") {
    const ticket = isRecord(data.ticket) ? data.ticket : data;
    if (Array.isArray(ticket.selections)) return ticket.selections.filter(isRecord);
    if (Array.isArray(data.outcomes)) return data.outcomes.filter(isRecord);
  }
  if (provider === "betpawa" && Array.isArray(data.items)) {
    return data.items.filter(isRecord).flatMap((item) => {
      const event = isRecord(item.eventInfo) ? item.eventInfo : isRecord(item.event) ? item.event : {};
      const participants = Array.isArray(event.participants) ? event.participants.filter(isRecord).sort((a, b) => Number(a.position) - Number(b.position)) : [];
      const picks = Array.isArray(item.selections) ? item.selections.filter(isRecord) : [];
      if (!picks.length) return [item];
      return picks.map((pick) => ({
        event,
        eventId: event.id,
        eventName: str(event.name) || `${str(participants[0]?.name)} - ${str(participants[1]?.name)}`,
        homeTeamName: str(participants[0]?.name),
        awayTeamName: str(participants[1]?.name),
        startTime: event.startTime,
        market: isRecord(pick.market) ? pick.market : {},
        selection: isRecord(pick.selectionInfo) ? pick.selectionInfo : isRecord(pick.selection) ? pick.selection : {},
      }));
    });
  }
  if (provider === "bet9ja") {
    const odds = isRecord(data.O) ? data.O : isRecord(data.EVS) ? data.EVS : null;
    if (odds) return Object.values(odds).filter(isRecord);
  }
  if (provider === "betking" && Array.isArray(data.odds)) return data.odds.filter(isRecord).map((row) => ({ ...row, eventName: str(row.matchName) || str(row.eventName) }));
  if (provider === "betway" && Array.isArray(data.selections)) return data.selections.filter(isRecord).map((row) => {
    const event = isRecord(row.sportEvent) ? row.sportEvent : {};
    const market = isRecord(row.market) ? row.market : {};
    const outcome = isRecord(row.outcome) ? row.outcome : {};
    return { ...row, event, eventId: event.eventId ?? row.eventId, eventName: row.eventName ?? `${str(event.homeTeam)} vs ${str(event.awayTeam)}`,
      homeTeamName: event.homeTeam, awayTeamName: event.awayTeam, startTime: event.expectedStartEpoch ?? row.eventEpoch, market, outcome };
  });
  return [];
}

function sportyEvent(value: unknown): Json | null {
  const root = unwrap(value);
  if (!isRecord(root)) return null;
  const data = isRecord(root.data) ? root.data : root;
  if (Array.isArray(data)) return data.find(isRecord) ?? null;
  if (isRecord(data.event)) return data.event;
  return data;
}

function sportyTeams(event: Json) {
  const competitors = Array.isArray(event.competitors) ? event.competitors.filter(isRecord) : [];
  const homeCompetitor = competitors.find((item) => ["home", "1"].includes(str(item.qualifier ?? item.position).toLowerCase()));
  const awayCompetitor = competitors.find((item) => ["away", "2"].includes(str(item.qualifier ?? item.position).toLowerCase()));
  const name = (value: unknown) => typeof value === "string" ? value : isRecord(value) ? str(value.name ?? value.shortName ?? value.displayName ?? value.teamName) : "";
  let home = name(event.homeTeamName ?? event.homeTeam ?? event.home ?? event.team1 ?? homeCompetitor);
  let away = name(event.awayTeamName ?? event.awayTeam ?? event.away ?? event.team2 ?? awayCompetitor);
  const pair = splitTeams(str(event.eventName ?? event.matchName ?? event.name));
  home ||= pair.home; away ||= pair.away;
  return { home, away };
}

async function hydrateSportyRows(payload: unknown, fetcher: FetchLike) {
  const rows = selectionRows("sportybet", payload);
  return Promise.all(rows.map(async (row) => {
    const eventId = str(row.eventId ?? row.fixtureId ?? row.matchId ?? row.id);
    const marketId = str(row.marketId ?? row.marketID ?? row.MID);
    const outcomeId = str(row.outcomeId ?? row.outcomeID ?? row.OID);
    if (!eventId || !marketId || !outcomeId) return row;
    const alreadyReadable = str(row.eventName ?? row.matchName) && str(row.marketName ?? row.market) && str(row.outcomeName ?? row.selectionName);
    if (alreadyReadable) return row;
    try {
      const response = await fetcher(`${SPORTY_ORIGIN}/api/ng/factsCenter/event?eventId=${encodeURIComponent(eventId)}&product=3`, { headers: { accept: "application/json", countrycode: "ng", operid: "2", origin: SPORTY_ORIGIN, referer: `${SPORTY_ORIGIN}/ng/m/sport/football/today` }, signal: AbortSignal.timeout(15_000) });
      const event = sportyEvent(await jsonResponse(response, "SportyBet could not load the selections in that code."));
      if (!event) return row;
      const markets = Array.isArray(event.markets) ? event.markets.filter(isRecord) : [];
      const wantedSpecifier = str(row.specifier ?? row.specialValue ?? row.handicap);
      const market = markets.find((item) => str(item.id ?? item.marketId) === marketId && (!wantedSpecifier || str(item.specifier) === wantedSpecifier))
        ?? markets.find((item) => str(item.id ?? item.marketId) === marketId);
      const outcomes = market && Array.isArray(market.outcomes) ? market.outcomes.filter(isRecord) : [];
      const outcome = outcomes.find((item) => str(item.id ?? item.outcomeId) === outcomeId);
      const teams = sportyTeams(event);
      return {
        ...row,
        eventId,
        eventName: str(event.eventName ?? event.matchName ?? event.name) || `${teams.home} vs ${teams.away}`,
        homeTeamName: teams.home,
        awayTeamName: teams.away,
        startTime: event.estimateStartTime ?? event.startTime ?? event.kickoff ?? event.scheduled,
        marketId,
        marketName: market ? str(market.desc ?? market.name ?? market.displayName) : "",
        outcomeId,
        outcomeName: outcome ? str(outcome.desc ?? outcome.name ?? outcome.displayName) : "",
        specifier: wantedSpecifier || (market ? str(market.specifier) : ""),
      };
    } catch { return row; }
  }));
}

export function decodeLoadedPayload(provider: DecodableBookmaker, code: string, payload: unknown) {
  const rows = selectionRows(provider, payload);
  const converted = rows.map((row, index) => ({ row, input: toInput(row, provider, index) }));
  const selections = converted.flatMap(({ input }) => input ? [input] : []);
  const skippedSelections = converted.flatMap(({ row, input }) => {
    if (input) return [];
    const nested = [row, row.event, row.eventInfo, row.fixture, row.match, row.market, row.selection, row.selectionInfo, row.outcome].filter(isRecord);
    const eventName = first(nested, ["eventName", "matchName", "fixtureName", "E_NAME", "N", "SE", "name"]);
    const marketName = first(nested, ["marketName", "marketLabel", "marketTypeName", "groupName", "M_NAME", "M", "displayName"]);
    const outcomeName = first(nested, ["outcomeName", "selectionName", "selection", "outcome", "sign", "SGN", "S", "displayName"]);
    return [{ eventName: eventName || "Unknown match", marketName: marketName || "Unknown market", outcomeName: outcomeName || "Unknown selection", reason: !eventName ? "The bookmaker did not return readable teams." : "This market does not have a safe equivalent yet." }];
  });
  if (!rows.length) throw new BookmakerDecodeError(`${provider} did not return any selections for this code.`, 422);
  if (!selections.length) throw new BookmakerDecodeError(`OddsAura loaded the ${provider} code, but none of its markets have a safe equivalent yet.`, 422, { loaded: rows.length, skippedSelections });
  return { sourceProvider: provider, sourceCode: code, selections, partial: selections.length !== rows.length, skipped: rows.length - selections.length, skippedSelections };
}

async function jsonResponse(response: Response, failure: string) {
  const text = await response.text();
  let payload: unknown;
  try { payload = JSON.parse(text.replace(/^\uFEFF/, "").trim()); if (typeof payload === "string") payload = JSON.parse(payload); }
  catch { throw new BookmakerDecodeError(failure, 502, { status: response.status, preview: text.slice(0, 120) }); }
  if (!response.ok) throw new BookmakerDecodeError(failure, response.status === 404 ? 422 : 502, payload);
  return payload;
}

export async function decodeBookmakerCode(provider: DecodableBookmaker, rawCode: string, fetcher: FetchLike = fetch) {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(code)) throw new BookmakerDecodeError("Enter a valid bookmaker code.", 400);
  try {
    if (provider === "sportybet") {
      const response = await fetcher(`${SPORTY_ORIGIN}/api/ng/orders/share/${encodeURIComponent(code)}`, { headers: { accept: "application/json", countrycode: "ng", operid: "2", origin: SPORTY_ORIGIN, referer: `${SPORTY_ORIGIN}/ng/` }, signal: AbortSignal.timeout(15_000) });
      const payload = await jsonResponse(response, "SportyBet could not load that code.");
      if (isRecord(payload) && Number(payload.bizCode) !== 10_000) throw new BookmakerDecodeError(str(payload.message) || "SportyBet did not recognise that code.", 422, payload);
      const rows = await hydrateSportyRows(payload, fetcher);
      return decodeLoadedPayload(provider, code, { data: { ticket: { selections: rows } } });
    }
    if (provider === "betpawa") {
      const response = await fetcher(`${PAWA_ORIGIN}/api/sportsbook/v3/booking-number/${encodeURIComponent(code)}`, { headers: { accept: "application/json", "x-pawa-brand": "betpawa-nigeria", devicetype: "web", origin: PAWA_ORIGIN, referer: `${PAWA_ORIGIN}/` }, signal: AbortSignal.timeout(15_000) });
      return decodeLoadedPayload(provider, code, await jsonResponse(response, "betPawa could not load that code."));
    }
    if (provider === "bet9ja") {
      const response = await fetcher(`${BET9JA_VERIFY}?couponCode=${encodeURIComponent(code)}`, { headers: { accept: "application/json", origin: "https://sports.bet9ja.com", referer: "https://sports.bet9ja.com/mobile/bookabet", "x-requested-with": "XMLHttpRequest" }, signal: AbortSignal.timeout(15_000) });
      return decodeLoadedPayload(provider, code, await jsonResponse(response, "Bet9ja could not load that booking code."));
    }
    if (provider === "betking") {
      const response = await fetcher(`${BETKING_ORIGIN}/en-ng/widgets/bookBet`, { method: "POST", headers: { accept: "application/json,text/html", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: JSON.stringify({ requestType: "load_booking_code", bookingCode: code }) }).toString(), signal: AbortSignal.timeout(15_000) });
      const html = await response.text();
      const match = html.match(/window\.__remixContext\s*=\s*([\s\S]*?);<\/script>/);
      let context: unknown = null; try { context = match ? JSON.parse(match[1]!) : null; } catch { /* handled below */ }
      const root = isRecord(context) && isRecord(context.state) && isRecord(context.state.actionData) ? context.state.actionData : null;
      const route = root && isRecord(root["routes/($locale).widgets.bookBet"]) ? root["routes/($locale).widgets.bookBet"] : null;
      const coupon = route && isRecord(route.bookedCoupon) ? route.bookedCoupon : null;
      if (!coupon) throw new BookmakerDecodeError("BetKing could not load that booking code.", response.status === 404 ? 422 : 502, { status: response.status });
      return decodeLoadedPayload(provider, code, coupon);
    }
    if (provider === "betway") {
      const response = await fetcher(BETWAY_FIND, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", origin: "https://www.betway.com.ng", referer: "https://www.betway.com.ng/book-a-bet" }, body: JSON.stringify({ countryCode: "NG", bookingCode: code, cultureCode: "en-US" }), signal: AbortSignal.timeout(15_000) });
      return decodeLoadedPayload(provider, code, await jsonResponse(response, "Betway could not load that booking code."));
    }
  } catch (error) {
    if (error instanceof BookmakerDecodeError) throw error;
    throw new BookmakerDecodeError(`${provider} could not load that code right now.`, 502, { cause: error instanceof Error ? error.message : String(error) });
  }
  throw new BookmakerDecodeError("This bookmaker does not expose a verified public code-import service for OddsAura.", 503, { provider });
}
