import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectFootballDataHistory } from "./lib/football-data.mjs";
import { collectEspnGlobal, collectEspnLeagueCatalog } from "./lib/espn.mjs";
import { backtestHistory } from "./lib/backtest.mjs";
import { canonicalEventIdentity, normalizeEventIdentity } from "./lib/identity.mjs";
import { summarizeHistory } from "./lib/history-coverage.mjs";
import { assertSourceAuthorized } from "./lib/source-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strategyVersion = "ensemble-calibrated-v3";
const historyPath = resolve(root, "data/history/football-data.json");
const globalHistoryPath = resolve(root, "data/history/global-football.json");
const leagueCatalogPath = resolve(root, "data/history/espn-leagues.json");
const performancePath = resolve(root, "data/public/model-performance.json");
const parametersPath = resolve(root, "data/public/model-parameters.json");
const coveragePath = resolve(root, "data/public/history-coverage.json");
const sourcePolicyPath = resolve(root, "data/source-authorizations.json");
const previous = await readFile(historyPath, "utf8").then(JSON.parse).catch(() => ({ events: [] }));
const previousGlobal = await readFile(globalHistoryPath, "utf8").then(JSON.parse).catch(() => ({ events: [] }));
const previousCatalog = await readFile(leagueCatalogPath, "utf8").then(JSON.parse).catch(() => ({ leagues: {}, warnings: [] }));
const previousPerformance = await readFile(performancePath, "utf8").then(JSON.parse).catch(() => ({}));
const sourcePolicy = await readFile(sourcePolicyPath, "utf8").then(JSON.parse);
const compactGlobalEvent = event => {
  const normalized = normalizeEventIdentity(event);
  return {
    id: normalized.id,
    providerId: normalized.providerId,
    source: normalized.source,
    league: normalized.league,
    kickoff: normalized.kickoff,
    status: normalized.status,
    homeTeam: normalized.homeTeam,
    awayTeam: normalized.awayTeam,
    homeScore: normalized.homeScore,
    awayScore: normalized.awayScore,
    odds: [],
  };
};
const dayText = value => new Date(value).toISOString().slice(0, 10);
const shiftDay = (value, amount) => {
  const date = new Date(`${dayText(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return dayText(date);
};
const mergeWorldwide = (...groups) => [...new Map(groups.flat().filter(event => event?.status === "FINISHED")
  .map(event => [canonicalEventIdentity(event), compactGlobalEvent(event)]))
  .values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff)).slice(-100_000);
if (process.env.HISTORY_USE_CACHE === "1") {
  if (!previous.events?.length) throw new Error("Cached history is unavailable.");
  const cached = [...new Map([...(previous.events ?? []), ...(previousGlobal.events ?? [])].map(event => [canonicalEventIdentity(event), normalizeEventIdentity(event)])).values()];
  const performance = backtestHistory(cached, { sampleSize: Number(process.env.BACKTEST_MATCHES ?? 2000) });
  const engineParameters = performance.engineParameters;
  delete performance.engineParameters;
  performance.strategyVersion = strategyVersion;
  const coverage = summarizeHistory(cached);
  if (previousPerformance.builderAudit?.strategyVersion === strategyVersion) performance.builderAudit = previousPerformance.builderAudit;
  await writeFile(performancePath, `${JSON.stringify(performance, null, 2)}\n`);
  await writeFile(parametersPath, `${JSON.stringify(engineParameters, null, 2)}\n`);
  await writeFile(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`);
  console.log(`OddsAura cached-history backtest complete: ${previous.events.length} matches available; ${performance.matches} walk-forward predictions tested.`);
  process.exit(0);
}
assertSourceAuthorized(sourcePolicy, "football-data.co.uk", "historical-training");
const result = await collectFootballDataHistory({ seasons: Number(process.env.HISTORY_SEASONS ?? 8) });
if (result.events.length < 500) {
  if (previous.events?.length) {
    console.warn(`Historical refresh returned only ${result.events.length} matches; preserving ${previous.events.length} cached matches.`);
    process.exit(0);
  }
  throw new Error(`Historical refresh returned only ${result.events.length} matches.`);
}
const payload = { version: 1, generatedAt: new Date().toISOString(), source: "football-data.co.uk", warnings: result.warnings, events: result.events };
await mkdir(dirname(historyPath), { recursive: true });
await writeFile(historyPath, `${JSON.stringify(payload)}\n`);
const globalDays = Math.max(0, Math.min(1460, Number(process.env.HISTORY_GLOBAL_DAYS ?? 0)));
let worldwide = mergeWorldwide(previousGlobal.events ?? []);
let globalWarnings = [...(previousGlobal.warnings ?? [])];
let leagueCatalog = previousCatalog;
let coveredStart = previousGlobal.coverageStart ?? null;
let coveredEnd = previousGlobal.coverageEnd ?? (worldwide.at(-1)?.kickoff ? dayText(worldwide.at(-1).kickoff) : null);
if (globalDays) {
  try { leagueCatalog = await collectEspnLeagueCatalog(); }
  catch (error) { leagueCatalog = { ...previousCatalog, warnings: [...(previousCatalog.warnings ?? []), error instanceof Error ? error.message : "League catalogue refresh failed"] }; }
  await writeFile(leagueCatalogPath, `${JSON.stringify(leagueCatalog)}\n`);
  const today = dayText(new Date());
  const targetStart = shiftDay(today, -globalDays);
  const savedStart = coveredStart ?? (worldwide[0]?.kickoff ? dayText(worldwide[0].kickoff) : null);
  const chunkDays = Math.max(7, Math.min(120, Number(process.env.HISTORY_GLOBAL_CHUNK_DAYS ?? 45)));
  if (coveredEnd && coveredEnd < today) {
    const recent = await collectEspnGlobal({ startDate: shiftDay(coveredEnd, 1), endDate: today, leagueCatalog: leagueCatalog.leagues ?? {}, concurrency: Number(process.env.HISTORY_GLOBAL_CONCURRENCY ?? 16) });
    worldwide = mergeWorldwide(worldwide, recent.events);
    globalWarnings.push(...recent.warnings);
    coveredEnd = today;
    await writeFile(globalHistoryPath, `${JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), source: "espn-global-json", warnings: [...new Set(globalWarnings)].slice(-500), coverageStart: coveredStart, coverageEnd: coveredEnd, complete: Boolean(previousGlobal.complete), events: worldwide })}\n`);
  }
  let cursorEnd = previousGlobal.complete && savedStart && savedStart <= targetStart ? shiftDay(targetStart, -1) : savedStart ? shiftDay(savedStart, -1) : today;
  while (cursorEnd >= targetStart) {
    const cursorStart = shiftDay(cursorEnd, -(chunkDays - 1)) < targetStart ? targetStart : shiftDay(cursorEnd, -(chunkDays - 1));
    const chunk = await collectEspnGlobal({ startDate: cursorStart, endDate: cursorEnd, leagueCatalog: leagueCatalog.leagues ?? {}, concurrency: Number(process.env.HISTORY_GLOBAL_CONCURRENCY ?? 16) });
    worldwide = mergeWorldwide(worldwide, chunk.events);
    globalWarnings.push(...chunk.warnings);
    coveredStart = cursorStart;
    const checkpoint = {
      version: 2,
      generatedAt: new Date().toISOString(),
      source: "espn-global-json",
      warnings: [...new Set(globalWarnings)].slice(-500),
      coverageStart: coveredStart,
      coverageEnd: coveredEnd ?? today,
      complete: cursorStart <= targetStart,
      events: worldwide,
    };
    await writeFile(globalHistoryPath, `${JSON.stringify(checkpoint)}\n`);
    console.log(`Worldwide history checkpoint: ${cursorStart} to ${today}; ${worldwide.length} finished matches.`);
    cursorEnd = shiftDay(cursorStart, -1);
  }
  coveredEnd = today;
}
const globalPayload = { version: 2, generatedAt: new Date().toISOString(), source: "espn-global-json", warnings: [...new Set(globalWarnings)].slice(-500), coverageStart: coveredStart, coverageEnd: coveredEnd, complete: globalDays ? Boolean(coveredStart && coveredStart <= shiftDay(new Date(), -globalDays) && coveredEnd >= dayText(new Date())) : Boolean(previousGlobal.complete), events: worldwide };
const combined = [...new Map([...result.events, ...worldwide].map(event => [canonicalEventIdentity(event), normalizeEventIdentity(event)])).values()];
const performance = backtestHistory(combined, { sampleSize: Number(process.env.BACKTEST_MATCHES ?? 2000) });
const engineParameters = performance.engineParameters;
delete performance.engineParameters;
performance.strategyVersion = strategyVersion;
const coverage = summarizeHistory(combined);
if (previousPerformance.builderAudit?.strategyVersion === strategyVersion) performance.builderAudit = previousPerformance.builderAudit;
await writeFile(globalHistoryPath, `${JSON.stringify(globalPayload)}\n`);
await writeFile(leagueCatalogPath, `${JSON.stringify(leagueCatalog)}\n`);
await writeFile(performancePath, `${JSON.stringify(performance, null, 2)}\n`);
await writeFile(parametersPath, `${JSON.stringify(engineParameters, null, 2)}\n`);
await writeFile(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`);
console.log(`OddsAura history updated: ${result.events.length} archive + ${worldwide.length} worldwide matches; ${performance.matches} walk-forward predictions tested.`);
