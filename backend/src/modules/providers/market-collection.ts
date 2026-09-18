import { collectSportyBetMarkets, type SportyBetSelectionInput } from './sportybet.js';
import { collectBetPawaMarkets } from './betpawa.js';
import { collectBetKingMarkets } from './betking.js';
import { collectBetwayMarkets } from './betway.js';
import { collectBet9jaMarkets } from './bet9ja.js';
import type { MarketQuote } from './quote-helpers.js';

export const marketCollectors = {
  sportybet: collectSportyBetMarkets, betpawa: collectBetPawaMarkets,
  betking: collectBetKingMarkets, betway: collectBetwayMarkets, bet9ja: collectBet9jaMarkets,
};
export type QuoteProvider = keyof typeof marketCollectors;
export type CollectedQuote = MarketQuote & { provider: QuoteProvider; observedAt: string; kickoff: string };

export async function collectBookmakerMarkets(fixtures: SportyBetSelectionInput[][], options: {
  fetcher?: typeof fetch; collectors?: typeof marketCollectors; timeoutMs?: number; providers?: QuoteProvider[]; workers?: number;
} = {}) {
  const startedAt = new Date().toISOString();
  const collectors = options.collectors ?? marketCollectors;
  const requestedProviders = options.providers?.length ? [...new Set(options.providers)] : Object.keys(marketCollectors) as QuoteProvider[];
  const results = await Promise.all(requestedProviders.map(async provider => {
    const quotes: CollectedQuote[] = [];
    const errors: Array<{ fixtureId: string; message: string }> = [];
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 180_000);
    let cursor = 0, attempted = 0, stopped = false;
    const fetcher: typeof fetch = async (input, init) => {
      if (stopped || deadline.aborted) throw new Error('Collection stopped or timed out');
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
      // Bet9ja exposes fixture search and market details through legacy ASP.NET
      // POST endpoints. They only read data; code creation uses another host/path.
      const safeBet9jaReadPost = provider === 'bet9ja' && method === 'POST'
        && url.origin === 'https://web.bet9ja.com'
        && ['/Controls/ControlsWS.asmx/GetSearchBoxData', '/Controls/ControlsWS.asmx/GetSubEventDetails'].includes(url.pathname);
      if (!['GET', 'HEAD'].includes(method) && !safeBet9jaReadPost) throw new Error('Market collection is read-only');
      const response = await (options.fetcher ?? fetch)(input, { ...init, signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]) });
      if ([401, 403, 429].includes(response.status)) stopped = true;
      return response;
    };
    async function worker() {
      while (cursor < fixtures.length && !stopped && !deadline.aborted) {
        const inputs = fixtures[cursor++]!;
        const first = inputs[0];
        if (!first || Date.parse(first.kickoff) <= Date.now() + 30 * 60_000) continue;
        attempted++;
        try {
          const rows = await collectors[provider](inputs, fetcher);
          const observedAt = new Date().toISOString();
          quotes.push(...rows.map(row => ({ ...row, provider, observedAt, kickoff: first.kickoff })));
          if (!rows.length) errors.push({ fixtureId: first.fixtureId, message: 'No mapped active markets returned' });
        } catch (error) {
          errors.push({ fixtureId: first.fixtureId, message: error instanceof Error ? error.message : 'Collection failed' });
        }
      }
    }
    const workerCount = Math.max(1, Math.min(6, options.workers ?? 2));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const fixturesQuoted = new Set(quotes.map(row => row.fixtureId)).size;
    return {
      provider, status: quotes.length ? (errors.length || attempted < fixtures.length || fixturesQuoted < fixtures.length ? 'PARTIAL' : 'AVAILABLE') : 'UNAVAILABLE',
      fixturesRequested: fixtures.length, fixturesAttempted: attempted,
      fixturesQuoted,
      marketsQuoted: [...new Set(quotes.map(row => row.marketKey))].sort(),
      stopped: stopped || deadline.aborted, errors: errors.slice(0, 12), quotes,
    };
  }));
  return { generatedAt: startedAt, completedAt: new Date().toISOString(), providers: results.map(result => ({ provider: result.provider, status: result.status, fixturesRequested: result.fixturesRequested, fixturesAttempted: result.fixturesAttempted, fixturesQuoted: result.fixturesQuoted, marketsQuoted: result.marketsQuoted, stopped: result.stopped, errors: result.errors })), quotes: results.flatMap(result => result.quotes) };
}
