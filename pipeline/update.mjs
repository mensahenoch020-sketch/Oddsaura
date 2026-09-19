import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectEspn, collectEspnGlobal } from "./lib/espn.mjs";
import { buildModelContext, scoreEvent } from "./lib/model.mjs";
import { collectMarkets, priceModelPredictions } from "./lib/bookmaker-markets.mjs";
import { buildTicket } from "./lib/tickets.mjs";
import { resultForSelection, settleSelection, trackTicket } from "./lib/settlement.mjs";
import { canonicalEventIdentity, normalizeEventIdentity } from "./lib/identity.mjs";
import { historyEvidence } from "./lib/history-coverage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "data/public/snapshot.json");
const now = new Date();
const futureDays = Number(process.env.FUTURE_DAYS ?? 7);
const horizon = now.getTime() + futureDays * 24 * 60 * 60 * 1000;
const lagosDay = new Date(now.getTime() + 60 * 60_000);
const lagosTodayStart = Date.UTC(lagosDay.getUTCFullYear(), lagosDay.getUTCMonth(), lagosDay.getUTCDate()) - 60 * 60_000;
const lagosTodayEnd = lagosTodayStart + 86_400_000;
const previous = JSON.parse(await readFile(output, "utf8"));
const historical = await readFile(resolve(root, "data/history/football-data.json"), "utf8").then(JSON.parse).catch(() => ({ events: [], generatedAt: null, warnings: ["Historical cache unavailable"] }));
const globalHistorical = await readFile(resolve(root, "data/history/global-football.json"), "utf8").then(JSON.parse).catch(() => ({ events: [], generatedAt: null, warnings: ["Worldwide historical backfill pending"] }));
const espnLeagueCatalog = await readFile(resolve(root, "data/history/espn-leagues.json"), "utf8").then(JSON.parse).catch(() => ({ leagues: {} }));
const engineParameters = await readFile(resolve(root, "data/public/model-parameters.json"), "utf8").then(JSON.parse).catch(() => null);
const sourcePolicy = await readFile(resolve(root, "data/source-authorizations.json"), "utf8").then(JSON.parse).catch(() => ({ sources: {} }));

async function writePublicSnapshots(snapshot) {
  const modelPerformance = await readFile(resolve(root, "data/public/model-performance.json"), "utf8").then(JSON.parse).catch(() => null);
  const slimFixture = (fixture) => ({
    id: fixture.id,
    providerId: fixture.providerId,
    source: fixture.source,
    league: fixture.league,
    kickoff: fixture.kickoff,
    status: fixture.status,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeScore: fixture.homeScore ?? null,
    awayScore: fixture.awayScore ?? null,
    odds: [],
  });
  // Route payloads intentionally omit modelling fields their screens never
  // read. This keeps first paint quick on mobile without reducing the full
  // operational snapshot or the selectable bookmaker markets.
  const slimPick = (source) => {
    const pick = { ...source };
    for (const key of ["reasoning", "providerDeepLink"]) delete pick[key];
    return pick;
  };
  const routePicks = (snapshot.predictedPicks ?? []).map(slimPick);
  const expansionCandidates = snapshot.expansionCandidates ?? [];
  const operationalSnapshot = { ...snapshot };
  delete operationalSnapshot.expansionCandidates;
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
    matches: { ...common, fixtures: (snapshot.fixtures ?? []).map(slimFixture), liveFixtures: (snapshot.liveFixtures ?? []).map(slimFixture), predictedPicks: routePicks },
    daily: { ...common, tickets: snapshot.tickets ?? [], watchlist: snapshot.watchlist ?? [] },
    results: { ...common, recentResults: (snapshot.recentResults ?? []).slice(-300).map(slimFixture), tickets: snapshot.tickets ?? [], ticketHistory: (snapshot.ticketHistory ?? []).slice(0, 40), paperTrials: snapshot.paperTrials ?? [], modelPerformance },
    admin: { ...common, sources: snapshot.sources ?? [], tickets: snapshot.tickets ?? [], marketCatalog: snapshot.marketCatalog ?? [], paperTrials: snapshot.paperTrials ?? [] },
  };
  await mkdir(dirname(output), { recursive: true });
  await Promise.all([
    writeFile(output, `${JSON.stringify(operationalSnapshot)}\n`),
    writeFile(resolve(root, "data/public/expansion.json"), `${JSON.stringify({ version: snapshot.version, generatedAt: snapshot.generatedAt, candidates: expansionCandidates })}\n`),
    ...Object.entries(scoped).map(([name, payload]) => writeFile(resolve(root, `data/public/${name}.json`), `${JSON.stringify(payload)}\n`)),
  ]);
}

