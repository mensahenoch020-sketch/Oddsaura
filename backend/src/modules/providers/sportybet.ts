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

const BASE_URL = "https://www.sportybet.com";
const SUCCESS = 10_000;
const headers = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json;charset=UTF-8",
  countrycode: "ng",
  operid: "2",
  origin: BASE_URL,
  referer: `${BASE_URL}/ng/m/`,
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
  let home = readName(event.homeTeam || event.home || event.team1 || homeCompetitor);
  let away = readName(event.awayTeam || event.away || event.team2 || awayCompetitor);
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
  if (stringValue(value.eventId || value.id).includes("match:") && Array.isArray(value.markets)) output.push(value);
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

function findMarket(event: JsonRecord, input: SportyBetSelectionInput) {
  const markets = getMarkets(event);
  const wantsResult = input.marketKey.startsWith("MATCH_") || normalize(input.marketName).includes("match result");
  const wantsTotal = input.marketKey.startsWith("OVER_") || input.marketKey.startsWith("UNDER_") || input.line != null;
  const candidates = markets.filter((market) => {
    const text = marketText(market);
    if (wantsResult) return text.includes("1x2") || text.includes("match result") || stringValue(market.id) === "1";
    if (wantsTotal) {
      const line = specifierLine(market);
      return (text.includes("over under") || text.includes("total goals") || stringValue(market.id) === "18") &&
        (input.line == null || line == null || Math.abs(line - input.line) < .001);
    }
    return text.includes(normalize(input.marketName));
  });
  return candidates.find((market) => input.line == null || specifierLine(market) === input.line) ?? candidates[0];
}

function findOutcome(market: JsonRecord, input: SportyBetSelectionInput) {
  const outcomes = getOutcomes(market);
  const key = input.marketKey;
  const wanted = normalize(input.selection);
  const targetId = key === "MATCH_HOME" ? "1" : key === "MATCH_DRAW" ? "2" : key === "MATCH_AWAY" ? "3" : null;
  if (targetId) {
    return outcomes.find((outcome) => stringValue(outcome.id) === targetId) ?? outcomes.find((outcome) => {
      const text = outcomeText(outcome);
      return key === "MATCH_HOME" ? text === "home" || text === "1" : key === "MATCH_AWAY" ? text === "away" || text === "2" : text === "draw" || text === "x";
    });
  }
  if (key.startsWith("OVER_")) return outcomes.find((outcome) => outcomeText(outcome).includes("over") || stringValue(outcome.id) === "13");
  if (key.startsWith("UNDER_")) return outcomes.find((outcome) => outcomeText(outcome).includes("under") || stringValue(outcome.id) === "12");
  return outcomes.find((outcome) => outcomeText(outcome).includes(wanted) || wanted.includes(outcomeText(outcome)));
}

function resolveSelection(events: JsonRecord[], input: SportyBetSelectionInput): SportyBetResolvedSelection {
  if (input.providerEventId && input.providerMarketId && input.providerOutcomeId) {
    return {
      fixtureId: input.fixtureId, eventId: input.providerEventId, marketId: input.providerMarketId,
      outcomeId: input.providerOutcomeId, specifier: input.providerSpecifier ?? null, odds: null,
      homeTeam: input.homeTeam, awayTeam: input.awayTeam, market: input.marketName, outcome: input.selection,
    };
  }
  const kickoff = Date.parse(input.kickoff);
  const ranked = events.map((event) => {
    const teams = eventTeams(event);
    const nameScore = (tokenScore(input.homeTeam, teams.home) + tokenScore(input.awayTeam, teams.away)) / 2;
    const eventTime = eventKickoff(event);
    const timeScore = !kickoff || !eventTime ? .5 : Math.max(0, 1 - Math.abs(kickoff - eventTime) / 64_800_000);
    return { event, teams, score: nameScore * .82 + timeScore * .18, nameScore };
  }).sort((a, b) => b.score - a.score);
  const match = ranked[0];
  if (!match || match.nameScore < .62) throw new SportyBetIntegrationError(`SportyBet does not currently list ${input.homeTeam} vs ${input.awayTeam}.`, 422, { fixtureId: input.fixtureId });
  const market = findMarket(match.event, input);
  if (!market) throw new SportyBetIntegrationError(`The ${input.marketName} market is not currently available on SportyBet for ${input.homeTeam} vs ${input.awayTeam}.`, 422, { fixtureId: input.fixtureId });
  const outcome = findOutcome(market, input);
  if (!outcome) throw new SportyBetIntegrationError(`The ${input.selection} price is not currently available on SportyBet for ${input.homeTeam} vs ${input.awayTeam}.`, 422, { fixtureId: input.fixtureId });
  const odds = Number(outcome.odds);
  return {
    fixtureId: input.fixtureId,
    eventId: stringValue(match.event.eventId || match.event.id),
    marketId: stringValue(market.id || market.marketId),
    outcomeId: stringValue(outcome.id || outcome.outcomeId),
    specifier: stringValue(market.specifier) || null,
    odds: Number.isFinite(odds) ? odds : null,
    homeTeam: match.teams.home || input.homeTeam,
    awayTeam: match.teams.away || input.awayTeam,
    market: stringValue(market.desc || market.name) || input.marketName,
    outcome: stringValue(outcome.desc || outcome.name) || input.selection,
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text) as JsonRecord; }
  catch { throw new SportyBetIntegrationError("SportyBet returned an unreadable response.", 502, { status: response.status }); }
}

