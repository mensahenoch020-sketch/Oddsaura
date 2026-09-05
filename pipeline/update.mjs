import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectEspn, collectEspnGlobal } from "./lib/espn.mjs";
import { attachOdds, buildModelContext, scoreEvent } from "./lib/model.mjs";
import { buildTicket } from "./lib/tickets.mjs";
import { trackTicket } from "./lib/settlement.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "data/public/snapshot.json");
const now = new Date();
const futureDays = Number(process.env.FUTURE_DAYS ?? 7);
const horizon = now.getTime() + futureDays * 24 * 60 * 60 * 1000;
const previous = JSON.parse(await readFile(output, "utf8"));
const historical = await readFile(resolve(root, "data/history/football-data.json"), "utf8").then(JSON.parse).catch(() => ({ events: [], generatedAt: null, warnings: ["Historical cache unavailable"] }));

async function writePublicSnapshots(snapshot) {
  const modelPerformance = await readFile(resolve(root, "data/public/model-performance.json"), "utf8").then(JSON.parse).catch(() => null);
  const withoutOdds = (fixture) => ({ ...fixture, odds: [] });
  // Route payloads intentionally omit modelling fields their screens never
  // read. This keeps first paint quick on mobile without reducing the full
  // operational snapshot or the selectable bookmaker markets.
  const slimPick = (source) => {
    const pick = { ...source };
    for (const key of ["reasoning", "providerDeepLink"]) delete pick[key];
    return pick;
  };
  const routePicks = (snapshot.predictedPicks ?? []).map(slimPick);
  const common = {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    stale: snapshot.stale,
    status: snapshot.status,
    message: snapshot.message,
    metrics: snapshot.metrics,
  };
  const scoped = {
    builder: { ...common, predictedPicks: routePicks },
    matches: { ...common, fixtures: (snapshot.fixtures ?? []).map(withoutOdds), liveFixtures: (snapshot.liveFixtures ?? []).map(withoutOdds), predictedPicks: routePicks },
    daily: { ...common, tickets: snapshot.tickets ?? [] },
    results: { ...common, recentResults: (snapshot.recentResults ?? []).map(withoutOdds), tickets: snapshot.tickets ?? [], ticketHistory: snapshot.ticketHistory ?? [], modelPerformance },
    admin: { ...common, sources: snapshot.sources ?? [], tickets: snapshot.tickets ?? [], marketCatalog: snapshot.marketCatalog ?? [] },
  };
  await mkdir(dirname(output), { recursive: true });
  await Promise.all([
    writeFile(output, `${JSON.stringify(snapshot)}\n`),
    ...Object.entries(scoped).map(([name, payload]) => writeFile(resolve(root, `data/public/${name}.json`), `${JSON.stringify(payload)}\n`)),
  ]);
}

let events = [];
let warnings = [];
let sourceStatus = "error";
let message = "The source did not respond; serving the last successful snapshot.";
const sources = [];
const eventIdentity = (event) => `${event.league?.id ?? event.league?.name}-${event.kickoff.slice(0, 10)}-${event.homeTeam.id}-${event.awayTeam.id}`;
const [historyRun, globalRun] = await Promise.allSettled([
  collectEspn({ historyDays: Number(process.env.ESPN_HISTORY_DAYS ?? 35), futureDays }),
  collectEspnGlobal({ historyDays: Number(process.env.GLOBAL_HISTORY_DAYS ?? 14), futureDays }),
]);
const eventMap = new Map();
for (const event of historical.events ?? []) eventMap.set(eventIdentity(event), event);
sources.push({ id: "football-data-history", label: "Multi-season historical results and odds", status: historical.events?.length ? "healthy" : "waiting", lastSuccessAt: historical.generatedAt ?? null, records: historical.events?.length ?? 0, warnings: (historical.warnings ?? []).slice(0, 8) });
if (historyRun.status === "fulfilled" && historyRun.value.events.length) {
  for (const event of historyRun.value.events) eventMap.set(eventIdentity(event), event);
  warnings.push(...historyRun.value.warnings);
  sources.push({ id: "espn-league-history", label: "ESPN league history", status: historyRun.value.warnings.length ? "partial" : "healthy", lastSuccessAt: now.toISOString(), records: historyRun.value.events.length, warnings: historyRun.value.warnings.slice(0, 8) });
} else {
  const reason = historyRun.status === "rejected" ? String(historyRun.reason) : "The league history feed returned no matches";
  sources.push({ id: "espn-league-history", label: "ESPN league history", status: "error", lastSuccessAt: null, records: 0, warnings: [reason] });
}
if (globalRun.status === "fulfilled" && globalRun.value.events.length) {
  for (const event of globalRun.value.events) {
    const identity = eventIdentity(event);
    const existing = eventMap.get(identity);
    // The dedicated league feed carries the real competition name; the
    // global board often replaces it with a generic country label. Preserve
    // the richer record and only fill prices that it did not already have.
    eventMap.set(identity, existing ? { ...existing, ...event, odds: event.odds.length ? event.odds : existing.odds } : event);
  }
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
  await writePublicSnapshots(stale);
  process.exit(0);
}

