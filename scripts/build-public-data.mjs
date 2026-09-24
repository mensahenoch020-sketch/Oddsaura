import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(root, "data/public");
const targetDir = resolve(root, "public/data");
// Build league/date archives from the checked-in canonical histories so the
// deployed site can browse older fixtures without committing generated shards.
await import("../pipeline/export-fixture-history.mjs");
const snapshot = JSON.parse(await readFile(resolve(sourceDir, "snapshot.json"), "utf8"));
const modelPerformance = await readFile(resolve(sourceDir, "model-performance.json"), "utf8").then(JSON.parse).catch(() => null);
const expansion = await readFile(resolve(sourceDir, "expansion.json"), "utf8").then(JSON.parse).catch(() => ({ version: snapshot.version, generatedAt: snapshot.generatedAt, candidates: [] }));
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
  daily: { ...common, tickets: snapshot.tickets ?? [], watchlist: snapshot.watchlist ?? [] },
  results: { ...common, recentResults: (snapshot.recentResults ?? []).map(withoutOdds), tickets: snapshot.tickets ?? [], ticketHistory: snapshot.ticketHistory ?? [], modelPerformance },
  admin: { ...common, sources: snapshot.sources ?? [], tickets: snapshot.tickets ?? [], marketCatalog: snapshot.marketCatalog ?? [] },
  expansion,
};

await mkdir(targetDir, { recursive: true });
await Promise.all(Object.entries(generated).map(([name, payload]) => writeFile(resolve(targetDir, `${name}.json`), `${JSON.stringify(payload)}\n`)));

// Bundle the OCR worker and its small English model locally. Tesseract's
// defaults fetch these from a third-party CDN, which can hang or be blocked in
// mobile browsers and leaves image import stuck before it can show a result.
const ocrDir = resolve(targetDir, "ocr");
await mkdir(resolve(ocrDir, "lang"), { recursive: true });
const assetCopies = [
  [resolve(root, "node_modules/tesseract.js/dist/worker.min.js"), resolve(ocrDir, "worker.min.js")],
  [resolve(root, "node_modules/tesseract.js-core/tesseract-core.wasm.js"), resolve(ocrDir, "tesseract-core.wasm.js")],
  [resolve(root, "node_modules/tesseract.js-core/tesseract-core.wasm"), resolve(ocrDir, "tesseract-core.wasm")],
  [resolve(root, "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"), resolve(ocrDir, "lang/eng.traineddata.gz")],
];
await Promise.all(assetCopies.map(([source, destination]) => copyFile(source, destination)));
await cp(resolve(sourceDir, "fixture-history"), resolve(targetDir, "fixture-history"), { recursive: true, force: true }).catch(() => undefined);
const performance = await readFile(resolve(sourceDir, "model-performance.json"), "utf8").catch(() => null);
if (performance) await writeFile(resolve(targetDir, "model-performance.json"), performance);
