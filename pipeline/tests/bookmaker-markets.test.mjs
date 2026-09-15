import test from 'node:test';
import assert from 'node:assert/strict';
import { priceModelPredictions } from '../lib/bookmaker-markets.mjs';

test('bookmaker probability groups require complete outcomes from the same provider and line', () => {
  const now = Date.parse('2026-09-14T10:00:00Z');
  const models = ['OVER_1_5', 'UNDER_1_5'].map(key => ({ fixtureId: 'f', key, line: 1.5, probability: .5, dataQuality: 1 }));
  const base = { fixtureId: 'f', line: 1.5, odds: 2, observedAt: new Date(now).toISOString() };
  assert.deepEqual(priceModelPredictions(models, [{ ...base, provider: 'sportybet', marketKey: 'OVER_1_5' }, { ...base, provider: 'betpawa', marketKey: 'UNDER_1_5' }], now), []);
  const quotes = models.map(p => ({ ...base, provider: 'betpawa', marketKey: p.key }));
  const priced = priceModelPredictions(models, quotes, now);
  assert.equal(priced.length, 2);
  assert.equal(priced[0].oddsProvider, 'betpawa');
  assert.equal(priced[0].marketProbability, .5);
  assert.ok(Number.isFinite(priced[0].probability));
  assert.ok(Number.isFinite(priced[0].confidence));
  assert.deepEqual(priceModelPredictions(models, quotes, now + 31 * 60_000), []);
});

test('overlapping double chance outcomes normalize to two, not one', () => {
  const now = Date.now();
  const models = ['DC_1X', 'DC_X2', 'DC_12'].map(key => ({ fixtureId: 'f', key, probability: 2 / 3, dataQuality: 1 }));
  const quotes = models.map(p => ({ fixtureId: 'f', marketKey: p.key, provider: 'betking', odds: 1.5, observedAt: new Date(now).toISOString() }));
  assert.equal(priceModelPredictions(models, quotes, now)[0].marketProbability, 2 / 3);
});
