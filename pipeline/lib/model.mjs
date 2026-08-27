const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const factorial = (n) => { let out = 1; for (let i = 2; i <= n; i += 1) out *= i; return out; };
const poisson = (lambda, goals) => Math.exp(-lambda) * Math.pow(lambda, goals) / factorial(goals);

export function buildForm(teamId, events, before, limit = 12, venue = "ALL") {
  const matches = events
    .filter((event) => {
      if (event.status !== "FINISHED" || event.kickoff >= before || event.homeScore === null || event.awayScore === null) return false;
      if (venue === "HOME") return event.homeTeam.id === teamId;
      if (venue === "AWAY") return event.awayTeam.id === teamId;
      return event.homeTeam.id === teamId || event.awayTeam.id === teamId;
    })
    .sort((a, b) => b.kickoff.localeCompare(a.kickoff))
    .slice(0, limit);
  const form = { played: 0, weight: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, lastKickoff: null };
  for (const [index, match] of matches.entries()) {
    const home = match.homeTeam.id === teamId;
    const gf = home ? match.homeScore : match.awayScore;
    const ga = home ? match.awayScore : match.homeScore;
    const weight = Math.pow(0.9, index);
    form.played += 1; form.weight += weight; form.goalsFor += gf * weight; form.goalsAgainst += ga * weight;
    if (index === 0) form.lastKickoff = match.kickoff;
    if (gf > ga) { form.wins += weight; form.points += 3 * weight; }
    else if (gf === ga) { form.draws += weight; form.points += weight; }
    else form.losses += weight;
  }
  return form;
}

export function buildModelContext(events, before = "9999-12-31T00:00:00.000Z") {
  const ratings = new Map();
  const leagues = new Map();
  const finished = events.filter((event) => event.status === "FINISHED" && event.kickoff < before && event.homeScore != null && event.awayScore != null).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  for (const match of finished) {
    const homeId = match.homeTeam.id; const awayId = match.awayTeam.id;
    const homeRating = ratings.get(homeId) ?? 1500; const awayRating = ratings.get(awayId) ?? 1500;
    const expected = 1 / (1 + Math.pow(10, -((homeRating + 60) - awayRating) / 400));
    const actual = match.homeScore > match.awayScore ? 1 : match.homeScore === match.awayScore ? 0.5 : 0;
    const margin = Math.abs(match.homeScore - match.awayScore);
    const change = 22 * (1 + Math.min(3, margin) * 0.12) * (actual - expected);
    ratings.set(homeId, homeRating + change); ratings.set(awayId, awayRating - change);
    const leagueId = match.league?.id ?? match.league?.name ?? "football";
    const league = leagues.get(leagueId) ?? { matches: 0, homeGoals: 0, awayGoals: 0 };
    league.matches += 1; league.homeGoals += match.homeScore; league.awayGoals += match.awayScore;
    leagues.set(leagueId, league);
  }
  return { ratings, leagues };
}

function grid(homeLambda, awayLambda, maxGoals = 9, rho = -0.08) {
  const rows = [];
  let total = 0;
  for (let home = 0; home <= maxGoals; home += 1) for (let away = 0; away <= maxGoals; away += 1) {
    let correction = 1;
    if (home === 0 && away === 0) correction = 1 - homeLambda * awayLambda * rho;
    else if (home === 0 && away === 1) correction = 1 + homeLambda * rho;
    else if (home === 1 && away === 0) correction = 1 + awayLambda * rho;
    else if (home === 1 && away === 1) correction = 1 - rho;
    const probability = poisson(homeLambda, home) * poisson(awayLambda, away) * Math.max(0.2, correction);
    rows.push({ home, away, probability }); total += probability;
  }
  return rows.map((row) => ({ ...row, probability: row.probability / total }));
}

const sum = (rows, predicate) => rows.reduce((value, row) => value + (predicate(row) ? row.probability : 0), 0);
const market = (key, name, category, selection, probability, extra = {}) => ({ key, name, category, selection, probability: clamp(probability, 0.001, 0.999), ...extra });

