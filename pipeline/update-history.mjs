import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectFootballDataHistory } from "./lib/football-data.mjs";
import { backtestHistory } from "./lib/backtest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strategyVersion = "history-market-v2";
const historyPath = resolve(root, "data/history/football-data.json");
const performancePath = resolve(root, "data/public/model-performance.json");
const previous = await readFile(historyPath, "utf8").then(JSON.parse).catch(() => ({ events: [] }));
const previousPerformance = await readFile(performancePath, "utf8").then(JSON.parse).catch(() => ({}));
if (process.env.HISTORY_USE_CACHE === "1") {
  if (!previous.events?.length) throw new Error("Cached history is unavailable.");
  const performance = backtestHistory(previous.events, { sampleSize: Number(process.env.BACKTEST_MATCHES ?? 2000) });
  if (previousPerformance.builderAudit?.strategyVersion === strategyVersion) performance.builderAudit = previousPerformance.builderAudit;
  await writeFile(performancePath, `${JSON.stringify(performance, null, 2)}\n`);
  console.log(`OddsAura cached-history backtest complete: ${previous.events.length} matches available; ${performance.matches} walk-forward predictions tested.`);
  process.exit(0);
}
const result = await collectFootballDataHistory({ seasons: Number(process.env.HISTORY_SEASONS ?? 8) });
if (result.events.length < 500) {
  if (previous.events?.length) {
    console.warn(`Historical refresh returned only ${result.events.length} matches; preserving ${previous.events.length} cached matches.`);
    process.exit(0);
  }
  throw new Error(`Historical refresh returned only ${result.events.length} matches.`);
}
const payload = { version: 1, generatedAt: new Date().toISOString(), source: "football-data.co.uk", warnings: result.warnings, events: result.events };
const performance = backtestHistory(result.events, { sampleSize: Number(process.env.BACKTEST_MATCHES ?? 2000) });
if (previousPerformance.builderAudit?.strategyVersion === strategyVersion) performance.builderAudit = previousPerformance.builderAudit;
await mkdir(dirname(historyPath), { recursive: true });
await writeFile(historyPath, `${JSON.stringify(payload)}\n`);
await writeFile(performancePath, `${JSON.stringify(performance, null, 2)}\n`);
console.log(`OddsAura history updated: ${result.events.length} matches; ${performance.matches} walk-forward predictions tested.`);
