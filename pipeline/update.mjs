import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectEspn, collectEspnGlobal } from "./lib/espn.mjs";
import { attachOdds, buildModelContext, scoreEvent } from "./lib/model.mjs";
import { buildTicket } from "./lib/tickets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "data/public/snapshot.json");
const now = new Date();
const futureDays = Number(process.env.FUTURE_DAYS ?? 7);
const horizon = now.getTime() + futureDays * 24 * 60 * 60 * 1000;
const previous = JSON.parse(await readFile(output, "utf8"));
const historical = await readFile(resolve(root, "data/history/football-data.json"), "utf8").then(JSON.parse).catch(() => ({ events: [], generatedAt: null, warnings: ["Historical cache unavailable"] }));

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
  await writeFile(output, `${JSON.stringify(stale, null, 2)}\n`);
  process.exit(0);
}

const upcoming = events.filter((event) => event.status === "SCHEDULED" && new Date(event.kickoff) > now && new Date(event.kickoff).getTime() < horizon);
const liveFixtures = events.filter((event) => event.status === "LIVE").sort((a, b) => a.kickoff.localeCompare(b.kickoff));
const modelContext = buildModelContext(events, now.toISOString());
const predictions = upcoming.flatMap((event) => attachOdds(scoreEvent(event, events, modelContext), event.odds));
const tickets = ["SAFE_2", "VALUE_5", "BALANCED_10", "HIGH_RISK", "LONGSHOT_21"].map((category) => buildTicket(predictions, category, upcoming)).filter(Boolean);
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
      : dataQuality === "LOW"
      ? `Limited team history · cautious estimate uses league scoring priors${pick.quotedOdds ? " and the available market price" : ""}`
      : `Modelled from ${historyMatches} recent team performances · expected goals ${pick.expectedHomeGoals}-${pick.expectedAwayGoals}`,
  });
  predictionKeys.add(identity);
  fixturePickCounts.set(pick.fixtureId, (fixturePickCounts.get(pick.fixtureId) ?? 0) + 1);
  return true;
}

const fallbackKeys = new Set(["DC_1X", "DC_X2", "OVER_1_5", "UNDER_3_5", "MATCH_HOME", "MATCH_AWAY"]);
const eligiblePicks = [...predictions]
  .filter((item) => {
    const fixture = fixtureMap.get(item.fixtureId);
    const history = (item.factors?.homePlayed ?? 0) + (item.factors?.awayPlayed ?? 0);
    if (!fixture || !publicMarketKeys.test(item.key)) return false;
    if (item.quotedOdds) return item.confidence >= 0.44 && (item.edge == null || item.edge >= -0.08);
    return isPriorityLeague(fixture.league) && history >= 6 && item.confidence >= 0.58 && item.fairOdds <= 4;
  })
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
    return item.key === key && fixture && isPriorityLeague(fixture.league) && history >= 4 && item.confidence >= threshold;
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

function settleSelection(selection, fixture) {
  if (!fixture || fixture.status !== "FINISHED" || fixture.homeScore == null || fixture.awayScore == null) return "PENDING";
  const home = Number(fixture.homeScore);
  const away = Number(fixture.awayScore);
  const total = home + away;
  const key = selection.market.key;
  const line = Number(selection.market.line);
  if (key === "MATCH_HOME") return home > away ? "WON" : "LOST";
  if (key === "MATCH_DRAW") return home === away ? "WON" : "LOST";
  if (key === "MATCH_AWAY") return away > home ? "WON" : "LOST";
  if (key === "DC_1X") return home >= away ? "WON" : "LOST";
  if (key === "DC_X2") return away >= home ? "WON" : "LOST";
  if (key === "DC_12") return home !== away ? "WON" : "LOST";
  if (key === "DNB_HOME") return home === away ? "VOID" : home > away ? "WON" : "LOST";
  if (key === "DNB_AWAY") return home === away ? "VOID" : away > home ? "WON" : "LOST";
  if (key === "BTTS_YES") return home > 0 && away > 0 ? "WON" : "LOST";
  if (key === "BTTS_NO") return home === 0 || away === 0 ? "WON" : "LOST";
  if (key.startsWith("HOME_OVER_")) return home > line ? "WON" : "LOST";
  if (key.startsWith("HOME_UNDER_")) return home < line ? "WON" : "LOST";
  if (key.startsWith("AWAY_OVER_")) return away > line ? "WON" : "LOST";
  if (key.startsWith("AWAY_UNDER_")) return away < line ? "WON" : "LOST";
  if (key.startsWith("OVER_")) return total > line ? "WON" : "LOST";
  if (key.startsWith("UNDER_")) return total < line ? "WON" : "LOST";
  return "UNVERIFIED";
}

function trackTicket(ticket) {
  const selections = ticket.selections.map((selection) => ({ ...selection, result: settleSelection(selection, eventMap.get(selection.fixtureId)) }));
  const lost = selections.filter((selection) => selection.result === "LOST").length;
  const pending = selections.filter((selection) => selection.result === "PENDING").length;
  const unverified = selections.filter((selection) => selection.result === "UNVERIFIED").length;
  const status = lost ? "LOST" : pending ? "PENDING" : unverified ? "CHECK_BOOKMAKER" : "WON";
  return {
    ...ticket,
    status,
    settledAt: status === "PENDING" ? null : now.toISOString(),
    wonLegs: selections.filter((selection) => selection.result === "WON").length,
    lostLegs: lost,
    voidLegs: selections.filter((selection) => selection.result === "VOID").length,
    selections,
  };
}

const ticketArchive = new Map();
for (const ticket of [...tickets, ...(previous.tickets ?? []), ...(previous.ticketHistory ?? [])]) {
  if (!ticketArchive.has(ticket.id)) ticketArchive.set(ticket.id, ticket);
}
const ticketHistory = [...ticketArchive.values()].map(trackTicket)
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
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`OddsAura updated: ${upcoming.length} fixtures, ${predictions.length} model scores, ${predictedPicks.length} selectable predictions, ${tickets.length} tickets`);