export function scoreEvent(event, allEvents, suppliedContext = null) {
  const home = buildForm(event.homeTeam.id, allEvents, event.kickoff, 12);
  const away = buildForm(event.awayTeam.id, allEvents, event.kickoff, 12);
  const homeVenue = buildForm(event.homeTeam.id, allEvents, event.kickoff, 8, "HOME");
  const awayVenue = buildForm(event.awayTeam.id, allEvents, event.kickoff, 8, "AWAY");
  const context = suppliedContext ?? buildModelContext(allEvents, event.kickoff);
  const league = context.leagues.get(event.league?.id ?? event.league?.name ?? "football");
  const leagueHome = league?.matches >= 20 ? league.homeGoals / league.matches : 1.42;
  const leagueAway = league?.matches >= 20 ? league.awayGoals / league.matches : 1.12;
  // Bayesian league priors keep every scheduled fixture modelled without
  // pretending that a team with little history has high-confidence evidence.
  const priorMatches = 4;
  const rate = (form, key, prior) => (form[key] + prior * priorMatches) / (form.weight + priorMatches);
  const homeGF = 0.58 * rate(homeVenue, "goalsFor", leagueHome) + 0.42 * rate(home, "goalsFor", leagueHome);
  const homeGA = 0.58 * rate(homeVenue, "goalsAgainst", leagueAway) + 0.42 * rate(home, "goalsAgainst", leagueAway);
  const awayGF = 0.58 * rate(awayVenue, "goalsFor", leagueAway) + 0.42 * rate(away, "goalsFor", leagueAway);
  const awayGA = 0.58 * rate(awayVenue, "goalsAgainst", leagueHome) + 0.42 * rate(away, "goalsAgainst", leagueHome);
  const homePPG = rate(home, "points", 1.45);
  const awayPPG = rate(away, "points", 1.1);
  const homeRating = context.ratings.get(event.homeTeam.id) ?? 1500;
  const awayRating = context.ratings.get(event.awayTeam.id) ?? 1500;
  const eloHome = 1 / (1 + Math.pow(10, -((homeRating + 60) - awayRating) / 400));
  const formDelta = clamp((homePPG - awayPPG) / 10, -0.16, 0.16);
  const ratingDelta = clamp((eloHome - 0.5) * 0.48, -0.22, 0.22);
  const restDays = (form) => form.lastKickoff ? (new Date(event.kickoff).getTime() - new Date(form.lastKickoff).getTime()) / 86_400_000 : 7;
  const restDelta = clamp((restDays(home) - restDays(away)) * 0.012, -0.06, 0.06);
  const homeAttack = clamp(homeGF / Math.max(0.45, leagueHome), 0.35, 2.4);
  const awayDefence = clamp(awayGA / Math.max(0.45, leagueHome), 0.35, 2.4);
  const awayAttack = clamp(awayGF / Math.max(0.35, leagueAway), 0.35, 2.4);
  const homeDefence = clamp(homeGA / Math.max(0.35, leagueAway), 0.35, 2.4);
  const homeLambda = clamp(leagueHome * Math.sqrt(homeAttack * awayDefence) + formDelta + ratingDelta + restDelta, 0.25, 3.8);
  const awayLambda = clamp(leagueAway * Math.sqrt(awayAttack * homeDefence) - formDelta - ratingDelta - restDelta, 0.2, 3.5);
  const rows = grid(homeLambda, awayLambda);
  const homeWin = sum(rows, (r) => r.home > r.away);
  const draw = sum(rows, (r) => r.home === r.away);
  const awayWin = sum(rows, (r) => r.home < r.away);
  const btts = sum(rows, (r) => r.home > 0 && r.away > 0);
  const quality = clamp((home.played + away.played + homeVenue.played + awayVenue.played) / 36, 0.08, 1);
  const predictions = [
    market("MATCH_HOME", "Match result", "Result", event.homeTeam.name, homeWin),
    market("MATCH_DRAW", "Match result", "Result", "Draw", draw),
    market("MATCH_AWAY", "Match result", "Result", event.awayTeam.name, awayWin),
    market("ONE_UP_HOME", "1UP early payout", "Result", event.homeTeam.name, homeWin),
    market("ONE_UP_AWAY", "1UP early payout", "Result", event.awayTeam.name, awayWin),
    market("TWO_UP_HOME", "2UP early payout", "Result", event.homeTeam.name, homeWin),
    market("TWO_UP_AWAY", "2UP early payout", "Result", event.awayTeam.name, awayWin),
    market("DC_1X", "Double chance", "Result", `${event.homeTeam.name} or draw`, homeWin + draw),
    market("DC_X2", "Double chance", "Result", `${event.awayTeam.name} or draw`, awayWin + draw),
    market("DC_12", "Double chance", "Result", "Either team to win", homeWin + awayWin),
    market("DNB_HOME", "Draw no bet", "Result", event.homeTeam.name, homeWin / (homeWin + awayWin)),
    market("DNB_AWAY", "Draw no bet", "Result", event.awayTeam.name, awayWin / (homeWin + awayWin)),
    market("BTTS_YES", "Both teams to score", "Goals", "Yes", btts),
    market("BTTS_NO", "Both teams to score", "Goals", "No", 1 - btts),
    market("ODD_GOALS", "Goal parity", "Goals", "Odd", sum(rows, (r) => (r.home + r.away) % 2 === 1)),
    market("EVEN_GOALS", "Goal parity", "Goals", "Even", sum(rows, (r) => (r.home + r.away) % 2 === 0)),
    market("HOME_CLEAN", "Clean sheet", "Team", event.homeTeam.name, sum(rows, (r) => r.away === 0)),
    market("AWAY_CLEAN", "Clean sheet", "Team", event.awayTeam.name, sum(rows, (r) => r.home === 0)),
    market("HOME_WIN_NIL", "Win to nil", "Team", event.homeTeam.name, sum(rows, (r) => r.home > r.away && r.away === 0)),
    market("AWAY_WIN_NIL", "Win to nil", "Team", event.awayTeam.name, sum(rows, (r) => r.away > r.home && r.home === 0)),
  ];
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const over = sum(rows, (r) => r.home + r.away > line);
    predictions.push(market(`OVER_${String(line).replace(".", "_")}`, "Total goals", "Goals", `Over ${line}`, over, { line }));
    predictions.push(market(`UNDER_${String(line).replace(".", "_")}`, "Total goals", "Goals", `Under ${line}`, 1 - over, { line }));
  }
  for (const line of [0.5, 1.5, 2.5]) {
    const homeOver = sum(rows, (r) => r.home > line);
    const awayOver = sum(rows, (r) => r.away > line);
    predictions.push(market(`HOME_OVER_${String(line).replace(".", "_")}`, "Home team goals", "Team", `Over ${line}`, homeOver, { line }));
    predictions.push(market(`HOME_UNDER_${String(line).replace(".", "_")}`, "Home team goals", "Team", `Under ${line}`, 1 - homeOver, { line }));
    predictions.push(market(`AWAY_OVER_${String(line).replace(".", "_")}`, "Away team goals", "Team", `Over ${line}`, awayOver, { line }));
    predictions.push(market(`AWAY_UNDER_${String(line).replace(".", "_")}`, "Away team goals", "Team", `Under ${line}`, 1 - awayOver, { line }));
  }
  predictions.push(market("HOME_AND_O15", "Result and goals", "Combination", `${event.homeTeam.name} & over 1.5`, sum(rows, (r) => r.home > r.away && r.home + r.away >= 2)));
  predictions.push(market("AWAY_AND_O15", "Result and goals", "Combination", `${event.awayTeam.name} & over 1.5`, sum(rows, (r) => r.away > r.home && r.home + r.away >= 2)));
  predictions.push(market("DC1X_AND_O15", "Double chance and goals", "Combination", `${event.homeTeam.name}/draw & over 1.5`, sum(rows, (r) => r.home >= r.away && r.home + r.away >= 2)));
  predictions.push(market("DCX2_AND_O15", "Double chance and goals", "Combination", `${event.awayTeam.name}/draw & over 1.5`, sum(rows, (r) => r.away >= r.home && r.home + r.away >= 2)));
  predictions.push(market("BTTS_AND_O25", "BTTS and goals", "Combination", "BTTS & over 2.5", sum(rows, (r) => r.home > 0 && r.away > 0 && r.home + r.away >= 3)));

  const firstHalf = grid(homeLambda * 0.46, awayLambda * 0.46, 6);
  predictions.push(market("HT_HOME", "First-half result", "Half", event.homeTeam.name, sum(firstHalf, (r) => r.home > r.away)));
  predictions.push(market("HT_DRAW", "First-half result", "Half", "Draw", sum(firstHalf, (r) => r.home === r.away)));
  predictions.push(market("HT_AWAY", "First-half result", "Half", event.awayTeam.name, sum(firstHalf, (r) => r.away > r.home)));
  predictions.push(market("HT_OVER_0_5", "First-half goals", "Half", "Over 0.5", sum(firstHalf, (r) => r.home + r.away >= 1), { line: 0.5 }));
  predictions.push(market("HT_OVER_1_5", "First-half goals", "Half", "Over 1.5", sum(firstHalf, (r) => r.home + r.away >= 2), { line: 1.5 }));

  for (const row of [...rows].sort((a, b) => b.probability - a.probability).slice(0, 5)) {
    predictions.push(market(`CS_${row.home}_${row.away}`, "Correct score", "Score", `${row.home}-${row.away}`, row.probability, { score: [row.home, row.away] }));
  }

  return predictions.map((item) => ({
    ...item,
    fixtureId: event.id,
    expectedHomeGoals: Number(homeLambda.toFixed(2)),
    expectedAwayGoals: Number(awayLambda.toFixed(2)),
    dataQuality: quality,
    confidence: clamp(item.probability * (0.68 + quality * 0.32), 0, 0.99),
    fairOdds: Number((1 / item.probability).toFixed(2)),
    quotedOdds: null,
    oddsSource: null,
    edge: null,
    factors: { homePlayed: home.played, awayPlayed: away.played, homeVenuePlayed: homeVenue.played, awayVenuePlayed: awayVenue.played, homePPG, awayPPG, homeGF, awayGF, homeGA, awayGA, homeElo: Math.round(homeRating), awayElo: Math.round(awayRating), eloHome, homeRestDays: Number(restDays(home).toFixed(1)), awayRestDays: Number(restDays(away).toFixed(1)), leagueHomeGoals: leagueHome, leagueAwayGoals: leagueAway },
  }));
}

