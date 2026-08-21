export type FormLine = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type Price = { market: string; selection: string; decimal: number };

export type PredictionInput = {
  home: FormLine;
  away: FormLine;
  headToHead?: { played: number; homeGoals: number; awayGoals: number; homeWins: number; draws: number; awayWins: number };
  prices?: Price[];
};

export type ScoredMarket = {
  market: "HOME_WIN" | "DRAW" | "AWAY_WIN" | "HOME_OR_DRAW" | "AWAY_OR_DRAW" | "OVER_1_5" | "OVER_2_5" | "UNDER_2_5" | "BTTS_YES" | "BTTS_NO";
  selection: string;
  probability: number;
  impliedProbability: number | null;
  decimal: number | null;
  edge: number | null;
  confidence: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  factors: Record<string, number>;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const safeRate = (value: number, played: number, fallback: number) => played > 0 ? value / played : fallback;

function factorial(n: number) {
  let out = 1;
  for (let i = 2; i <= n; i += 1) out *= i;
  return out;
}

function poisson(lambda: number, goals: number) {
  return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial(goals);
}

export function scoreFixture(input: PredictionInput): ScoredMarket[] {
  const homeGF = safeRate(input.home.goalsFor, input.home.played, 1.35);
  const homeGA = safeRate(input.home.goalsAgainst, input.home.played, 1.1);
  const awayGF = safeRate(input.away.goalsFor, input.away.played, 1.1);
  const awayGA = safeRate(input.away.goalsAgainst, input.away.played, 1.35);
  const homePPG = safeRate(input.home.wins * 3 + input.home.draws, input.home.played, 1.5);
  const awayPPG = safeRate(input.away.wins * 3 + input.away.draws, input.away.played, 1.25);
  const h2h = input.headToHead;
  const h2hHomeGoals = h2h && h2h.played ? h2h.homeGoals / h2h.played : 1.35;
  const h2hAwayGoals = h2h && h2h.played ? h2h.awayGoals / h2h.played : 1.1;

  const expectedHomeGoals = clamp(0.46 * homeGF + 0.34 * awayGA + 0.12 * h2hHomeGoals + 0.08 * 1.35, 0.25, 3.8);
  const expectedAwayGoals = clamp(0.46 * awayGF + 0.34 * homeGA + 0.12 * h2hAwayGoals + 0.08 * 1.05, 0.2, 3.5);

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over15 = 0;
  let over25 = 0;
  let btts = 0;
  for (let homeGoals = 0; homeGoals <= 8; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 8; awayGoals += 1) {
      const p = poisson(expectedHomeGoals, homeGoals) * poisson(expectedAwayGoals, awayGoals);
      if (homeGoals > awayGoals) homeWin += p;
      else if (homeGoals === awayGoals) draw += p;
      else awayWin += p;
      if (homeGoals + awayGoals >= 2) over15 += p;
      if (homeGoals + awayGoals >= 3) over25 += p;
      if (homeGoals > 0 && awayGoals > 0) btts += p;
    }
  }

  const formHome = clamp(0.5 + (homePPG - awayPPG) / 6, 0.2, 0.8);
  homeWin = clamp(homeWin * 0.82 + formHome * 0.18, 0.03, 0.9);
  awayWin = clamp(awayWin * 0.82 + (1 - formHome) * 0.18, 0.03, 0.9);
  const oneXTwoTotal = homeWin + draw + awayWin;
  homeWin /= oneXTwoTotal;
  draw /= oneXTwoTotal;
  awayWin /= oneXTwoTotal;

  const probabilities: Array<[ScoredMarket["market"], string, number]> = [
    ["HOME_WIN", "Home win", homeWin],
    ["DRAW", "Draw", draw],
    ["AWAY_WIN", "Away win", awayWin],
    ["HOME_OR_DRAW", "Home or draw", homeWin + draw],
    ["AWAY_OR_DRAW", "Away or draw", awayWin + draw],
    ["OVER_1_5", "Over 1.5 goals", over15],
    ["OVER_2_5", "Over 2.5 goals", over25],
    ["UNDER_2_5", "Under 2.5 goals", 1 - over25],
    ["BTTS_YES", "Both teams to score", btts],
    ["BTTS_NO", "Both teams not to score", 1 - btts],
  ];

  const dataQuality = clamp((Math.min(input.home.played, 10) + Math.min(input.away.played, 10)) / 20, 0.35, 1);
  return probabilities.map(([market, selection, probability]) => {
    const price = input.prices?.find((item) => item.market === market);
    const impliedProbability = price ? 1 / price.decimal : null;
    const edge = impliedProbability === null ? null : probability - impliedProbability;
    const edgeBonus = edge === null ? 0 : clamp(edge, -0.1, 0.12) * 0.8;
    const confidence = clamp(probability * 0.78 + dataQuality * 0.17 + edgeBonus, 0, 0.99);
    return {
      market,
      selection,
      probability,
      impliedProbability,
      decimal: price?.decimal ?? null,
      edge,
      confidence,
      expectedHomeGoals,
      expectedAwayGoals,
      factors: { homePPG, awayPPG, homeGF, awayGF, homeGA, awayGA, dataQuality },
    };
  }).sort((a, b) => b.confidence - a.confidence);
}