let events = [];
let warnings = [];
let sourceStatus = "error";
let message = "The source did not respond; serving the last successful snapshot.";
const sources = [];
// The same ESPN fixture can arrive through the league feed, global board and
// prior snapshot with slightly different competition metadata. Prefer its
// stable fixture id so one real match never becomes duplicate predictions.
const eventIdentity = canonicalEventIdentity;
const [historyRun, globalRun] = await Promise.allSettled([
  collectEspn({ historyDays: Number(process.env.ESPN_HISTORY_DAYS ?? 35), futureDays }),
  collectEspnGlobal({ historyDays: Number(process.env.GLOBAL_HISTORY_DAYS ?? 14), futureDays, leagueCatalog: espnLeagueCatalog.leagues ?? {} }),
]);
const eventMap = new Map();
for (const sourceEvent of [...(historical.events ?? []), ...(globalHistorical.events ?? [])]) {
  const event = normalizeEventIdentity(sourceEvent);
  eventMap.set(eventIdentity(event), event);
}
// A temporary live-feed outage must not erase the last successful fixture
// board. Fresh source rows replace these records whenever collection works.
for (const sourceEvent of [...(previous.fixtures ?? []), ...(previous.liveFixtures ?? []), ...(previous.recentResults ?? [])]) {
  const event = normalizeEventIdentity(sourceEvent);
  if (event?.kickoff && event?.homeTeam?.id && event?.awayTeam?.id) eventMap.set(eventIdentity(event), event);
}
const footballDataAuthorization = sourcePolicy.sources?.["football-data.co.uk"]?.status === "owner-confirmed";
sources.push({ id: "football-data-history", label: "Authorized multi-season historical results and odds", status: historical.events?.length && footballDataAuthorization ? "healthy" : historical.events?.length ? "partial" : "waiting", lastSuccessAt: historical.generatedAt ?? null, records: historical.events?.length ?? 0, warnings: [...(!footballDataAuthorization ? ["Source authorization is not recorded"] : []), ...(historical.warnings ?? [])].slice(0, 8) });
sources.push({ id: "global-football-history", label: "Worldwide historical results", status: globalHistorical.events?.length ? "healthy" : "waiting", lastSuccessAt: globalHistorical.generatedAt ?? null, records: globalHistorical.events?.length ?? 0, warnings: (globalHistorical.warnings ?? []).slice(0, 8) });
if (historyRun.status === "fulfilled" && historyRun.value.events.length) {
  for (const sourceEvent of historyRun.value.events) {
    const event = normalizeEventIdentity(sourceEvent);
    eventMap.set(eventIdentity(event), event);
  }
  warnings.push(...historyRun.value.warnings);
  sources.push({ id: "espn-league-history", label: "ESPN league history", status: historyRun.value.warnings.length ? "partial" : "healthy", lastSuccessAt: now.toISOString(), records: historyRun.value.events.length, warnings: historyRun.value.warnings.slice(0, 8) });
} else {
  const reason = historyRun.status === "rejected" ? String(historyRun.reason) : "The league history feed returned no matches";
  sources.push({ id: "espn-league-history", label: "ESPN league history", status: "error", lastSuccessAt: null, records: 0, warnings: [reason] });
}
if (globalRun.status === "fulfilled" && globalRun.value.events.length) {
  for (const sourceEvent of globalRun.value.events) {
    const event = normalizeEventIdentity(sourceEvent);
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
const modelContext = buildModelContext(events, now.toISOString(), engineParameters);
const modelPredictions = upcoming.flatMap((event) => scoreEvent(event, events, modelContext));
const bookmakerIds = ['sportybet', 'betpawa', 'betking', 'betway', 'bet9ja'];
// Collect only complete market families that the prediction engine can
// evaluate and publish. The user-disabled 2.5 total is deliberately absent.
const collectibleMarketKeys = /^(MATCH_(HOME|DRAW|AWAY)|DC_(1X|X2|12)|DNB_(HOME|AWAY)|BTTS_(YES|NO)|(HOME|AWAY)_(OVER|UNDER)_(0_5|1_5)|(OVER|UNDER)_(1_5|3_5))$/;
const marketFixtureLimit = Math.max(1, Math.min(250, Number(process.env.BOOKMAKER_FIXTURE_LIMIT ?? 200)));
const modelByFixture = new Map();
for (const prediction of modelPredictions) modelByFixture.set(prediction.fixtureId, [...(modelByFixture.get(prediction.fixtureId) ?? []), prediction]);
const collectionFixtures = upcoming.filter(event => Date.parse(event.kickoff) > Date.now() + 30 * 60_000 && historyEvidence(modelByFixture.get(event.id)?.[0] ?? {}).ready)
  // Cover today's complete qualified board before spending collection time on
  // later days. Smaller leagues are no longer displaced by a week of major-
  // league fixtures.
  .sort((a, b) => Number(!(Date.parse(a.kickoff) >= lagosTodayStart && Date.parse(a.kickoff) < lagosTodayEnd))
    - Number(!(Date.parse(b.kickoff) >= lagosTodayStart && Date.parse(b.kickoff) < lagosTodayEnd))
    || a.kickoff.localeCompare(b.kickoff)).slice(0, marketFixtureLimit);
let marketCollection;
try {
  marketCollection = await collectMarkets(collectionFixtures.map(event => (modelByFixture.get(event.id) ?? []).filter(pick => collectibleMarketKeys.test(pick.key)).map(pick => ({ fixtureId: event.id, homeTeam: event.homeTeam.name, awayTeam: event.awayTeam.name, kickoff: event.kickoff, marketKey: pick.key, marketName: pick.name, selection: pick.selection, line: pick.line ?? null }))));
} catch (error) {
  marketCollection = { generatedAt: new Date().toISOString(), quotes: [], providers: bookmakerIds.map(provider => ({ provider, status: 'UNAVAILABLE', fixturesRequested: collectionFixtures.length, fixturesAttempted: 0, fixturesQuoted: 0, marketsQuoted: [], errors: [{ message: String(error) }] })) };
}
await writeFile(resolve(root, 'data/public/bookmaker-markets.json'), JSON.stringify(marketCollection) + '\n');
for (const coverage of marketCollection.providers) sources.push({ id: `bookmaker-${coverage.provider}`, label: `${coverage.provider} live markets`, status: coverage.status === 'AVAILABLE' ? 'healthy' : coverage.status === 'PARTIAL' ? 'partial' : 'error', records: marketCollection.quotes.filter(q => q.provider === coverage.provider).length, lastSuccessAt: coverage.fixturesQuoted ? marketCollection.completedAt : null, warnings: [`${coverage.fixturesQuoted}/${coverage.fixturesRequested} sampled fixtures quoted; ${coverage.marketsQuoted.length} mapped selections`, ...coverage.errors.slice(0, 3).map(e => e.message)] });
if (marketCollection.providers.some(p => p.status !== 'AVAILABLE')) sourceStatus = 'partial';
const predictions = priceModelPredictions(modelPredictions, marketCollection.quotes);
// Higher-risk and 21-leg tickets are withheld until the forward paper ledger
// proves them. Reaching a large target is never more important than evidence.
const ticketCategories = ["SAFE_2", "VALUE_5"];
const dailyFixtures = upcoming.filter((event) => {
  const kickoff = Date.parse(event.kickoff);
  return kickoff >= lagosTodayStart && kickoff < lagosTodayEnd;
});
const dailyFixtureIds = new Set(dailyFixtures.map((fixture) => fixture.id));
const dailyPredictions = predictions.filter((pick) => dailyFixtureIds.has(pick.fixtureId));
const attemptedTickets = bookmakerIds.flatMap(provider => ticketCategories.map(category => {
  const ticket = buildTicket(dailyPredictions.filter(pick => pick.oddsProvider === provider), category, dailyFixtures);
  return { category: `${provider}:${category}`, ticket: ticket ? { ...ticket, id: `${provider}-${ticket.id}`, title: `${provider} ${ticket.title}`, oddsProvider: provider } : null };
}));
const tickets = attemptedTickets.flatMap((attempt) => attempt.ticket ? [attempt.ticket] : []);
const fixtureMap = new Map(upcoming.map((fixture) => [fixture.id, fixture]));
const predictedPicks = [];
const predictionKeys = new Set();
const fixturePickCounts = new Map();
const maxSelectablePicks = Math.min(5000, Math.max(2500, upcoming.length * 3));
const publicMarketKeys = /^(MATCH_(HOME|DRAW|AWAY)|DC_(1X|X2|12)|DNB_(HOME|AWAY)|BTTS_YES|(HOME|AWAY)_OVER_(0_5|1_5)|OVER_1_5|UNDER_3_5)$/;
function isPriorityLeague(league) {
  return /eng\.1|english premier|premier league|esp\.1|la ?liga|ita\.1|italian serie a|\bserie a\b|ger\.1|bundesliga|fra\.1|ligue 1|ned\.1|eredivisie|ksa\.1|saudi pro|por\.1|primeira liga|liga portugal|tur\.1|super lig|süper lig/i.test(`${league?.id ?? ""} ${league?.name ?? ""} ${league?.country ?? ""}`);
}
function marketConfidenceFloor(key) {
  if (/^(HOME|AWAY)_CLEAN$/.test(key)) return .64;
  if (/^HCP_3WAY_/.test(key)) return .58;
  if (key === "BTTS_YES") return .58;
  if (/^(HOME|AWAY)_OVER_0_5$/.test(key)) return .64;
  if (/^(HOME|AWAY)_OVER_1_5$/.test(key)) return .58;
  return .5;
}
function publishPick(pick, fixture) {
  const identity = `${pick.oddsProvider}-${pick.fixtureId}-${pick.providerMarketId ?? pick.key}-${pick.providerSelectionId ?? pick.selection}-${pick.line ?? "none"}`;
  const providerFixture = `${pick.oddsProvider}:${pick.fixtureId}`;
  const fixtureLimit = isPriorityLeague(fixture.league) ? 6 : 3;
  if (!publicMarketKeys.test(pick.key) || predictionKeys.has(identity) || (fixturePickCounts.get(providerFixture) ?? 0) >= fixtureLimit || predictedPicks.length >= maxSelectablePicks) return false;
  const evidence = historyEvidence(pick);
  const historyMatches = evidence.total;
  const dataQuality = evidence.minimum >= 40 && Math.min(evidence.homeRecent, evidence.awayRecent) >= 12 ? "HIGH" : evidence.ready ? "MEDIUM" : "LOW";
  const tier = dataQuality === "LOW" ? "HIGH_RISK" : pick.confidence >= 0.72 && (pick.quotedOdds ?? 99) <= 1.8 ? "SAFE" : pick.confidence >= 0.62 ? "BALANCED" : "HIGH_RISK";
  const lineId = pick.line == null ? "" : `-${String(pick.line).replace("-", "minus-").replace(".", "-")}`;
  predictedPicks.push({
    id: `${pick.oddsProvider}-${pick.fixtureId}-${pick.key}${lineId}`,
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
    homeHistoryMatches: evidence.homeLong,
    awayHistoryMatches: evidence.awayLong,
    recentHistoryMatches: evidence.homeRecent + evidence.awayRecent,
    oddsSource: pick.oddsSource,
    oddsProvider: pick.oddsProvider,
    quoteObservedAt: pick.quoteObservedAt,
    providerEventId: pick.providerEventId,
    providerMarketId: pick.providerMarketId,
    providerSelectionId: pick.providerSelectionId,
    providerSpecifier: pick.providerSpecifier,
    providerDeepLink: pick.providerDeepLink,
    expectedValue: pick.expectedValue,
    marketProbability: pick.marketProbability,
    modelProbability: pick.modelProbability,
    modelMarketGap: pick.modelMarketGap,
    engineVersion: pick.engineVersion,
    calibrated: pick.calibrated,
    calibrationSamples: pick.calibrationSamples,
    calibrationGain: pick.calibrationGain,
    marketModelWeight: pick.marketModelWeight,
    marketWeightLearned: pick.marketWeightLearned,
    marketWeightSamples: pick.marketWeightSamples,
    priceStatus: "QUOTED",
    reasoning: `${pick.engineVersion ?? "structural model"} · ${evidence.homeLong} ${fixture.homeTeam.name} matches + ${evidence.awayLong} ${fixture.awayTeam.name} matches · ${evidence.homeRecent + evidence.awayRecent} recent performances · bookmaker baseline ${pick.marketProbability == null ? "not available" : `${Math.round(pick.marketProbability * 100)}%`} · model contribution ${Math.round((pick.marketModelWeight ?? 0) * 100)}% · ${pick.calibrated ? `${pick.calibrationSamples ?? 0} calibration observations` : "calibration fallback"}`,
  });
  predictionKeys.add(identity);
  fixturePickCounts.set(providerFixture, (fixturePickCounts.get(providerFixture) ?? 0) + 1);
  return true;
}

const eligiblePicks = [...predictions]
  .filter((item) => {
    const fixture = fixtureMap.get(item.fixtureId);
    if (!fixture || !publicMarketKeys.test(item.key) || !item.quotedOdds || item.marketProbability == null) return false;
    return historyEvidence(item).ready && item.confidence >= marketConfidenceFloor(item.key) && (item.modelMarketGap ?? 1) <= .1 && (item.edge ?? -1) >= 0;
  })
  .sort((a, b) => (b.confidence + Math.max(0, b.edge ?? 0)) - (a.confidence + Math.max(0, a.edge ?? 0)));
const bestEligibleByFixture = new Map();
for (const pick of eligiblePicks) {
  const key = `${pick.oddsProvider}:${pick.fixtureId}`;
  if (!bestEligibleByFixture.has(key)) bestEligibleByFixture.set(key, pick);
}

// Publish one market-confirmed pick per qualifying fixture first. A fixture
// with no trustworthy price or model agreement is deliberately a no-bet.
for (const primary of bestEligibleByFixture.values()) {
  const fixture = fixtureMap.get(primary.fixtureId);
  if (primary && fixture) publishPick(primary, fixture);
}

// Make the requested market families genuinely discoverable instead of
// allowing high-probability totals to crowd every other option off the board.
const showcaseKeys = [
  "MATCH_HOME", "MATCH_DRAW", "MATCH_AWAY",
  "DC_1X", "DC_X2", "DC_12", "OVER_1_5", "UNDER_3_5", "DNB_HOME", "DNB_AWAY",
  "BTTS_YES", "HOME_OVER_0_5", "AWAY_OVER_0_5", "HOME_OVER_1_5", "AWAY_OVER_1_5",
];
for (const provider of bookmakerIds) for (const key of showcaseKeys) {
  const strongest = predictions.filter((item) => {
    const fixture = fixtureMap.get(item.fixtureId);
    return item.oddsProvider === provider && item.key === key && fixture && item.quotedOdds && item.marketProbability != null && isPriorityLeague(fixture.league)
      && historyEvidence(item).ready && item.confidence >= Math.max(.48, marketConfidenceFloor(item.key)) && (item.modelMarketGap ?? 1) <= .1 && (item.edge ?? -1) >= 0;
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
function watchlistFamily(key) {
  if (/^MATCH_/.test(key)) return "RESULT";
  if (/^DC_/.test(key)) return "DOUBLE_CHANCE";
  if (/^DNB_/.test(key)) return "DRAW_NO_BET";
  if (/^BTTS_/.test(key)) return "BTTS";
  if (/^(HOME|AWAY)_(OVER|UNDER)_/.test(key)) return "TEAM_GOALS";
  if (/^(OVER|UNDER)_/.test(key)) return "TOTAL_GOALS";
  if (/_(CLEAN|WIN_NIL)$/.test(key)) return "CLEAN_SHEET";
  if (/^HCP_/.test(key)) return "HANDICAP";
  return "OTHER";
}
const watchlistCandidates = [...predictions]
  .filter((item) => dailyFixtureIds.has(item.fixtureId) && publicMarketKeys.test(item.key) && historyEvidence(item).ready && item.confidence >= 0.62 && item.quotedOdds >= 1.1 && item.quotedOdds <= 3 && item.marketProbability != null && (item.modelMarketGap ?? 1) <= .1 && (item.edge ?? -1) >= 0)
  .sort((a, b) => (b.confidence + Math.max(0, b.edge ?? 0)) - (a.confidence + Math.max(0, a.edge ?? 0)));
const watchlistFamilies = [...new Set(watchlistCandidates.map((pick) => watchlistFamily(pick.key)))];
const watchlistBuckets = new Map(watchlistFamilies.map((family) => [family, watchlistCandidates.filter((pick) => watchlistFamily(pick.key) === family)]));
const orderedWatchlistCandidates = [];
let watchlistAdded = true;
while (watchlistAdded) {
  watchlistAdded = false;
  for (const family of watchlistFamilies) {
    const next = watchlistBuckets.get(family)?.shift();
    if (!next) continue;
    orderedWatchlistCandidates.push(next);
    watchlistAdded = true;
  }
}
const watchlist = [];
const usedFixtures = new Set();
for (const pick of orderedWatchlistCandidates) {
  if (usedFixtures.has(pick.fixtureId) || watchlist.length >= 12) continue;
  const fixture = fixtureMap.get(pick.fixtureId);
  if (!fixture) continue;
  watchlist.push({
    id: `${pick.oddsProvider}-${pick.fixtureId}-${pick.key}${pick.line == null ? "" : `-${String(pick.line).replace("-", "minus-").replace(".", "-")}`}`,
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
    oddsProvider: pick.oddsProvider,
    quoteObservedAt: pick.quoteObservedAt,
    providerEventId: pick.providerEventId,
    providerMarketId: pick.providerMarketId,
    providerSelectionId: pick.providerSelectionId,
    providerSpecifier: pick.providerSpecifier,
  });
  usedFixtures.add(pick.fixtureId);
}
const marketCatalog = [...new Set([
  ...predictions.map((item) => item.name),
  ...events.flatMap((event) => event.odds.map((odd) => odd.market)),
])].sort();

// These model-scored candidates are not public recommendations and carry no
// invented odds. They allow an authenticated request to ask the selected
// bookmaker for fresh prices when the periodically priced pool is too small.
const expansionCandidates = modelPredictions.filter((pick) => {
  const fixture = fixtureMap.get(pick.fixtureId);
  return fixture && publicMarketKeys.test(pick.key) && historyEvidence(pick).ready
    && Date.parse(fixture.kickoff) > Date.now() + 30 * 60_000;
}).map((pick) => {
  const fixture = fixtureMap.get(pick.fixtureId);
  const evidence = historyEvidence(pick);
  return {
    id: `expand-${pick.fixtureId}-${pick.key}-${pick.line ?? "none"}`,
    fixtureId: pick.fixtureId,
    league: fixture.league,
    kickoff: fixture.kickoff,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    key: pick.key,
    name: pick.name,
    category: pick.category,
    line: pick.line ?? null,
    selection: pick.selection,
    probability: pick.probability,
    confidence: pick.confidence,
    fairOdds: pick.fairOdds,
    factors: pick.factors,
    dataQuality: evidence.minimum >= 40 && Math.min(evidence.homeRecent, evidence.awayRecent) >= 12 ? "HIGH" : "MEDIUM",
    historyMatches: evidence.total,
    homeHistoryMatches: evidence.homeLong,
    awayHistoryMatches: evidence.awayLong,
    recentHistoryMatches: evidence.homeRecent + evidence.awayRecent,
    engineVersion: pick.engineVersion,
    calibrated: pick.calibrated,
    calibrationSamples: pick.calibrationSamples,
    calibrationGain: pick.calibrationGain,
    marketModelWeight: pick.marketModelWeight,
    marketWeightLearned: pick.marketWeightLearned,
    marketWeightSamples: pick.marketWeightSamples,
  };
});

// Record forward predictions before kickoff, then settle them only when a
// final result becomes available. Existing settled rows are never rewritten.
const priorPaperTrials = Array.isArray(previous.paperTrials) ? previous.paperTrials : [];
const paperTrialMap = new Map(priorPaperTrials.map((trial) => [trial.id, trial]));
for (const trial of priorPaperTrials) {
  if (trial.result && trial.result !== "PENDING") continue;
  const fixture = resultForSelection(trial, events);
  const result = settleSelection(trial, fixture);
  if (result !== "PENDING") paperTrialMap.set(trial.id, { ...trial, result, settledAt: now.toISOString() });
}
const trialDay = now.toISOString().slice(0, 10);
const trialCandidates = [...predictions]
  .filter((pick) => {
    const fixture = fixtureMap.get(pick.fixtureId);
    return fixture && new Date(fixture.kickoff) > now && publicMarketKeys.test(pick.key) && historyEvidence(pick).ready
      && pick.quotedOdds && pick.marketProbability != null && pick.confidence >= .45
      && (pick.modelMarketGap ?? 1) <= .2 && (pick.expectedValue ?? -1) >= -.18;
  })
  .sort((a, b) => (b.confidence + Math.max(0, b.expectedValue ?? 0)) - (a.confidence + Math.max(0, a.expectedValue ?? 0)));
const trialFixtures = new Set();
for (const pick of trialCandidates) {
  if (trialFixtures.has(pick.fixtureId) || trialFixtures.size >= 12) continue;
  const fixture = fixtureMap.get(pick.fixtureId);
  if (!fixture) continue;
  const id = `${trialDay}-${pick.oddsProvider}-${pick.fixtureId}-${pick.key}-${pick.line ?? "none"}`;
  if (!paperTrialMap.has(id)) paperTrialMap.set(id, {
    id,
    fixtureId: pick.fixtureId,
    league: fixture.league,
    kickoff: fixture.kickoff,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    market: { key: pick.key, name: pick.name, category: pick.category, line: pick.line ?? null },
    selection: pick.selection,
    odds: pick.quotedOdds,
    oddsProvider: pick.oddsProvider,
    probability: pick.probability,
    confidence: pick.confidence,
    expectedValue: pick.expectedValue,
    marketProbability: pick.marketProbability,
    modelProbability: pick.modelProbability,
    modelMarketGap: pick.modelMarketGap,
    predictedAt: now.toISOString(),
    trialTier: "OBSERVATION",
    result: "PENDING",
    settledAt: null,
  });
  trialFixtures.add(pick.fixtureId);
}
const paperTrials = [...paperTrialMap.values()]
  .sort((a, b) => String(b.predictedAt).localeCompare(String(a.predictedAt)))
  .slice(0, 500);
const settledPaperTrials = paperTrials.filter((trial) => ["WON", "LOST", "VOID"].includes(trial.result));
const wonPaperTrials = settledPaperTrials.filter((trial) => trial.result === "WON");
const decidedPaperTrials = settledPaperTrials.filter((trial) => trial.result !== "VOID");
const paperProfit = decidedPaperTrials.reduce((sum, trial) => sum + (trial.result === "WON" ? trial.odds - 1 : -1), 0);
const paperMetrics = {
  recorded: paperTrials.length,
  settled: settledPaperTrials.length,
  won: wonPaperTrials.length,
  lost: decidedPaperTrials.length - wonPaperTrials.length,
  hitRate: decidedPaperTrials.length ? wonPaperTrials.length / decidedPaperTrials.length : null,
  flatStakeRoi: decidedPaperTrials.length ? paperProfit / decidedPaperTrials.length : null,
};

const ticketArchive = new Map();
for (const ticket of [...tickets, ...(previous.tickets ?? []), ...(previous.ticketHistory ?? [])]) {
  if (!ticketArchive.has(ticket.id)) ticketArchive.set(ticket.id, ticket);
}
const ticketHistory = [...ticketArchive.values()].map((ticket) => trackTicket(ticket, events, now.toISOString()))
  .sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")))
  .slice(0, 90);
const snapshot = {
  version: 5,
  generatedAt: now.toISOString(),
  stale: false,
  status: sourceStatus,
  message,
  sources,
  metrics: {
    fixtures: upcoming.length,
    live: events.filter((event) => event.status === "LIVE").length,
    completed: events.filter((event) => event.status === "FINISHED").length,
    pricedMarkets: marketCollection.quotes.length,
    modelScores: modelPredictions.length,
    predictions: predictions.length,
    selectablePredictions: predictedPicks.length,
    priceConfirmedPredictions: predictedPicks.filter((pick) => pick.quotedOdds != null).length,
    modelEstimatePredictions: 0,
    dailyFixtures: dailyFixtures.length,
    shotHistoryMatches: events.filter((event) => event.status === "FINISHED" && event.stats?.homeShots != null && event.stats?.awayShots != null && Number.isFinite(Number(event.stats.homeShots)) && Number.isFinite(Number(event.stats.awayShots))).length,
    publishedTickets: tickets.length,
    noBetCategories: attemptedTickets.filter((attempt) => !attempt.ticket).map((attempt) => attempt.category),
    lockedCategories: ["BALANCED_10", "LONGSHOT_21"],
    strategyVersion: engineParameters?.version ?? "ensemble-calibrated-v3-pending-training",
    historicalMatches: new Set([...(historical.events ?? []), ...(globalHistorical.events ?? [])].map(canonicalEventIdentity)).size,
    globalHistoricalMatches: globalHistorical.events?.length ?? 0,
    bookmakerFixtureLimit: marketFixtureLimit,
    qualifiedFixturesCollected: collectionFixtures.length,
    historyEligibleFixtures: upcoming.filter((event) => historyEvidence(modelByFixture.get(event.id)?.[0] ?? {}).ready).length,
    historyExcludedFixtures: upcoming.filter((event) => !historyEvidence(modelByFixture.get(event.id)?.[0] ?? {}).ready).length,
    historicalTeams: modelContext.teamEvents?.size ?? 0,
    teamsWithDeepHistory: [...(modelContext.teamEvents?.values() ?? [])].filter((matches) => matches.length >= 30).length,
    paperTrials: paperMetrics,
  },
  fixtures: upcoming,
  liveFixtures: liveFixtures.slice(0, 200),
  recentResults: events.filter((event) => event.status === "FINISHED").slice(-500),
  predictedPicks,
  marketCatalog,
  watchlist,
  tickets,
  ticketHistory,
  paperTrials,
  expansionCandidates,
};
await writePublicSnapshots(snapshot);
console.log(`OddsAura updated: ${upcoming.length} fixtures, ${predictions.length} model scores, ${predictedPicks.length} selectable predictions, ${tickets.length} tickets`);
