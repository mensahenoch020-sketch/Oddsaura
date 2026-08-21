import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectEspn, collectEspnGlobal } from "./lib/espn.mjs";
import { attachOdds, scoreEvent } from "./lib/model.mjs";
import { buildTicket } from "./lib/tickets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "data/public/snapshot.json");
const now = new Date();
const futureDays = Number(process.env.FUTURE_DAYS ?? 7);
const horizon = now.getTime() + futureDays * 24 * 60 * 60 * 1000;
const previous = JSON.parse(await readFile(output, "utf8"));

let events = [];
let warnings = [];
let sourceStatus = "error";
let message = "The source did not respond; serving the last successful snapshot.";
const sources = [];
const [historyRun, globalRun] = await Promise.allSettled([
  collectEspn({ historyDays: Number(process.env.ESPN_HISTORY_DAYS ?? 35), futureDays }),
  collectEspnGlobal({ historyDays: Number(process.env.GLOBAL_HISTORY_DAYS ?? 14), futureDays }),
]);
const eventMap = new Map();
if (historyRun.status === "fulfilled" && historyRun.value.events.length) {
  for (const event of historyRun.value.events) eventMap.set(event.id, event);
  warnings.push(...historyRun.value.warnings);
  sources.push({ id: "espn-league-history", label: "ESPN league history", status: historyRun.value.warnings.length ? "partial" : "healthy", lastSuccessAt: now.toISOString(), records: historyRun.value.events.length, warnings: historyRun.value.warnings.slice(0, 8) });
} else {
  const reason = historyRun.status === "rejected" ? String(historyRun.reason) : "The league history feed returned no matches";
  sources.push({ id: "espn-league-history", label: "ESPN league history", status: "error", lastSuccessAt: null, records: 0, warnings: [reason] });
}
if (globalRun.status === "fulfilled" && globalRun.value.events.length) {
  for (const event of globalRun.value.events) eventMap.set(event.id, event);
  warnings.push(...globalRun.value.warnings);
  sources.push({ id: "espn-global-json", label: "ESPN global match board", status: globalRun.value.warnings.length ? "partial" : "healthy", lastSuccessAt: now.toISOString(), records: globalRun.value.events.length, warnings: globalRun.value.warnings.slice(0, 8) });
} else {
  const reason = globalRun.status === "rejected" ? String(globalRun.reason) : "The global match board returned no matches";
  sources.push({ id: "espn-global-json", label: "ESPN global match board", status: "error", lastSuccessAt: null, records: 0, warnings: [reason] });
}
events = [...eventMap.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
const healthySources = sources.filter((source) => ["healthy", "partial"].includes(source.status)).length;
sourceStatus = healthySources === sources.length && !warnings.length ? "healthy" : healthySources ? "partial" : "error";
message = healthySources ? "Global fixtures, team badges, recent results and model-ready history are updating without paid API keys." : message;

if (!events.length) {
  const stale = { ...previous, generatedAt: now.toISOString(), stale: true, status: "stale", message, sources };
  await writeFile(output, `${JSON.stringify(stale, null, 2)}\n`);
  process.exit(0);
}

const upcoming = events.filter((event) => event.status === "SCHEDULED" && new Date(event.kickoff) > now && new Date(event.kickoff).getTime() < horizon);
const liveFixtures = events.filter((event) => event.status === "LIVE").sort((a, b) => a.kickoff.localeCompare(b.kickoff));
const predictions = upcoming.flatMap((event) => attachOdds(scoreEvent(event, events), event.odds));
const tickets = ["SAFE", "BALANCED", "HIGH_RISK"].map((category) => buildTicket(predictions, category, upcoming)).filter(Boolean);
const fixtureMap = new Map(upcoming.map((fixture) => [fixture.id, fixture]));
const predictedPicks = [];
const predictionKeys = new Set();
const fixturePickCounts = new Map();
const maxSelectablePicks = Math.max(2000, upcoming.length);
function publishPick(pick, fixture) {
  const identity = `${pick.fixtureId}-${pick.providerMarketId ?? pick.key}-${pick.providerSelectionId ?? pick.selection}`;
  if (predictionKeys.has(identity) || (fixturePickCounts.get(pick.fixtureId) ?? 0) >= 5 || predictedPicks.length >= maxSelectablePicks) return false;
  const historyMatches = (pick.factors?.homePlayed ?? 0) + (pick.factors?.awayPlayed ?? 0);
  const dataQuality = historyMatches >= 14 ? "HIGH" : historyMatches >= 6 ? "MEDIUM" : "LOW";
  const tier = dataQuality === "LOW" ? "HIGH_RISK" : pick.confidence >= 0.72 && (pick.quotedOdds ?? 99) <= 1.8 ? "SAFE" : pick.confidence >= 0.62 ? "BALANCED" : "HIGH_RISK";
  predictedPicks.push({
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
    edge: pick.edge,
    tier,
    dataQuality,
    historyMatches,
    oddsSource: pick.oddsSource,
    oddsProvider: pick.oddsProvider,
    providerMarketId: pick.providerMarketId,
    providerSelectionId: pick.providerSelectionId,
    providerDeepLink: pick.providerDeepLink,
    reasoning: dataQuality === "LOW"
      ? `Limited team history · cautious estimate uses league scoring priors${pick.quotedOdds ? " and the available market price" : ""}`
      : `Modelled from ${historyMatches} recent team performances · expected goals ${pick.expectedHomeGoals}-${pick.expectedAwayGoals}`,
  });
  predictionKeys.add(identity);
  fixturePickCounts.set(pick.fixtureId, (fixturePickCounts.get(pick.fixtureId) ?? 0) + 1);
  return true;
}

const fallbackKeys = new Set(["DC_1X", "DC_X2", "OVER_1_5", "UNDER_3_5", "MATCH_HOME", "MATCH_AWAY"]);
const eligiblePicks = [...predictions]
  .filter((item) => item.quotedOdds && item.confidence >= 0.44 && (item.edge == null || item.edge >= -0.08))
  .sort((a, b) => (b.confidence + Math.max(0, b.edge ?? 0)) - (a.confidence + Math.max(0, a.edge ?? 0)));
const bestEligibleByFixture = new Map();
for (const pick of eligiblePicks) {
  if (!bestEligibleByFixture.has(pick.fixtureId)) bestEligibleByFixture.set(pick.fixtureId, pick);
}

// Coverage comes first: every upcoming fixture receives one selectable model
// pick before extra markets are added. Fixtures without history or a public
// bookmaker price use a cautious, clearly-labelled probability-only pick.
for (const fixture of upcoming) {
  const primary = bestEligibleByFixture.get(fixture.id)
    ?? predictions.filter((item) => item.fixtureId === fixture.id && fallbackKeys.has(item.key)).sort((a, b) => b.confidence - a.confidence)[0];
  if (primary) publishPick(primary, fixture);
}

// After universal fixture coverage, publish the strongest additional markets.
for (const pick of eligiblePicks) {
  const fixture = fixtureMap.get(pick.fixtureId);
  if (fixture) publishPick(pick, fixture);
}
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
  version: 4,
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
    selectablePredictions: predictedPicks.length,
    publishedTickets: tickets.length,
  },
  fixtures: upcoming,
  liveFixtures: liveFixtures.slice(0, 200),
  recentResults: events.filter((event) => event.status === "FINISHED").slice(-500),
  predictedPicks,
  marketCatalog,
  watchlist,
  tickets,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`OddsAura updated: ${upcoming.length} fixtures, ${predictions.length} model scores, ${predictedPicks.length} selectable predictions, ${tickets.length} tickets`);
