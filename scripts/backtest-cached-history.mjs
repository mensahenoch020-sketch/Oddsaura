import { readFile, writeFile } from "node:fs/promises";
import { backtestHistory } from "../pipeline/lib/backtest.mjs";

const history = JSON.parse(await readFile(process.argv[2] || new URL("../data/history/football-data.json", import.meta.url), "utf8"));
const report = backtestHistory(history.events, { sampleSize: 2000 });
const engineParameters = report.engineParameters;
delete report.engineParameters;
await writeFile(new URL("../data/public/model-performance.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
await writeFile(new URL("../data/public/model-parameters.json", import.meta.url), JSON.stringify(engineParameters, null, 2) + "\n");
console.log(JSON.stringify({ matches: report.matches, markets: report.markets, baseline: report.baseline }));
