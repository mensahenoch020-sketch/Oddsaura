import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSofaScore } from "./lib/sofascore.mjs";
import { collectEspn } from "./lib/espn.mjs";
import { attachOdds, scoreEvent } from "./lib/model.mjs";
import { buildTicket } from "./lib/tickets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "data/public/snapshot.json");
const now = new Date();
const previous = JSON.parse(await readFile(output, "utf8"));

let events = [];
let warnings = [];
let sourceStatus = "error";
let message = "The source did not respond; serving the last successful snapshot.";
const sources = [];
try {
  const collected = await collectSofaScore({
    historyDays: Number(process.env.HISTORY_DAYS ?? 10),
    futureDays: Number(process.env.FUTURE_DAYS ?? 3),
    oddsLimit: Number(process.env.ODDS_MATCH_LIMIT ?? 28),
  });
  events = collected.events;
  warnings = collected.warnings;
  if (!events.length) throw new Error(collected.warnings[0] ?? "The source returned no football events");
  sourceStatus = warnings.length ? "partial" : "healthy";
  message = warnings.length ? "Updated with partial source coverage." : "Fixtures, odds and predictions updated automatically.";
  sources.push({ id: "sofascore-public-json", label: "SofaScore public JSON", status: sourceStatus, lastSuccessAt: now.toISOString(), records: events.length, warnings: warnings.slice(0, 8) });
} catch (error) {
  const reason = error instanceof Error ? error.message : "SofaScore collection failed";
  console.error(reason);
  sources.push({ id: "sofascore-public-json", label: "SofaScore public JSON", status: "error", lastSuccessAt: null, records: 0, warnings: [reason].slice(0, 8) });
  try {
    const collected = await collectEspn({
      historyDays: Number(process.env.ESPN_HISTORY_DAYS ?? 35),
      futureDays: Number(process.env.FUTURE_DAYS ?? 3),
    });
    events = collected.events;
    warnings = collected.warnings;
    if (!events.length) throw new Error("The fallback returned no football events");
    sourceStatus = warnings.length ? "partial" : "healthy";
    message = "SofaScore was unavailable, so OddsAura switched to its keyless ESPN fixture fallback.";
    sources.push({ id: "espn-public-json", label: "ESPN public JSON fallback", status: sourceStatus, lastSuccessAt: now.toISOString(), records: events.length, warnings: warnings.slice(0, 8) });
  } catch (fallbackError) {
    const fallbackReason = fallbackError instanceof Error ? fallbackError.message : "ESPN fallback failed";
    console.error(fallbackReason);
    sources.push({ id: "espn-public-json", label: "ESPN public JSON fallback", status: "error", lastSuccessAt: null, records: 0, warnings: [fallbackReason].slice(0, 8) });
  }
}

if (!events.length) {
  const stale = { ...previous, generatedAt: now.toISOString(), stale: true, status: "stale", message, sources };
  await writeFile(output, `${JSON.stringify(stale, null, 2)}\n`);
  process.exit(0);
}

const upcoming = events.filter((event) => event.status === "SCHEDULED" && new Date(event.kickoff) > now && new Date(event.kickoff).getTime() < now.getTime() + 72 * 60 * 60 * 1000);
const predictions = upcoming.flatMap((event) => attachOdds(scoreEvent(event, events), event.odds));
const tickets = ["SAFE", "BALANCED", "HIGH_RISK"].map((category) => buildTicket(predictions, category, upcoming)).filter(Boolean);
const fixtureMap = new Map(upcoming.map((fixture) => [fixture.id, fixture]));
const watchlist = [];
const usedFixtures = new Set();
for (const pick of [...predictions].filter((item) => item.confidence >= 0.62).sort((a, b) => b.confidence - a.confidence)) {
  if (usedFixtures.has(pick.fixtureId) || watchlist.length >= 12) continue;
  const fixture = fixtureMap.get(pick.fixtureId);
  if (!fixture) continue;
  watchlist.push({
    id: `${pick.fixtureId}-${pick.key}`,
    fixtureId: pick.fixtureId,
    league: fixture.league,
    kickoff: fixture.kickoff,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    market: { key: pick.key, name: pick.name, category: pick.category, line: pick.line ?? null },
    selection: pick.selection,
    probability: pick.probability,
    confidence: pick.confidence,
    fairOdds: pick.fairOdds,
    quotedOdds: pick.quotedOdds,
    oddsSource: pick.oddsSource,
  });
  usedFixtures.add(pick.fixtureId);
}
const marketCatalog = [...new Set([
  ...predictions.map((item) => item.name),
  ...events.flatMap((event) => event.odds.map((odd) => odd.market)),
  "Corners", "Cards", "Shots and player props",
])].sort();
const snapshot = {
  version: 2,
  generatedAt: now.toISOString(),
  stale: false,
  status: sourceStatus,
  message,
  sources,
  metrics: {
    fixtures: upcoming.length,
    live: events.filter((event) => event.status === "LIVE").length,
    completed: events.filter((event) => event.status === "FINISHED").length,
    pricedMarkets: events.reduce((sum, event) => sum + event.odds.length, 0),
    predictions: predictions.length,
    publishedTickets: tickets.length,
  },
  fixtures: upcoming.slice(0, 80),
  recentResults: events.filter((event) => event.status === "FINISHED").slice(-1000),
  marketCatalog,
  watchlist,
  tickets,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`OddsAura updated: ${upcoming.length} fixtures, ${predictions.length} predictions, ${watchlist.length} watchlist picks, ${tickets.length} tickets`);