async function fetchCatalogue(fetcher: FetchLike) {
  const response = await fetcher(`${BASE_URL}/factsCenter/wapConfigurableEventsByOrder`, {
    method: "POST", headers,
    body: JSON.stringify({ sportId: "sr:sport:1", productId: 3, order: 2, pageNum: 1, pageSize: 500, withTwoUpMarket: true, withOneUpMarket: true }),
  });
  if (!response.ok) throw new SportyBetIntegrationError("SportyBet's fixture service is temporarily unavailable.", 502, { status: response.status });
  const payload = await readJson(response);
  if (Number(payload.bizCode) !== SUCCESS) throw new SportyBetIntegrationError(stringValue(payload.message) || "SportyBet rejected the fixture request.", 502, payload);
  return collectEvents(payload.data);
}

export async function createSportyBetCode(selections: SportyBetSelectionInput[], fetcher: FetchLike = fetch): Promise<SportyBetCodeResult> {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 50) throw new SportyBetIntegrationError("Choose between 1 and 50 selections.", 400);
  const needsCatalogue = selections.some((item) => !item.providerEventId || !item.providerMarketId || !item.providerOutcomeId);
  const events = needsCatalogue ? await fetchCatalogue(fetcher) : [];
  const resolved = selections.map((selection) => resolveSelection(events, selection));
  const response = await fetcher(`${BASE_URL}/orders/share?throwInvalidEvent=true`, {
    method: "POST", headers,
    body: JSON.stringify({ selections: resolved.map((item) => ({ eventId: item.eventId, marketId: item.marketId, outcomeId: item.outcomeId, specifier: item.specifier })) }),
  });
  if (!response.ok) throw new SportyBetIntegrationError("SportyBet's booking-code service is temporarily unavailable.", 502, { status: response.status });
  const payload = await readJson(response);
  const data = isRecord(payload.data) ? payload.data : {};
  const code = stringValue(data.shareCode);
  if (Number(payload.bizCode) !== SUCCESS || !/^[A-Z0-9]{4,12}$/i.test(code)) throw new SportyBetIntegrationError(stringValue(payload.message) || "SportyBet rejected one or more selections.", 422, payload);
  const verification = await fetcher(`${BASE_URL}/orders/share/${encodeURIComponent(code)}`, { headers: { ...headers, "content-type": "application/json" } });
  if (!verification.ok) throw new SportyBetIntegrationError("SportyBet created a code but did not confirm it. Please try again.", 502, { code, status: verification.status });
  const verifiedPayload = await readJson(verification);
  if (Number(verifiedPayload.bizCode) !== SUCCESS) throw new SportyBetIntegrationError("SportyBet did not validate the generated code.", 502, { code });
  return { code, deepLink: `${BASE_URL}/?shareCode=${encodeURIComponent(code)}`, resolved };
}
