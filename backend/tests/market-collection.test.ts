import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBookmakerMarkets, marketCollectors } from '../src/modules/providers/market-collection.js';
import { collectSportyBetMarkets } from '../src/modules/providers/sportybet.js';
import { buildTargetSlip } from '../../app/builder/target-builder.js';
import { availableQuotes } from '../src/modules/providers/quote-helpers.js';
import { expandProviderMarkets, type ExpansionCandidate } from '../src/modules/providers/market-expansion.js';

const input = { fixtureId: 'qa-collection', homeTeam: 'Arsenal', awayTeam: 'Chelsea', kickoff: '2030-01-02T12:00:00Z', marketKey: 'MATCH_HOME', marketName: 'Match result', selection: 'Arsenal' };
const resolved = { fixtureId: input.fixtureId, eventId: 'event', marketId: '1', outcomeId: '1', specifier: null, odds: 1.5, homeTeam: 'Arsenal', awayTeam: 'Chelsea', market: 'Match result', outcome: 'Home', marketKey: 'MATCH_HOME', line: null };

test('all five collectors run independently and retain bookmaker identity', async () => {
  const seen: string[] = [];
  const collectors = Object.fromEntries(Object.keys(marketCollectors).map((provider, index) => [provider, async () => {
    seen.push(provider);
    if (provider === 'bet9ja') throw new Error('Connection unavailable');
    return [{ ...resolved, odds: 1.5 + index / 10 }];
  }])) as unknown as typeof marketCollectors;
  const result = await collectBookmakerMarkets([[input]], { collectors });
  assert.equal(new Set(seen).size, 5);
  assert.equal(result.quotes.length, 4);
  assert.equal(result.providers.find(p => p.provider === 'bet9ja')?.status, 'UNAVAILABLE');
  assert.equal(new Set(result.quotes.map(q => q.provider)).size, 4);
});

test('request-time collection contacts only the requested bookmaker', async () => {
  const seen: string[] = [];
  const collectors = Object.fromEntries(Object.keys(marketCollectors).map(provider => [provider, async () => {
    seen.push(provider);
    return [{ ...resolved }];
  }])) as unknown as typeof marketCollectors;
  const result = await collectBookmakerMarkets([[input]], { collectors, providers: ['sportybet'] });
  assert.deepEqual(seen, ['sportybet']);
  assert.deepEqual(result.providers.map(item => item.provider), ['sportybet']);
  assert.equal(result.quotes[0]?.provider, 'sportybet');
});

test('collection rejects mutations and stops a provider after forbidden responses', async () => {
  let calls = 0;
  const collectors = Object.fromEntries(Object.keys(marketCollectors).map(provider => [provider, async (_inputs: unknown, fetcher: typeof fetch) => {
    if (provider === 'sportybet') await fetcher('https://example.invalid/', { method: 'POST' });
    else await fetcher('https://example.invalid/');
    return [];
  }])) as unknown as typeof marketCollectors;
  const result = await collectBookmakerMarkets([[input]], { collectors, fetcher: (async () => { calls++; return new Response('', { status: 403 }); }) as typeof fetch });
  assert.equal(calls, 4);
  assert.match(result.providers.find(p => p.provider === 'sportybet')!.errors[0]!.message, /read-only/);
  assert.equal(result.quotes.length, 0);
});

test('Bet9ja fixture lookup POST is read-only but its booking endpoint stays blocked', async () => {
  let safeCalls = 0;
  const collectors = Object.fromEntries(Object.keys(marketCollectors).map(provider => [provider, async (_inputs: unknown, fetcher: typeof fetch) => {
    if (provider === 'bet9ja') await fetcher('https://web.bet9ja.com/Controls/ControlsWS.asmx/GetSearchBoxData', { method: 'POST', body: '{}' });
    return [];
  }])) as unknown as typeof marketCollectors;
  const result = await collectBookmakerMarkets([[input]], { collectors, fetcher: (async () => { safeCalls++; return Response.json({ d: '{}' }); }) as typeof fetch });
  assert.equal(safeCalls, 1);
  assert.doesNotMatch(result.providers.find(p => p.provider === 'bet9ja')!.errors[0]!.message, /read-only/);

  const unsafeCollectors = { ...collectors, bet9ja: async (_inputs: unknown, fetcher: typeof fetch) => {
    await fetcher('https://apigw.bet9ja.com/sportsbook/placebet/BookABetV2', { method: 'POST', body: '{}' });
    return [];
  } } as unknown as typeof marketCollectors;
  const unsafe = await collectBookmakerMarkets([[input]], { collectors: unsafeCollectors, fetcher: (async () => { throw new Error('must not reach network'); }) as typeof fetch });
  assert.match(unsafe.providers.find(p => p.provider === 'bet9ja')!.errors[0]!.message, /read-only/);
});

