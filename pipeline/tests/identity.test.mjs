import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEventIdentity, normalizeEventIdentity } from '../lib/identity.mjs';
import { buildModelContext } from '../lib/model.mjs';

const fixture = (id, name) => ({ id: name, league: { id, name }, kickoff: '2026-09-01T12:00:00Z', status: 'FINISHED', homeScore: 1, awayScore: 0, homeTeam: { name: 'Manchester City' }, awayTeam: { name: 'Aston Villa' } });
test('numeric live league IDs join archive identities without mixing squad histories', () => {
  const men = normalizeEventIdentity(fixture('700', 'English Premier League'));
  const archive = normalizeEventIdentity(fixture('eng.1', 'Premier League'));
  const women = normalizeEventIdentity(fixture('8097', 'English Womens Super League'));
  const youth = normalizeEventIdentity(fixture('999', 'Premier League U21'));
  assert.equal(men.league.id, archive.league.id);
  assert.equal(men.homeTeam.id, archive.homeTeam.id);
  assert.notEqual(men.homeTeam.id, women.homeTeam.id);
  assert.notEqual(men.homeTeam.id, youth.homeTeam.id);
  assert.notEqual(women.league.id, men.league.id);
  assert.deepEqual(normalizeEventIdentity(women), women);
  const ctx = buildModelContext([men, women, youth]);
  assert.equal(ctx.teamEvents.get(men.homeTeam.id).length, 1);
});

test('source-neutral match identity deduplicates the same fixture across providers', () => {
  const first = fixture('eng.1', 'English Premier League');
  const second = { ...first, id: 'another-provider-id', source: 'another-source' };
  assert.equal(canonicalEventIdentity(first), canonicalEventIdentity(second));
});
