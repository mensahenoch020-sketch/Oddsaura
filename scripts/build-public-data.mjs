import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(root, "data/public");
const targetDir = resolve(root, "public/data");
const snapshot = JSON.parse(await readFile(resolve(sourceDir, "snapshot.json"), "utf8"));
const modelPerformance = await readFile(resolve(sourceDir, "model-performance.json"), "utf8").then(JSON.parse).catch(() => null);
const withoutOdds = (fixture) => ({ ...fixture, odds: [] });
const slimPick = (source) => {
  const pick = { ...source };
  for (const key of ["reasoning", "providerDeepLink"]) delete pick[key];
  return pick;
};
const common = { version: snapshot.version, generatedAt: snapshot.generatedAt, stale: snapshot.stale, status: snapshot.status, message: snapshot.message, metrics: snapshot.metrics };
const routePicks = (snapshot.predictedPicks ?? []).map(slimPick);
const generated = {
  snapshot,
  builder: { ...common, predictedPicks: routePicks },
  matches: { ...common, fixtures: (snapshot.fixtures ?? []).map(withoutOdds), liveFixtures: (snapshot.liveFixtures ?? []).map(withoutOdds), predictedPicks: routePicks },
  daily: { ...common, tickets: snapshot.tickets ?? [] },
  results: { ...common, recentResults: (snapshot.recentResults ?? []).map(withoutOdds), tickets: snapshot.tickets ?? [], ticketHistory: snapshot.ticketHistory ?? [], modelPerformance },
  admin: { ...common, sources: snapshot.sources ?? [], tickets: snapshot.tickets ?? [], marketCatalog: snapshot.marketCatalog ?? [] },
};

await mkdir(targetDir, { recursive: true });
await Promise.all(Object.entries(generated).map(([name, payload]) => writeFile(resolve(targetDir, `${name}.json`), `${JSON.stringify(payload)}\n`)));
const performance = await readFile(resolve(sourceDir, "model-performance.json"), "utf8").catch(() => null);
if (performance) await writeFile(resolve(targetDir, "model-performance.json"), performance);
