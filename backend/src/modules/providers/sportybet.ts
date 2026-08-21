export type SportyBetSelectionInput = {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  marketKey: string;
  marketName: string;
  selection: string;
  line?: number | null;
  providerEventId?: string | null;
  providerMarketId?: string | null;
  providerOutcomeId?: string | null;
  providerSpecifier?: string | null;
};

export type SportyBetResolvedSelection = {
  fixtureId: string;
  eventId: string;
  marketId: string;
  outcomeId: string;
  specifier: string | null;
  odds: number | null;
  homeTeam: string;
  awayTeam: string;
  market: string;
  outcome: string;
};

export type SportyBetCodeResult = {
  code: string;
  deepLink: string;
  resolved: SportyBetResolvedSelection[];
};

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

const SPORTY_ORIGIN = "https://www.sportybet.com";
const API_BASE = `${SPORTY_ORIGIN}/api/ng`;
const SUCCESS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const eventCache = new Map<string, { expiresAt: number; event: JsonRecord }>();
const headers = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json;charset=UTF-8",
  countrycode: "ng",
  operid: "2",
  origin: SPORTY_ORIGIN,
  referer: `${SPORTY_ORIGIN}/ng/m/sport/football/today`,
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36",
};

export class SportyBetIntegrationError extends Error {
  constructor(message: string, readonly status = 422, readonly details?: unknown) {
    super(message);
    this.name = "SportyBetIntegrationError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(fc|cf|sc|afc|club|football|de|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenScore(left: string, right: string) {
  const a = new Set(normalize(left).split(" ").filter(Boolean));
  const b = new Set(normalize(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  const joinedA = [...a].join(" ");
  const joinedB = [...b].join(" ");
  return Math.max(intersection / union, joinedA.includes(joinedB) || joinedB.includes(joinedA) ? .92 : 0);
}

function readName(value: unknown) {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  return stringValue(value.name || value.shortName || value.displayName || value.teamName);
}

function eventTeams(event: JsonRecord) {
  const competitors = Array.isArray(event.competitors) ? event.competitors.filter(isRecord) : [];
  const homeCompetitor = competitors.find((item) => ["home", "1"].includes(stringValue(item.qualifier || item.position).toLowerCase()));
  const awayCompetitor = competitors.find((item) => ["away", "2"].includes(stringValue(item.qualifier || item.position).toLowerCase()));
  let home = readName(event.homeTeamName || event.homeTeam || event.home || event.team1 || homeCompetitor);
  let away = readName(event.awayTeamName || event.awayTeam || event.away || event.team2 || awayCompetitor);
  const eventName = stringValue(event.name || event.eventName || event.matchName);
  if ((!home || !away) && /\s+(?:vs\.?|v)\s+/i.test(eventName)) {
    const parts = eventName.split(/\s+(?:vs\.?|v)\s+/i);
    home ||= parts[0]?.trim() ?? "";
    away ||= parts[1]?.trim() ?? "";
  }
  return { home, away };
}

function eventKickoff(event: JsonRecord) {
  const raw = event.estimateStartTime || event.startTime || event.kickoff || event.scheduled || event.startTimestamp;
  if (typeof raw === "number") return raw > 10_000_000_000 ? raw : raw * 1_000;
  const parsed = Date.parse(stringValue(raw));
  return Number.isFinite(parsed) ? parsed : 0;
}

function collectEvents(value: unknown, output: JsonRecord[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectEvents(item, output);
    return output;
  }
  if (!isRecord(value)) return output;
  if (stringValue(value.eventId || value.id).includes("match:") && (value.homeTeamName || value.homeTeam || value.competitors)) output.push(value);
  for (const [key, child] of Object.entries(value)) {
    if (["markets", "outcomes", "competitors"].includes(key)) continue;
    if (Array.isArray(child) || isRecord(child)) collectEvents(child, output);
  }
  return output;
}

function getMarkets(event: JsonRecord) {
  return Array.isArray(event.markets) ? event.markets.filter(isRecord) : [];
}

function getOutcomes(market: JsonRecord) {
  return Array.isArray(market.outcomes) ? market.outcomes.filter(isRecord) : [];
}

function marketText(market: JsonRecord) {
  return normalize([market.desc, market.name, market.displayName, market.group].map(stringValue).join(" "));
}

function specifierLine(market: JsonRecord) {
  const specifier = stringValue(market.specifier);
  const match = specifier.match(/(?:total|hcp)=(-?\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function outcomeText(outcome: JsonRecord) {
  return normalize([outcome.desc, outcome.name, outcome.displayName].map(stringValue).join(" "));
}

type MarketRule = { marketId?: string; text?: string; line?: number | null; outcomeId?: string; outcomeText: string[] };

function marketRule(input: SportyBetSelectionInput): MarketRule {
  const key = input.marketKey;
  const home = input.homeTeam;
  const away = input.awayTeam;
  if (key === "MATCH_HOME") return { marketId: "1", outcomeId: "1", outcomeText: ["home"] };
  if (key === "MATCH_DRAW") return { marketId: "1", outcomeId: "2", outcomeText: ["draw"] };
  if (key === "MATCH_AWAY") return { marketId: "1", outcomeId: "3", outcomeText: ["away"] };
  if (key === "DC_1X") return { marketId: "10", outcomeId: "9", outcomeText: ["home or draw"] };
  if (key === "DC_12") return { marketId: "10", outcomeId: "10", outcomeText: ["home or away"] };
  if (key === "DC_X2") return { marketId: "10", outcomeId: "11", outcomeText: ["draw or away"] };
  if (key === "DNB_HOME") return { marketId: "11", outcomeId: "4", outcomeText: ["home"] };
  if (key === "DNB_AWAY") return { marketId: "11", outcomeId: "5", outcomeText: ["away"] };
  if (key === "BTTS_YES") return { marketId: "29", outcomeText: ["yes"] };
  if (key === "BTTS_NO") return { marketId: "29", outcomeText: ["no"] };
  if (key === "ODD_GOALS") return { marketId: "26", outcomeText: ["odd"] };
  if (key === "EVEN_GOALS") return { marketId: "26", outcomeText: ["even"] };
  if (key === "HOME_CLEAN") return { marketId: "31", outcomeText: ["yes"] };
  if (key === "AWAY_CLEAN") return { marketId: "32", outcomeText: ["yes"] };
  if (key === "HOME_WIN_NIL") return { marketId: "33", outcomeText: ["yes"] };
  if (key === "AWAY_WIN_NIL") return { marketId: "34", outcomeText: ["yes"] };
  if (/^OVER_/.test(key)) return { marketId: "18", line: input.line, outcomeId: "12", outcomeText: [`over ${input.line}`] };
  if (/^UNDER_/.test(key)) return { marketId: "18", line: input.line, outcomeId: "13", outcomeText: [`under ${input.line}`] };
  if (/^HOME_OVER_/.test(key)) return { marketId: "19", line: input.line, outcomeId: "12", outcomeText: [`over ${input.line}`] };
  if (/^HOME_UNDER_/.test(key)) return { marketId: "19", line: input.line, outcomeId: "13", outcomeText: [`under ${input.line}`] };
  if (/^AWAY_OVER_/.test(key)) return { marketId: "20", line: input.line, outcomeId: "12", outcomeText: [`over ${input.line}`] };
  if (/^AWAY_UNDER_/.test(key)) return { marketId: "20", line: input.line, outcomeId: "13", outcomeText: [`under ${input.line}`] };
  if (key === "HOME_AND_O15") return { marketId: "37", line: 1.5, outcomeText: ["home over 1 5"] };
  if (key === "AWAY_AND_O15") return { marketId: "37", line: 1.5, outcomeText: ["away over 1 5"] };
  if (key === "DC1X_AND_O15") return { marketId: "547", line: 1.5, outcomeText: ["home draw over 1 5"] };
  if (key === "DCX2_AND_O15") return { marketId: "547", line: 1.5, outcomeText: ["draw away over 1 5"] };
  if (key === "BTTS_AND_O25") return { marketId: "36", line: 2.5, outcomeText: ["over 2 5 yes"] };
  if (key === "HT_HOME") return { marketId: "60", outcomeText: ["home"] };
  if (key === "HT_DRAW") return { marketId: "60", outcomeText: ["draw"] };
  if (key === "HT_AWAY") return { marketId: "60", outcomeText: ["away"] };
  if (/^HT_OVER_/.test(key)) return { marketId: "68", line: input.line, outcomeId: "12", outcomeText: [`over ${input.line}`] };
  if (/^CS_/.test(key)) return { marketId: "45", outcomeText: [input.selection.replace("-", ":"), input.selection] };
  return { text: input.marketName, line: input.line, outcomeText: [input.selection, input.selection.replace(home, "home").replace(away, "away")] };
}

function findMarket(event: JsonRecord, input: SportyBetSelectionInput) {
  const rule = marketRule(input);
  const candidates = getMarkets(event).filter((market) => {
    const active = market.status == null || Number(market.status) === 0;
    const idMatches = !rule.marketId || stringValue(market.id || market.marketId) === rule.marketId;
    const textMatches = !rule.text || marketText(market).includes(normalize(rule.text));
    const line = specifierLine(market);
    const lineMatches = rule.line == null || line == null || Math.abs(line - rule.line) < .001;
    return active && idMatches && textMatches && lineMatches;
  });
  return candidates.find((market) => rule.line == null || specifierLine(market) === rule.line) ?? candidates[0];
}

function findOutcome(market: JsonRecord, input: SportyBetSelectionInput) {
  const rule = marketRule(input);
  const outcomes = getOutcomes(market).filter((outcome) => outcome.isActive == null || Number(outcome.isActive) === 1);
  if (rule.outcomeId) {
    const byId = outcomes.find((outcome) => stringValue(outcome.id || outcome.outcomeId) === rule.outcomeId);
    if (byId) return byId;
  }
  const wanted = rule.outcomeText.map(normalize).filter(Boolean);
  return outcomes.find((outcome) => {
    const actual = outcomeText(outcome);
    return wanted.some((candidate) => actual === candidate || actual.includes(candidate) || candidate.includes(actual));
  });
}

function rankEvents(events: JsonRecord[], input: SportyBetSelectionInput) {
  const kickoff = Date.parse(input.kickoff);
  return events.map((event) => {
    const teams = eventTeams(event);
    const directNameScore = (tokenScore(input.homeTeam, teams.home) + tokenScore(input.awayTeam, teams.away)) / 2;
    const reversedNameScore = (tokenScore(input.homeTeam, teams.away) + tokenScore(input.awayTeam, teams.home)) / 2;
    const nameScore = Math.max(directNameScore, reversedNameScore * .85);
    const eventTime = eventKickoff(event);
    const timeScore = !kickoff || !eventTime ? .5 : Math.max(0, 1 - Math.abs(kickoff - eventTime) / 86_400_000);
    return { event, score: nameScore * .84 + timeScore * .16, nameScore, timeDelta: kickoff && eventTime ? Math.abs(kickoff - eventTime) : null };
  }).sort((a, b) => b.score - a.score);
}

function resolveFromEvent(event: JsonRecord, input: SportyBetSelectionInput): SportyBetResolvedSelection {
  const teams = eventTeams(event);
  const market = findMarket(event, input);
  if (!market) throw new SportyBetIntegrationError(`The ${input.marketName} market is not currently available on SportyBet for ${input.homeTeam} vs ${input.awayTeam}.`, 422, { fixtureId: input.fixtureId, marketKey: input.marketKey });
  const outcome = findOutcome(market, input);
  if (!outcome) throw new SportyBetIntegrationError(`The ${input.selection} price is not currently available on SportyBet for ${input.homeTeam} vs ${input.awayTeam}.`, 422, { fixtureId: input.fixtureId, marketKey: input.marketKey });
  const odds = Number(outcome.odds);
  return {
    fixtureId: input.fixtureId,
    eventId: stringValue(event.eventId || event.id),
    marketId: stringValue(market.id || market.marketId),
    outcomeId: stringValue(outcome.id || outcome.outcomeId),
    specifier: stringValue(market.specifier) || null,
    odds: Number.isFinite(odds) ? odds : null,
    homeTeam: teams.home || input.homeTeam,
    awayTeam: teams.away || input.awayTeam,
    market: stringValue(market.desc || market.name) || input.marketName,
    outcome: stringValue(outcome.desc || outcome.name) || input.selection,
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text) as JsonRecord; }
  catch { throw new SportyBetIntegrationError("SportyBet returned an unreadable response.", 502, { status: response.status }); }
}

async function sportyRequest(fetcher: FetchLike, url: string, init: RequestInit, failureMessage: string, bizErrorStatus = 502) {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, headers: { ...headers, ...init.headers }, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new SportyBetIntegrationError(failureMessage, 502, { cause: error instanceof Error ? error.message : String(error) });
  }
  if (!response.ok) throw new SportyBetIntegrationError(failureMessage, 502, { status: response.status });
  const payload = await readJson(response);
  if (Number(payload.bizCode) !== SUCCESS) throw new SportyBetIntegrationError(stringValue(payload.message) || failureMessage, bizErrorStatus, payload);
  return payload;
}

function cacheKey(input: SportyBetSelectionInput) {
  return `${normalize(input.homeTeam)}|${normalize(input.awayTeam)}|${input.kickoff.slice(0, 10)}`;
}

async function searchEvents(fetcher: FetchLike, keyword: string) {
  const query = new URLSearchParams({ keyword, offset: "0", pageSize: "20", withOneUpMarket: "true", withTwoUpMarket: "true" });
  const payload = await sportyRequest(fetcher, `${API_BASE}/factsCenter/event/firstSearch?${query}`, { method: "GET" }, "SportyBet's fixture search is temporarily unavailable.");
  return collectEvents(payload.data);
}

async function loadExactEvent(fetcher: FetchLike, eventId: string) {
  const query = new URLSearchParams({ eventId, productId: "3" });
  const payload = await sportyRequest(fetcher, `${API_BASE}/factsCenter/event?${query}`, { method: "GET" }, "SportyBet's market service is temporarily unavailable.");
  if (!isRecord(payload.data)) throw new SportyBetIntegrationError("SportyBet did not return the selected fixture.", 502, { eventId });
  return payload.data;
}

async function findEvent(fetcher: FetchLike, input: SportyBetSelectionInput) {
  const key = cacheKey(input);
  const cached = eventCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.event;
  let events = await searchEvents(fetcher, input.homeTeam);
  let ranked = rankEvents(events, input);
  if (!ranked[0] || ranked[0].nameScore < .7) {
    events = [...events, ...await searchEvents(fetcher, input.awayTeam)];
    ranked = rankEvents(events, input);
  }
  const match = ranked[0];
  if (!match || match.nameScore < .7 || (match.timeDelta != null && match.timeDelta > 3 * 86_400_000)) {
    throw new SportyBetIntegrationError(`SportyBet does not currently list ${input.homeTeam} vs ${input.awayTeam}.`, 422, { fixtureId: input.fixtureId });
  }
  const eventId = stringValue(match.event.eventId || match.event.id);
  const exact = await loadExactEvent(fetcher, eventId);
  eventCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, event: exact });
  return exact;
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function directSelection(input: SportyBetSelectionInput): SportyBetResolvedSelection {
  return {
    fixtureId: input.fixtureId,
    eventId: input.providerEventId!,
    marketId: input.providerMarketId!,
    outcomeId: input.providerOutcomeId!,
    specifier: input.providerSpecifier ?? null,
    odds: null,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    market: input.marketName,
    outcome: input.selection,
  };
}

function verifiedSelectionCount(payload: JsonRecord) {
  const data = isRecord(payload.data) ? payload.data : {};
  const ticket = isRecord(data.ticket) ? data.ticket : {};
  if (Array.isArray(ticket.selections)) return ticket.selections.length;
  if (Array.isArray(data.outcomes)) return data.outcomes.length;
  return 0;
}

function safeDeepLink(value: unknown, code: string) {
  const raw = stringValue(value).replace(/^http:/, "https:");
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && /(^|\.)sportybet\.com$/i.test(url.hostname)) return url.toString();
  } catch { /* fall through to the official code URL */ }
  return `${SPORTY_ORIGIN}/ng/?shareCode=${encodeURIComponent(code)}`;
}

export async function createSportyBetCode(selections: SportyBetSelectionInput[], fetcher: FetchLike = fetch): Promise<SportyBetCodeResult> {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 50) throw new SportyBetIntegrationError("Choose between 1 and 50 selections.", 400);
  const resolved = await mapLimit(selections, 4, async (input) => {
    if (input.providerEventId && input.providerMarketId && input.providerOutcomeId) return directSelection(input);
    return resolveFromEvent(await findEvent(fetcher, input), input);
  });
  if (new Set(resolved.map((item) => item.eventId)).size !== resolved.length) {
    throw new SportyBetIntegrationError("Choose only one prediction from each SportyBet match.", 422);
  }
  const payload = await sportyRequest(fetcher, `${API_BASE}/orders/share?throwInvalidEvent=true`, {
    method: "POST",
    body: JSON.stringify({ selections: resolved.map((item) => ({ eventId: item.eventId, marketId: item.marketId, outcomeId: item.outcomeId, specifier: item.specifier ?? "" })) }),
  }, "SportyBet's booking-code service is temporarily unavailable.", 422);
  const data = isRecord(payload.data) ? payload.data : {};
  const code = stringValue(data.shareCode);
  if (!/^[A-Z0-9]{4,12}$/i.test(code)) throw new SportyBetIntegrationError(stringValue(payload.message) || "SportyBet rejected one or more selections.", 422, payload);
  const verification = await sportyRequest(fetcher, `${API_BASE}/orders/share/${encodeURIComponent(code)}`, { method: "GET" }, "SportyBet created a code but did not confirm it. Please try again.");
  const confirmed = verifiedSelectionCount(verification);
  if (confirmed !== resolved.length) throw new SportyBetIntegrationError("SportyBet did not confirm every selection in the generated code.", 502, { code, expected: resolved.length, confirmed });
  return { code, deepLink: safeDeepLink(data.shareURL, code), resolved };
}