test('SportyBet collection reads several markets from one event without booking', async () => {
  const urls: string[] = [];
  const event = { eventId: 'sr:match:qa-event', homeTeamName: 'Arsenal', awayTeamName: 'Chelsea', estimateStartTime: Date.parse(input.kickoff), markets: [
    { id: '1', status: 0, outcomes: [{ id: '1', desc: 'Home', odds: '1.5', isActive: 1 }] },
    { id: '10', status: 0, outcomes: [{ id: '9', desc: 'Home or Draw', odds: '1.2', isActive: 1 }] },
  ] };
  const fetcher = (async (url: unknown) => { urls.push(String(url)); return Response.json({ bizCode: 10000, data: String(url).includes('firstSearch') ? { preMatch: [event] } : event }); }) as typeof fetch;
  const result = await collectSportyBetMarkets([input, { ...input, marketKey: 'DC_1X', selection: 'Home or draw' }], fetcher);
  assert.deepEqual(result.map(q => q.marketKey), ['MATCH_HOME', 'DC_1X']);
  assert.equal(urls.length, 2);
  assert.ok(urls.every(url => !url.includes('orders')));
});

test('SportyBet maps both sides of an Asian handicap using the home-relative market line', async () => {
  const asianInput = { ...input, fixtureId: 'qa-asian', homeTeam: 'Gamma Town', awayTeam: 'Delta City' };
  const event = { eventId: 'sr:match:asian', homeTeamName: asianInput.homeTeam, awayTeamName: asianInput.awayTeam, estimateStartTime: Date.parse(asianInput.kickoff), markets: [
    { id: '16', desc: 'Asian Handicap', specifier: 'hcp=-1', status: 0, outcomes: [
      { id: 'home', desc: 'Home', odds: '1.85', isActive: 1 },
      { id: 'away', desc: 'Away', odds: '1.95', isActive: 1 },
    ] },
  ] };
  const fetcher = (async (url: unknown) => Response.json({ bizCode: 10000, data: String(url).includes('firstSearch') ? { preMatch: [event] } : event })) as typeof fetch;
  const quotes = await collectSportyBetMarkets([
    { ...asianInput, marketKey: 'ASIAN_HOME_M1', marketName: 'Asian handicap', selection: `${asianInput.homeTeam} (-1)`, line: -1 },
    { ...asianInput, marketKey: 'ASIAN_AWAY_P1', marketName: 'Asian handicap', selection: `${asianInput.awayTeam} (+1)`, line: 1 },
  ], fetcher);
  assert.deepEqual(quotes.map(row => [row.marketKey, row.line, row.outcomeId]), [
    ['ASIAN_HOME_M1', -1, 'home'], ['ASIAN_AWAY_P1', 1, 'away'],
  ]);
});

test('request-time expansion joins fresh complete bookmaker prices to model candidates', async () => {
  const kickoff = '2030-01-03T12:00:00Z';
  const base: ExpansionCandidate = {
    id: 'expand-home', fixtureId: 'expand-fixture', league: { name: 'Test League' }, kickoff,
    homeTeam: { name: 'Alpha Town' }, awayTeam: { name: 'Beta City' }, key: 'MATCH_HOME', name: 'Match result', category: 'Result', line: null,
    selection: 'Alpha Town', probability: .6, confidence: .6, fairOdds: 1.67, dataQuality: 'HIGH', historyMatches: 100,
  };
  const candidates = [
    base,
    { ...base, id: 'expand-draw', key: 'MATCH_DRAW', selection: 'Draw', probability: .24, fairOdds: 4.17 },
    { ...base, id: 'expand-away', key: 'MATCH_AWAY', selection: 'Beta City', probability: .16, fairOdds: 6.25 },
  ];
  const event = { eventId: 'sr:match:expand', homeTeamName: 'Alpha Town', awayTeamName: 'Beta City', estimateStartTime: Date.parse(kickoff), markets: [
    { id: '1', status: 0, outcomes: [{ id: '1', desc: 'Home', odds: '1.7', isActive: 1 }, { id: '2', desc: 'Draw', odds: '3.5', isActive: 1 }, { id: '3', desc: 'Away', odds: '4.8', isActive: 1 }] },
  ] };
  const fetcher = (async (url: unknown) => Response.json({ bizCode: 10000, data: String(url).includes('firstSearch') ? { preMatch: [event] } : event })) as typeof fetch;
  const result = await expandProviderMarkets('sportybet', candidates, fetcher);
  assert.equal(result.fixturesChecked, 1);
  assert.equal(result.picks.length, 3);
  assert.ok(result.picks.every(item => item.oddsProvider === 'sportybet' && item.quotedOdds > 1));
});

test('invalid prices are not market quotes; other bookmaker prices never build a slip', () => {
  assert.deepEqual(availableQuotes([input], () => ({ ...resolved, odds: NaN })), []);
  const pick = { id: 'p', fixtureId: 'p', kickoff: input.kickoff, market: { key: 'MATCH_HOME' }, quotedOdds: 2, probability: .8, confidence: .8, dataQuality: 'HIGH', historyMatches: 100, marketProbability: .8, modelMarketGap: 0, expectedValue: .6, oddsProvider: 'betpawa' };
  assert.equal(buildTargetSlip([pick as never], 2, Date.parse('2029-01-01'), 'sportybet'), null);
  assert.ok(buildTargetSlip([pick as never], 2, Date.parse('2029-01-01'), 'betpawa'));
  assert.equal(buildTargetSlip([{ ...pick, quoteObservedAt: '2028-01-01' } as never], 2, Date.parse('2029-01-01'), 'betpawa'), null);
});
