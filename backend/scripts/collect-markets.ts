import { collectBookmakerMarkets } from '../src/modules/providers/market-collection.js';
import type { SportyBetSelectionInput } from '../src/modules/providers/sportybet.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const fixtures = JSON.parse(input) as SportyBetSelectionInput[][];
const result = await collectBookmakerMarkets(fixtures);
process.stdout.write(JSON.stringify(result));