const upcoming = events.filter((event) => event.status === "SCHEDULED" && new Date(event.kickoff) > now && new Date(event.kickoff).getTime() < horizon);
const liveFixtures = events.filter((event) => event.status === "LIVE").sort((a, b) => a.kickoff.localeCompare(b.kickoff));
const modelContext = buildModelContext(events, now.toISOString());
const predictions = upcoming.flatMap((event) => attachOdds(scoreEvent(event, events, modelContext), event.odds));
// Higher-risk and 21-leg tickets are withheld until the forward paper ledger
// proves them. Reaching a large target is never more important than evidence.
const ticketCategories = ["SAFE_2", "VALUE_5", "BALANCED_10"];
const attemptedTickets = ticketCategories.map((category) => ({ category, ticket: buildTicket(predictions, category, upcoming) }));
const tickets = attemptedTickets.flatMap((attempt) => attempt.ticket ? [attempt.ticket] : []);
const fixtureMap = new Map(upcoming.map((fixture) => [fixture.id, fixture]));
const predictedPicks = [];
const predictionKeys = new Set();
const fixturePickCounts = new Map();
const maxSelectablePicks = Math.min(5000, Math.max(2500, upcoming.length * 3));
const publicMarketKeys = /^(MATCH_(HOME|DRAW|AWAY)|ONE_UP_(HOME|AWAY)|TWO_UP_(HOME|AWAY)|DC_(1X|X2|12)|OVER_|UNDER_|BTTS_(YES|NO)|HOME_(OVER|UNDER)_|AWAY_(OVER|UNDER)_|DNB_(HOME|AWAY))/;
const priorityLeaguePattern = /eng\.1|english premier|premier league|esp\.1|la ?liga|ita\.1|italian serie a|\bserie a\b|ger\.1|bundesliga|fra\.1|ligue 1|ned\.1|eredivisie|ksa\.1|saudi pro|por\.1|primeira liga|liga portugal|tur\.1|super lig|süper lig/i;
function isPriorityLeague(league) {
  return priorityLeaguePattern.test(`${league?.id ?? ""} ${league?.name ?? ""} ${league?.country ?? ""}`);
}
function publishPick(pick, fixture) {
  const identity = `${pick.fixtureId}-${pick.providerMarketId ?? pick.key}-${pick.providerSelectionId ?? pick.selection}`;
  const fixtureLimit = isPriorityLeague(fixture.league) ? 6 : 3;
  if (predictionKeys.has(identity) || (fixturePickCounts.get(pick.fixtureId) ?? 0) >= fixtureLimit || predictedPicks.length >= maxSelectablePicks) return false;
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
    reasoning: pick.key.startsWith("ONE_UP_") || pick.key.startsWith("TWO_UP_")
      ? `Early-payout version of the modelled match result · confidence remains based on the full-time result, not a promised early lead`
      : `Bookmaker baseline ${Math.round((pick.marketProbability ?? 0) * 100)}% · OddsAura model difference ${Math.round((pick.modelMarketGap ?? 0) * 100)} points · ${historyMatches} recent team performances`,
  });
  predictionKeys.add(identity);
  fixturePickCounts.set(pick.fixtureId, (fixturePickCounts.get(pick.fixtureId) ?? 0) + 1);
  return true;
}

