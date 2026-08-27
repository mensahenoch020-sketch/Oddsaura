import { fetchText } from "./http.mjs";
import { canonicalLeagueId, canonicalTeamId } from "./identity.mjs";

const BASE = "https://www.football-data.co.uk/mmz4281";
const leagues = [
  { code: "E0", id: "eng.1", name: "Premier League", country: "England" },
  { code: "SP1", id: "esp.1", name: "La Liga", country: "Spain" },
  { code: "I1", id: "ita.1", name: "Serie A", country: "Italy" },
  { code: "D1", id: "ger.1", name: "Bundesliga", country: "Germany" },
  { code: "F1", id: "fra.1", name: "Ligue 1", country: "France" },
  { code: "N1", id: "ned.1", name: "Eredivisie", country: "Netherlands" },
  { code: "P1", id: "por.1", name: "Primeira Liga", country: "Portugal" },
  { code: "T1", id: "tur.1", name: "Süper Lig", country: "Türkiye" },
];

export function parseCsv(input) {
  const rows = [];
  let row = []; let value = ""; let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function kickoff(row) {
  const [day, month, yearText] = String(row.Date ?? "").split(/[\/\-]/).map(Number);
  const year = yearText < 100 ? 2000 + yearText : yearText;
  const [hour = 15, minute = 0] = String(row.Time || "15:00").split(":").map(Number);
  if (![day, month, year, hour, minute].every(Number.isFinite)) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString();
}

function historicalOdds(row, matchId, homeName, awayName) {
  const home = number(row.AvgH) ?? number(row.B365H) ?? number(row.MaxH);
  const draw = number(row.AvgD) ?? number(row.B365D) ?? number(row.MaxD);
  const away = number(row.AvgA) ?? number(row.B365A) ?? number(row.MaxA);
  return [[homeName, home, "home"], ["Draw", draw, "draw"], [awayName, away, "away"]]
    .filter(([, odds]) => odds && odds > 1)
    .map(([selection, odds, id]) => ({ marketId: `${matchId}-historical-1x2`, market: "Match result", selectionId: id, selection, line: null, odds, source: "football-data-historical" }));
}

export function normalizeFootballDataRow(row, league, season) {
  const date = kickoff(row);
  const homeName = String(row.HomeTeam ?? "").trim();
  const awayName = String(row.AwayTeam ?? "").trim();
  const homeScore = number(row.FTHG); const awayScore = number(row.FTAG);
  if (!date || !homeName || !awayName || homeScore == null || awayScore == null) return null;
  const homeId = canonicalTeamId(homeName); const awayId = canonicalTeamId(awayName);
  const id = `fd-${league.code}-${date.slice(0, 10)}-${homeId}-${awayId}`;
  return {
    id,
    source: "football-data-historical",
    league: { id: canonicalLeagueId(league.id), name: league.name, country: league.country, season },
    kickoff: date,
    status: "FINISHED",
    homeTeam: { id: homeId, name: homeName, shortName: "", logo: null },
    awayTeam: { id: awayId, name: awayName, shortName: "", logo: null },
    homeScore,
    awayScore,
    stats: {
      halfTimeHome: number(row.HTHG), halfTimeAway: number(row.HTAG),
      homeShots: number(row.HS), awayShots: number(row.AS), homeShotsOnTarget: number(row.HST), awayShotsOnTarget: number(row.AST),
      homeCorners: number(row.HC), awayCorners: number(row.AC), homeYellow: number(row.HY), awayYellow: number(row.AY), homeRed: number(row.HR), awayRed: number(row.AR),
    },
    odds: historicalOdds(row, id, homeName, awayName),
  };
}

export function seasonCodes(count = 6, now = new Date()) {
  const start = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return Array.from({ length: count }, (_, index) => {
    const year = start - index;
    return { code: `${String(year).slice(-2)}${String(year + 1).slice(-2)}`, label: `${year}-${String(year + 1).slice(-2)}` };
  });
}

export async function collectFootballDataHistory({ seasons = 6, competitions = leagues } = {}) {
  const events = []; const warnings = [];
  for (const season of seasonCodes(seasons)) {
    for (const league of competitions) {
      try {
        const csv = await fetchText(`${BASE}/${season.code}/${league.code}.csv`, { retries: 1, timeoutMs: 20_000 });
        for (const row of parseCsv(csv)) {
          const event = normalizeFootballDataRow(row, league, season.label);
          if (event) events.push(event);
        }
      } catch (error) {
        warnings.push(`${season.label} ${league.name}: ${error instanceof Error ? error.message : "fetch failed"}`);
      }
    }
  }
  return { events: [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff)), warnings };
}

export const FOOTBALL_DATA_LEAGUES = leagues;
