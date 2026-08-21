import { fetchJson, wait } from "./http.mjs";

const BASES = [...new Set([
  process.env.SOFASCORE_BASE_URL,
  "https://api.sofascore.com/api/v1",
  "https://www.sofascore.com/api/v1",
].filter(Boolean))];
const image = (teamId) => `https://api.sofascore.app/api/v1/team/${teamId}/image`;
const isoDate = (date) => date.toISOString().slice(0, 10);

async function sofaJson(path, options = {}) {
  const failures = [];
  for (const base of BASES) {
    try {
      return await fetchJson(`${base}${path}`, {
        ...options,
        headers: {
          origin: "https://www.sofascore.com",
          referer: "https://www.sofascore.com/",
          ...options.headers,
        },
      });
    } catch (error) {
      failures.push(`${new URL(base).hostname}: ${error instanceof Error ? error.message : "fetch failed"}`);
    }
  }
  throw new Error(failures.join(" | "));
}

function scoreValue(score) {
  if (!score || typeof score !== "object") return null;
  for (const key of ["normaltime", "current", "display", "period1"]) {
    if (Number.isFinite(Number(score[key]))) return Number(score[key]);
  }
  return null;
}

export function normalizeEvent(event) {
  const statusType = String(event?.status?.type ?? "notstarted").toLowerCase();
  const status = statusType === "finished" ? "FINISHED" : ["inprogress", "halftime"].includes(statusType) ? "LIVE" : statusType === "canceled" ? "CANCELLED" : statusType === "postponed" ? "POSTPONED" : "SCHEDULED";
  const homeId = String(event?.homeTeam?.id ?? "");
  const awayId = String(event?.awayTeam?.id ?? "");
  return {
    id: String(event?.id ?? ""),
    providerId: String(event?.id ?? ""),
    source: "sofascore-public-json",
    league: {
      id: String(event?.tournament?.uniqueTournament?.id ?? event?.tournament?.id ?? ""),
      name: event?.tournament?.uniqueTournament?.name ?? event?.tournament?.name ?? "Football",
      country: event?.tournament?.category?.name ?? "",
      season: event?.season?.name ?? "",
    },
    round: event?.roundInfo?.name ?? (event?.roundInfo?.round ? `Round ${event.roundInfo.round}` : ""),
    kickoff: new Date(Number(event?.startTimestamp ?? 0) * 1000).toISOString(),
    status,
    homeTeam: { id: homeId, name: event?.homeTeam?.name ?? "Home", shortName: event?.homeTeam?.nameCode ?? "", logo: homeId ? image(homeId) : null },
    awayTeam: { id: awayId, name: event?.awayTeam?.name ?? "Away", shortName: event?.awayTeam?.nameCode ?? "", logo: awayId ? image(awayId) : null },
    homeScore: scoreValue(event?.homeScore),
    awayScore: scoreValue(event?.awayScore),
    odds: [],
  };
}

function decimalOdd(choice) {
  for (const key of ["decimalValue", "decimal", "odds", "value"]) {
    const value = Number(choice?.[key]);
    if (Number.isFinite(value) && value > 1) return value;
  }
  const fraction = String(choice?.fractionalValue ?? "");
  const [a, b] = fraction.split("/").map(Number);
  if (Number.isFinite(a) && Number.isFinite(b) && b > 0) return 1 + a / b;
  return null;
}

export function normalizeOdds(payload) {
  const markets = Array.isArray(payload?.markets) ? payload.markets : Array.isArray(payload) ? payload : [];
  const rows = [];
  for (const market of markets) {
    const outcomes = market?.choices ?? market?.outcomes ?? market?.selections ?? [];
    for (const outcome of outcomes) {
      const odds = decimalOdd(outcome);
      if (!odds) continue;
      rows.push({
        marketId: String(market?.id ?? market?.marketId ?? market?.marketName ?? market?.name ?? ""),
        market: market?.marketName ?? market?.name ?? market?.market ?? "Other market",
        selectionId: String(outcome?.id ?? outcome?.sourceId ?? outcome?.name ?? ""),
        selection: outcome?.name ?? outcome?.label ?? outcome?.title ?? "Selection",
        line: outcome?.point ?? outcome?.handicap ?? market?.line ?? null,
        odds: Number(odds.toFixed(2)),
        source: "sofascore-public-json",
      });
    }
  }
  return rows;
}

export async function collectSofaScore({ historyDays = 10, futureDays = 3, oddsLimit = 28 } = {}) {
  const now = new Date();
  const events = new Map();
  const warnings = [];
  for (let offset = -historyDays; offset <= futureDays; offset += 1) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    try {
      const payload = await sofaJson(`/sport/football/scheduled-events/${isoDate(date)}`);
      for (const raw of payload?.events ?? []) {
        const event = normalizeEvent(raw);
        if (event.id) events.set(event.id, event);
      }
    } catch (error) {
      warnings.push(`${isoDate(date)}: ${error instanceof Error ? error.message : "fetch failed"}`);
    }
    await wait(180);
  }

  const upcoming = [...events.values()]
    .filter((event) => event.status === "SCHEDULED" && new Date(event.kickoff).getTime() < Date.now() + 72 * 60 * 60 * 1000)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    .slice(0, oddsLimit);

  for (const event of upcoming) {
    try {
      const payload = await sofaJson(`/event/${event.providerId}/odds/1/all`, { retries: 1 });
      event.odds = normalizeOdds(payload);
    } catch (error) {
      warnings.push(`odds ${event.id}: ${error instanceof Error ? error.message : "fetch failed"}`);
    }
    await wait(240);
  }

  return { events: [...events.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff)), warnings };
}
