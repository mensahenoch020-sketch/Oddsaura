import { fetchJson, wait } from "./http.mjs";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const DEFAULT_LEAGUES = [
  "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "uefa.champions",
  "uefa.europa", "uefa.europa.conf", "ned.1", "por.1", "sco.1",
  "bel.1", "tur.1", "usa.1", "mex.1", "bra.1", "arg.1",
];

const compactDate = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
const displayName = (value) => String(value ?? "").split("-").filter(Boolean).map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");

function globalLeague(raw) {
  const leagueId = String(raw?.uid ?? "").match(/~l:(\d+)/)?.[1] ?? "";
  const rawSlug = String(raw?.season?.slug ?? "").replace(/^\d{4}(?:-\d{2})?-/, "");
  const generic = ["", "regular-season", "first-round", "second-round", "group-stage", "tournament", "apertura", "clausura", "torneo-apertura", "torneo-clausura"].includes(rawSlug);
  const country = raw?.competitions?.[0]?.venue?.address?.country ?? raw?.venue?.address?.country ?? "";
  return {
    id: leagueId,
    slug: rawSlug || leagueId,
    name: generic ? (country ? `${country} Football` : "International Football") : displayName(rawSlug),
    country,
  };
}

export function normalizeEspnGlobalEvent(raw) {
  return normalizeEspnEvent(raw, globalLeague(raw), "espn-global-json");
}

function decimalFromAmerican(value) {
  const american = Number(value);
  if (!Number.isFinite(american) || american === 0) return null;
  return Number((american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american)).toFixed(2));
}

function scoreValue(competitor) {
  const value = Number(competitor?.score?.value ?? competitor?.score);
  return Number.isFinite(value) ? value : null;
}

function lastPrice(side) {
  return side?.close?.odds ?? side?.open?.odds ?? side?.moneyLine ?? side?.value ?? null;
}

function lastLine(side, fallback = null) {
  const raw = side?.close?.line ?? side?.open?.line ?? fallback;
  const value = Number(String(raw ?? "").replace(/^[a-z]/i, ""));
  return Number.isFinite(value) ? value : null;
}

function lastLink(side, fallback = null) {
  return side?.close?.link?.href ?? side?.open?.link?.href ?? side?.link?.href ?? fallback;
}

