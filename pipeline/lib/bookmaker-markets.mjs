import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function collectMarkets(fixtures) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/collect-markets.ts'], { cwd: fileURLToPath(new URL('../../backend/', import.meta.url)), stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Bookmaker collection exceeded 200 seconds')); }, 200_000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-1500); });
    child.on('error', failure => { clearTimeout(timer); reject(failure); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Bookmaker collector failed (${code}): ${error}`));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid bookmaker collector output')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(fixtures));
  });
}

// Only mutually exclusive, exhaustive outcomes can be de-margined together.
function groupKeys(key) {
  if (key.startsWith('MATCH_')) return ['MATCH_HOME', 'MATCH_DRAW', 'MATCH_AWAY'];
  if (key.startsWith('DNB_')) return ['DNB_HOME', 'DNB_AWAY'];
  if (key.startsWith('DC_')) return ['DC_1X', 'DC_X2', 'DC_12'];
  if (key.startsWith('BTTS_')) return ['BTTS_YES', 'BTTS_NO'];
  if (/^(HOME_|AWAY_)?(OVER|UNDER)_/.test(key)) return [key.replace('UNDER_', 'OVER_'), key.replace('OVER_', 'UNDER_')];
  return [];
}

export function priceModelPredictions(predictions, quotes, now = Date.now()) {
  const models = new Map(predictions.map(pick => [`${pick.fixtureId}|${pick.key}|${pick.line ?? ''}`, pick]));
  const fresh = quotes.filter(q => Number.isFinite(q.odds) && q.odds > 1 && q.observedAt && now - Date.parse(q.observedAt) >= 0 && now - Date.parse(q.observedAt) <= 30 * 60_000);
  const index = new Map(fresh.map(q => [`${q.provider}|${q.fixtureId}|${q.marketKey}|${q.line ?? ''}`, q]));
  return fresh.flatMap(quote => {
    const model = models.get(`${quote.fixtureId}|${quote.marketKey}|${quote.line ?? ''}`);
    if (!model) return [];
    const keys = groupKeys(quote.marketKey);
    const siblings = keys.map(key => index.get(`${quote.provider}|${quote.fixtureId}|${key}|${quote.line ?? ''}`));
    if (!keys.length || siblings.some(q => !q)) return [];
    const sum = siblings.reduce((total, q) => total + 1 / q.odds, 0);
    // Double chance outcomes overlap: each score belongs to two of three.
    const marketProbability = (1 / quote.odds) / sum * (quote.marketKey.startsWith('DC_') ? 2 : 1);
    if (!(marketProbability > 0 && marketProbability < 1)) return [];
    const quality = typeof model.dataQuality === 'string'
      ? ({ LOW: 0, MEDIUM: .5, HIGH: 1 }[model.dataQuality] ?? 0)
      : Math.min(1, Math.max(0, Number(model.dataQuality) || 0));
    const weight = Math.max(0, Math.min(.4, Number(model.marketModelWeight ?? (.05 + quality * .05))));
    const probability = model.probability * weight + marketProbability * (1 - weight);
    return [{ ...model, modelProbability: model.probability, probability,
      confidence: probability * (.85 + quality * .15), fairOdds: Number((1 / probability).toFixed(2)),
      quotedOdds: quote.odds, oddsProvider: quote.provider, oddsSource: `bookmaker-${quote.provider}`,
      quoteObservedAt: quote.observedAt, providerEventId: quote.eventId,
      providerMarketId: quote.marketId, providerSelectionId: quote.outcomeId, providerSpecifier: quote.specifier,
      marketProbability, impliedProbability: 1 / quote.odds, edge: probability - marketProbability,
      modelMarketGap: Math.abs(model.probability - marketProbability), expectedValue: probability * quote.odds - 1,
      marketModelWeight: weight,
    }];
  });
}
