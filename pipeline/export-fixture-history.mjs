import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archives = ["football-data.json", "global-football.json"];
const byYear = new Map();
const seen = new Set();
for (const file of archives) {
  const payload = await readFile(resolve(root, "data/history", file), "utf8").then(JSON.parse).catch(() => ({ events: [] }));
  for (const event of payload.events ?? []) {
    if (event.status !== "FINISHED" || !event.kickoff || !event.league?.name || !event.homeTeam?.name || !event.awayTeam?.name) continue;
    const year = new Date(event.kickoff).getUTCFullYear();
    if (!Number.isFinite(year)) continue;
    const key = `${event.kickoff.slice(0, 10)}|${event.league.id ?? event.league.name}|${event.homeTeam.name}|${event.awayTeam.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const leagueKey = String(event.league.id ?? event.league.name).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const rows = byYear.get(year) ?? new Map();
    const leagueRows = rows.get(leagueKey) ?? [];
    leagueRows.push({
      id: String(event.id),
      league: { id: event.league.id, name: event.league.name, country: event.league.country },
      kickoff: event.kickoff,
      status: event.status,
      homeTeam: { id: event.homeTeam.id, name: event.homeTeam.name },
      awayTeam: { id: event.awayTeam.id, name: event.awayTeam.name },
      homeScore: event.homeScore ?? null,
      awayScore: event.awayScore ?? null,
      odds: [],
    });
    rows.set(leagueKey, leagueRows);
    byYear.set(year, rows);
  }
}

const output = resolve(root, "data/public/fixture-history");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const years = [];
for (const [year, competitions] of byYear) {
  const leagueFiles = [];
  for (const [key, events] of competitions) {
    events.sort((left, right) => left.kickoff.localeCompare(right.kickoff));
    const file = `${key}.json`;
    await writeFile(resolve(output, `${year}-${file}`), `${JSON.stringify({ year, fixtures: events })}\n`);
    leagueFiles.push({ file, league: events[0].league });
  }
  years.push({ year, leagues: leagueFiles });
}
await writeFile(resolve(output, "index.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), years })}\n`);
console.log(`Exported ${[...byYear.values()].reduce((sum, leagues) => sum + [...leagues.values()].reduce((yearTotal, events) => yearTotal + events.length, 0), 0)} historical fixtures across ${byYear.size} years.`);