function normalizeOdds(competition, home, away) {
  const quotes = Array.isArray(competition?.odds) ? competition.odds : [];
  const rows = [];
  for (const quote of quotes) {
    const source = `espn-${quote?.provider?.name ?? "odds"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const provider = quote?.provider?.displayName ?? quote?.provider?.name ?? "Odds";
    const fallbackLink = quote?.link?.href ?? null;
    const outcomes = [
      [home?.team?.displayName, lastPrice(quote?.moneyline?.home) ?? lastPrice(quote?.homeTeamOdds), "home", lastLink(quote?.moneyline?.home, fallbackLink)],
      ["Draw", lastPrice(quote?.moneyline?.draw) ?? lastPrice(quote?.drawOdds), "draw", lastLink(quote?.moneyline?.draw ?? quote?.drawOdds, fallbackLink)],
      [away?.team?.displayName, lastPrice(quote?.moneyline?.away) ?? lastPrice(quote?.awayTeamOdds), "away", lastLink(quote?.moneyline?.away, fallbackLink)],
    ];
    for (const [selection, price, id, deepLink] of outcomes) {
      const odds = decimalFromAmerican(price);
      if (!selection || !odds) continue;
      rows.push({ marketId: `${competition.id}-moneyline`, market: "Match result", selectionId: id, selection, line: null, odds, source, provider, deepLink });
    }
    const line = lastLine(quote?.total?.over, quote?.overUnder);
    for (const [selection, price, id, deepLink] of [
      [`Over ${line}`, lastPrice(quote?.total?.over) ?? quote?.overOdds, "over", lastLink(quote?.total?.over, fallbackLink)],
      [`Under ${line}`, lastPrice(quote?.total?.under) ?? quote?.underOdds, "under", lastLink(quote?.total?.under, fallbackLink)],
    ]) {
      const odds = decimalFromAmerican(price);
      if (!Number.isFinite(line) || !odds) continue;
      rows.push({ marketId: `${competition.id}-total`, market: "Total goals", selectionId: id, selection, line, odds, source, provider, deepLink });
    }
    for (const [team, side, id] of [[home, quote?.pointSpread?.home, "home"], [away, quote?.pointSpread?.away, "away"]]) {
      const handicap = lastLine(side);
      const odds = decimalFromAmerican(lastPrice(side));
      if (!team?.team?.displayName || handicap == null || !odds) continue;
      const signed = handicap > 0 ? `+${handicap}` : String(handicap);
      rows.push({ marketId: `${competition.id}-handicap`, market: "Handicap", selectionId: id, selection: `${team.team.displayName} ${signed}`, line: handicap, odds, source, provider, deepLink: lastLink(side, fallbackLink) });
    }
  }
  return rows;
}

export function normalizeEspnEvent(raw, leagueFallback = {}, source = "espn-public-json") {
  const competition = raw?.competitions?.[0] ?? {};
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((item) => item.homeAway === "home") ?? competitors[0];
  const away = competitors.find((item) => item.homeAway === "away") ?? competitors[1];
  const state = String(raw?.status?.type?.state ?? "pre").toLowerCase();
  const completed = Boolean(raw?.status?.type?.completed);
  const statusName = String(raw?.status?.type?.name ?? "").toLowerCase();
  const status = statusName.includes("postpon") ? "POSTPONED" : statusName.includes("cancel") ? "CANCELLED" : completed || state === "post" ? "FINISHED" : state === "in" ? "LIVE" : "SCHEDULED";
  const eventId = String(raw?.id ?? competition?.id ?? "");
  const league = raw?.league ?? leagueFallback;
  return {
    id: eventId ? `espn-${eventId}` : "",
    providerId: eventId,
    source,
    league: {
      id: String(league?.id ?? league?.slug ?? ""),
      name: league?.name ?? league?.abbreviation ?? "Football",
      country: league?.country ?? "",
      season: String(raw?.season?.year ?? ""),
    },
    round: raw?.week?.text ?? raw?.seasonType?.name ?? "",
    kickoff: new Date(raw?.date ?? competition?.date ?? 0).toISOString(),
    status,
    homeTeam: { id: `espn-${home?.team?.id ?? ""}`, name: home?.team?.displayName ?? home?.team?.name ?? "Home", shortName: home?.team?.abbreviation ?? "", logo: home?.team?.logo ?? null },
    awayTeam: { id: `espn-${away?.team?.id ?? ""}`, name: away?.team?.displayName ?? away?.team?.name ?? "Away", shortName: away?.team?.abbreviation ?? "", logo: away?.team?.logo ?? null },
    homeScore: scoreValue(home),
    awayScore: scoreValue(away),
    odds: normalizeOdds(competition, home, away),
  };
}

export async function collectEspn({ historyDays = 35, futureDays = 7, leagues = DEFAULT_LEAGUES } = {}) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + futureDays);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - historyDays);
  const dates = `${compactDate(start)}-${compactDate(end)}`;
  const events = new Map();
  const warnings = [];

  for (const league of leagues) {
    try {
      const payload = await fetchJson(`${BASE}/${league}/scoreboard?dates=${dates}&limit=1000`);
      const leagueInfo = payload?.leagues?.[0] ?? { slug: league, name: league };
      for (const raw of payload?.events ?? []) {
        const event = normalizeEspnEvent(raw, leagueInfo);
        if (event.id && Number.isFinite(new Date(event.kickoff).getTime())) events.set(event.id, event);
      }
    } catch (error) {
      warnings.push(`${league}: ${error instanceof Error ? error.message : "fetch failed"}`);
    }
    await wait(100);
  }
  return { events: [...events.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff)), warnings };
}

export async function collectEspnGlobal({ historyDays = 14, futureDays = 7 } = {}) {
  const now = new Date();
  const events = new Map();
  const warnings = [];
  for (let offset = -historyDays; offset <= futureDays; offset += 1) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    const day = compactDate(date);
    try {
      const payload = await fetchJson(`${BASE}/all/scoreboard?dates=${day}&limit=1000`, { timeoutMs: 20_000 });
      const rows = Array.isArray(payload?.events) ? payload.events : [];
      for (const raw of rows) {
        const event = normalizeEspnGlobalEvent(raw);
        if (event.id && Number.isFinite(new Date(event.kickoff).getTime())) events.set(event.id, event);
      }
      if (rows.length >= 1000) warnings.push(`${day}: the source reached its 1,000-match daily limit`);
    } catch (error) {
      warnings.push(`${day}: ${error instanceof Error ? error.message : "fetch failed"}`);
    }
    await wait(120);
  }
  return { events: [...events.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff)), warnings };
}