function text(value) { return String(value ?? "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim(); }

export function attachOdds(predictions, odds) {
  return predictions.map((prediction) => {
    const selection = text(prediction.selection);
    const name = text(prediction.name);
    const quote = odds.find((odd) => {
      const oddMarket = text(odd.market);
      const oddSelection = text(odd.selection);
      const lineMatches = prediction.line == null || odd.line == null || Number(odd.line) === Number(prediction.line) || oddSelection.includes(String(prediction.line));
      const selectionMatches = oddSelection === selection || oddSelection.includes(selection) || selection.includes(oddSelection) || (prediction.key === "MATCH_HOME" && ["1", "home"].includes(oddSelection)) || (prediction.key === "MATCH_DRAW" && ["x", "draw"].includes(oddSelection)) || (prediction.key === "MATCH_AWAY" && ["2", "away"].includes(oddSelection));
      const marketMatches = oddMarket.includes(name.split(" ")[0]) || name.includes(oddMarket.split(" ")[0]) || prediction.category === "Goals" && /total|goals|over|under/.test(oddMarket);
      return lineMatches && selectionMatches && marketMatches;
    });
    if (!quote) return prediction;
    const implied = 1 / quote.odds;
    const comparable = odds.filter((odd) => odd.marketId === quote.marketId && odd.odds > 1);
    const overround = comparable.reduce((sum, odd) => sum + 1 / odd.odds, 0);
    const consensus = comparable.length >= 2 && overround > 0 ? implied / overround : null;
    const blendedProbability = consensus == null ? prediction.probability : clamp(prediction.probability * 0.84 + consensus * 0.16, 0.001, 0.999);
    return {
      ...prediction,
      modelProbability: prediction.probability,
      probability: blendedProbability,
      confidence: clamp(blendedProbability * (0.68 + prediction.dataQuality * 0.32), 0, 0.99),
      fairOdds: Number((1 / blendedProbability).toFixed(2)),
      quotedOdds: quote.odds,
      oddsSource: quote.source,
      oddsProvider: quote.provider ?? null,
      providerDeepLink: quote.deepLink ?? null,
      edge: blendedProbability - implied,
      impliedProbability: implied,
      consensusProbability: consensus,
      providerMarketId: quote.marketId,
      providerSelectionId: quote.selectionId,
    };
  });
}
