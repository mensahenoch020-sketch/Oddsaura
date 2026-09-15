import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeHistory } from "./lib/history-coverage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archive = await readFile(resolve(root, "data/history/football-data.json"), "utf8").then(JSON.parse).catch(() => ({ events: [] }));
const worldwide = await readFile(resolve(root, "data/history/global-football.json"), "utf8").then(JSON.parse).catch(() => ({ events: [] }));
const coverage = summarizeHistory([...(archive.events ?? []), ...(worldwide.events ?? [])]);
await writeFile(resolve(root, "data/public/history-coverage.json"), `${JSON.stringify(coverage, null, 2)}\n`);
console.log(`OddsAura history coverage: ${coverage.matches} matches, ${coverage.competitionCount} competitions, ${coverage.teamCount} teams.`);