const eligiblePicks = [...predictions]
  .filter((item) => {
    const fixture = fixtureMap.get(item.fixtureId);
    const history = (item.factors?.homePlayed ?? 0) + (item.factors?.awayPlayed ?? 0);
    if (!fixture || !publicMarketKeys.test(item.key) || !item.quotedOdds || item.marketProbability == null) return false;
    return history >= 6 && item.confidence >= .5 && (item.modelMarketGap ?? 1) <= .15 && (item.expectedValue ?? -1) >= -.1;
  })
  .sort((a, b) => (b.confidence + Math.max(0, b.edge ?? 0)) - (a.confidence + Math.max(0, a.edge ?? 0)));
const bestEligibleByFixture = new Map();
for (const pick of eligiblePicks) {
  if (!bestEligibleByFixture.has(pick.fixtureId)) bestEligibleByFixture.set(pick.fixtureId, pick);
}

// Publish one market-confirmed pick per qualifying fixture first. A fixture
// with no trustworthy price or model agreement is deliberately a no-bet.
for (const [fixtureId, primary] of bestEligibleByFixture) {
  const fixture = fixtureMap.get(fixtureId);
  if (primary && fixture) publishPick(primary, fixture);
}

// Make the requested market families genuinely discoverable instead of
// allowing high-probability totals to crowd every other option off the board.
const showcaseKeys = [
  "ONE_UP_HOME", "ONE_UP_AWAY", "TWO_UP_HOME", "TWO_UP_AWAY", "MATCH_HOME", "MATCH_DRAW", "MATCH_AWAY",
  "DC_1X", "DC_X2", "DC_12", "OVER_1_5", "OVER_2_5", "UNDER_2_5", "UNDER_3_5",
  "BTTS_YES", "BTTS_NO", "HOME_OVER_0_5", "AWAY_OVER_0_5", "DNB_HOME", "DNB_AWAY",
];
for (const key of showcaseKeys) {
  const strongest = predictions.filter((item) => {
    const fixture = fixtureMap.get(item.fixtureId);
    const history = (item.factors?.homePlayed ?? 0) + (item.factors?.awayPlayed ?? 0);
    const threshold = key.startsWith("ONE_UP_") || key.startsWith("TWO_UP_") ? .38 : .48;
    return item.key === key && fixture && item.quotedOdds && item.marketProbability != null && isPriorityLeague(fixture.league)
      && history >= 6 && item.confidence >= threshold && (item.modelMarketGap ?? 1) <= .15;
  }).sort((a, b) => b.confidence - a.confidence).slice(0, 12);
  for (const pick of strongest) {
    const fixture = fixtureMap.get(pick.fixtureId);
    if (fixture) publishPick(pick, fixture);
  }
}

// After universal fixture coverage, publish the strongest additional markets.
for (const pick of eligiblePicks) {
  const fixture = fixtureMap.get(pick.fixtureId);
  if (fixture) publishPick(pick, fixture);
}
const watchlist = [];
const usedFixtures = new Set();
for (const pick of [...predictions].filter((item) => item.confidence >= 0.62 && item.quotedOdds && item.marketProbability != null && (item.modelMarketGap ?? 1) <= .12).sort((a, b) => b.confidence - a.confidence)) {
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
])].sort();

const ticketArchive = new Map();
for (const ticket of [...tickets, ...(previous.tickets ?? []), ...(previous.ticketHistory ?? [])]) {
  if (!ticketArchive.has(ticket.id)) ticketArchive.set(ticket.id, ticket);
}
const ticketHistory = [...ticketArchive.values()].map((ticket) => trackTicket(ticket, events, now.toISOString()))
  .sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")))
  .slice(0, 90);
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
    noBetCategories: attemptedTickets.filter((attempt) => !attempt.ticket).map((attempt) => attempt.category),
    strategyVersion: "reverse-market-v1",
  },
  fixtures: upcoming,
  liveFixtures: liveFixtures.slice(0, 200),
  recentResults: events.filter((event) => event.status === "FINISHED").slice(-500),
  predictedPicks,
  marketCatalog,
  watchlist,
  tickets,
  ticketHistory,
};
await writePublicSnapshots(snapshot);
console.log(`OddsAura updated: ${upcoming.length} fixtures, ${predictions.length} model scores, ${predictedPicks.length} selectable predictions, ${tickets.length} tickets`);
