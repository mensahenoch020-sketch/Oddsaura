import { fetchJson, wait } from "./http.mjs";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const DEFAULT_LEAGUES = [
  "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "uefa.champions",
  "uefa.europa", "uefa.europa.conf", "ned.1", "por.1", "sco.1",
  "bel.1", "tur.1", "usa.1", "mex.1", "bra.1", "arg.1",
];

const compactDate = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");

function decimalFromAmerican(value) {
  const american = Number(value);
  if (!Number.isFinite(american) || american === 0) return null;
  return Number((american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american)).toFixed(2));
}

function scoreValue(competitor) {
  const value = Number(competitor?.score?.value ?? competitor?.score);
  return Number.isFinite(value) ? value : null;
}

function normalizeOdds(competition, home, away) {
  const quotes = Array.isArray(competition?.odds) ? competition.odds : [];
  const rows = [];
  for (const quote of quotes) {
    const source = `espn-${quote?.provider?.name ?? "odds"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const outcomes = [
      [home?.team?.displayName, quote?.homeTeamOdds?.moneyLine ?? quote?.homeTeamOdds?.value, "home"],
      ["Draw", quote?.drawOdds?.moneyLine ?? quote?.drawOdds?.value, "draw"],
      [away?.team?.displayName, quote?.awayTeamOdds?.moneyLine ?? quote?.awayTeamOdds?.value, "away"],
    ];
    for (const [selection, price, id] of outcomes) {
      const odds = decimalFromAmerican(price);
      if (!selection || !odds) continue;
      rows.push({ marketId: `${competition.id}-moneyline`, market: "Match result", selectionId: id, selection, line: null, odds, source });
    }
    const line = Number(quote?.overUnder);
    for (const [selection, price, id] of [
      [`Over ${line}`, quote?.overOdds, "over"],
      [`Under ${line}`, quote?.underOdds, "under"],
    ]) {
      const odds = decimalFromAmerican(price);
      if (!Number.isFinite(line) || !odds) continue;
      rows.push({ marketId: `${competition.id}-total`, market: "Total goals", selectionId: id, selection, line, odds, source });
    }
  }
  return rows;
}

export function normalizeEspnEvent(raw, leagueFallback = {}) {
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
    source: "espn-public-json",
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

export async function collectEspn({ historyDays = 35, futureDays = 3, leagues = DEFAULT_LEAGUES } = {}) {
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
