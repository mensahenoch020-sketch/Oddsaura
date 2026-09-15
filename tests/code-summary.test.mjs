import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../app/assistant/code-summary.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022}}).outputText;
const { includedPicks, resolvedTotal, targetReached } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('partial slip summary contains only resolved picks and actual bookmaker prices', () => {
  const picks = [{fixtureId:'a', quotedOdds:2}, {fixtureId:'b', quotedOdds:3}];
  assert.deepEqual(includedPicks(picks, [{fixtureId:'b', odds:1.4}]), [{fixtureId:'b', quotedOdds:1.4}]);
  assert.equal(resolvedTotal([{odds:2}, {odds:3}]), 6);
  for (const rows of [[], [{odds:null}], [{odds:NaN}], [{odds:0}]]) assert.equal(resolvedTotal(rows), undefined);
});
test('target success requires verified complete final odds, not original estimates', () => {
  assert.equal(targetReached(20, 20, true, false), true);
  assert.equal(targetReached(20, 12, true, false), false);
  assert.equal(targetReached(20, 20, false, false), false);
  assert.equal(targetReached(20, 20, true, true), false);
  assert.equal(targetReached(20, undefined, true, false), false);
});
