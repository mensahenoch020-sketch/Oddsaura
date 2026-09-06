const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const factorial = (n) => { let out = 1; for (let i = 2; i <= n; i += 1) out *= i; return out; };
const poisson = (lambda, goals) => Math.exp(-lambda) * Math.pow(lambda, goals) / factorial(goals);

export function buildForm(teamId, events, before, limit = 12, venue = "ALL", decay = 0.9) {
  const matches = events
    .filter((event) => {
      if (event.status !== "FINISHED" || event.kickoff >= before || event.homeScore === null || event.awayScore === null) return false;
      if (venue === "HOME") return event.homeTeam.id === teamId;
      if (venue === "AWAY") return event.awayTeam.id === teamId;
      return event.homeTeam.id === teamId || event.awayTeam.id === teamId;
    })
    .sort((a, b) => b.kickoff.localeCompare(a.kickoff))
    .slice(0, limit);
  const form = { played: 0, weight: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, cleanSheets: 0, failedToScore: 0, btts: 0, over15: 0, over25: 0, lastKickoff: null };
  for (const [index, match] of matches.entries()) {
    const home = match.homeTeam.id === teamId;
    const gf = home ? match.homeScore : match.awayScore;
    const ga = home ? match.awayScore : match.homeScore;
    const weight = Math.pow(decay, index);
    form.played += 1; form.weight += weight; form.goalsFor += gf * weight; form.goalsAgainst += ga * weight;
    form.cleanSheets += Number(ga === 0) * weight;
    form.failedToScore += Number(gf === 0) * weight;
    form.btts += Number(gf > 0 && ga > 0) * weight;
    form.over15 += Number(gf + ga >= 2) * weight;
    form.over25 += Number(gf + ga >= 3) * weight;
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
  const teamEvents = new Map();
  const finished = events.filter((event) => event.status === "FINISHED" && event.kickoff < before && event.homeScore != null && event.awayScore != null).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const referenceTime = Number.isFinite(Date.parse(before)) ? Date.parse(before) : Date.parse(finished.at(-1)?.kickoff ?? new Date().toISOString());
  for (const match of finished) {
    const homeId = match.homeTeam.id; const awayId = match.awayTeam.id;
    const homeRating = ratings.get(homeId) ?? 1500; const awayRating = ratings.get(awayId) ?? 1500;
    const expected = 1 / (1 + Math.pow(10, -((homeRating + 60) - awayRating) / 400));
    const actual = match.homeScore > match.awayScore ? 1 : match.homeScore === match.awayScore ? 0.5 : 0;
    const margin = Math.abs(match.homeScore - match.awayScore);
    const change = 22 * (1 + Math.min(3, margin) * 0.12) * (actual - expected);
    ratings.set(homeId, homeRating + change); ratings.set(awayId, awayRating - change);
    const leagueId = match.league?.id ?? match.league?.name ?? "football";
    const ageDays = Math.max(0, (referenceTime - Date.parse(match.kickoff)) / 86_400_000);
    const leagueWeight = Math.pow(0.5, ageDays / 730);
    const league = leagues.get(leagueId) ?? { matches: 0, weight: 0, homeGoals: 0, awayGoals: 0 };
    league.matches += 1; league.weight += leagueWeight; league.homeGoals += match.homeScore * leagueWeight; league.awayGoals += match.awayScore * leagueWeight;
    leagues.set(leagueId, league);
    for (const teamId of [homeId, awayId]) {
      const matches = teamEvents.get(teamId) ?? [];
      matches.push(match);
      teamEvents.set(teamId, matches);
    }
  }
  return { ratings, leagues, teamEvents };
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
  const context = suppliedContext ?? buildModelContext(allEvents, event.kickoff);
  const homeEvents = context.teamEvents?.get(event.homeTeam.id) ?? allEvents;
  const awayEvents = context.teamEvents?.get(event.awayTeam.id) ?? allEvents;
  const home = buildForm(event.homeTeam.id, homeEvents, event.kickoff, 16);
  const away = buildForm(event.awayTeam.id, awayEvents, event.kickoff, 16);
  const homeVenue = buildForm(event.homeTeam.id, homeEvents, event.kickoff, 12, "HOME");
  const awayVenue = buildForm(event.awayTeam.id, awayEvents, event.kickoff, 12, "AWAY");
  const homeLong = buildForm(event.homeTeam.id, homeEvents, event.kickoff, 60, "ALL", 0.97);
  const awayLong = buildForm(event.awayTeam.id, awayEvents, event.kickoff, 60, "ALL", 0.97);
  const headToHeadEvents = homeEvents.filter((match) => match.homeTeam.id === event.awayTeam.id || match.awayTeam.id === event.awayTeam.id);
  const homeH2h = buildForm(event.homeTeam.id, headToHeadEvents, event.kickoff, 6, "ALL", 0.92);
  const awayH2h = buildForm(event.awayTeam.id, headToHeadEvents, event.kickoff, 6, "ALL", 0.92);
  const league = context.leagues.get(event.league?.id ?? event.league?.name ?? "football");
  const leagueHome = league?.matches >= 20 && league.weight ? league.homeGoals / league.weight : 1.42;
  const leagueAway = league?.matches >= 20 && league.weight ? league.awayGoals / league.weight : 1.12;
  // Bayesian league priors keep every scheduled fixture modelled without
  // pretending that a team with little history has high-confidence evidence.
  const priorMatches = 4;
  const rate = (form, key, prior) => (form[key] + prior * priorMatches) / (form.weight + priorMatches);
  const blendRate = (recent, venueForm, long, key, prior) => 0.38 * rate(venueForm, key, prior) + 0.37 * rate(recent, key, prior) + 0.25 * rate(long, key, prior);
  let homeGF = blendRate(home, homeVenue, homeLong, "goalsFor", leagueHome);
  let homeGA = blendRate(home, homeVenue, homeLong, "goalsAgainst", leagueAway);
  let awayGF = blendRate(away, awayVenue, awayLong, "goalsFor", leagueAway);
  let awayGA = blendRate(away, awayVenue, awayLong, "goalsAgainst", leagueHome);
  // Direct meetings are useful context, but their small and often stale sample
  // is capped at a five-percent adjustment.
  if (homeH2h.played >= 3) {
    homeGF = 0.95 * homeGF + 0.05 * rate(homeH2h, "goalsFor", leagueHome);
    homeGA = 0.95 * homeGA + 0.05 * rate(homeH2h, "goalsAgainst", leagueAway);
    awayGF = 0.95 * awayGF + 0.05 * rate(awayH2h, "goalsFor", leagueAway);
    awayGA = 0.95 * awayGA + 0.05 * rate(awayH2h, "goalsAgainst", leagueHome);
  }
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
  const minimumLongHistory = Math.min(homeLong.played, awayLong.played);
  const recentCoverage = Math.min(home.played, away.played) / 16;
  const venueCoverage = Math.min(homeVenue.played, awayVenue.played) / 12;
  const longCoverage = minimumLongHistory / 40;
  const quality = clamp(0.4 * Math.min(1, longCoverage) + 0.38 * Math.min(1, recentCoverage) + 0.22 * Math.min(1, venueCoverage), 0.08, 1);
  const predictions = [
    market("MATCH_HOME", "Match result", "Result", event.homeTeam.name, homeWin),
    market("MATCH_DRAW", "Match result", "Result", "Draw", draw),
    market("MATCH_AWAY", "Match result", "Result", event.awayTeam.name, awayWin),
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
  // Publish one meaningful European three-way handicap line. The favourite
  // gives one goal; if there is no clear favourite, the market is withheld.
  const favouriteGap = Math.abs(homeWin - awayWin);
  if (favouriteGap >= 0.08) {
    const line = homeWin > awayWin ? -1 : 1;
    const adjusted = (row) => row.home + line - row.away;
    predictions.push(market("HCP_3WAY_HOME", "European handicap", "Handicap", `${event.homeTeam.name} (${line > 0 ? "+" : ""}${line})`, sum(rows, (row) => adjusted(row) > 0), { line }));
    predictions.push(market("HCP_3WAY_DRAW", "European handicap", "Handicap", `Draw (${line > 0 ? "+" : ""}${line})`, sum(rows, (row) => adjusted(row) === 0), { line }));
    predictions.push(market("HCP_3WAY_AWAY", "European handicap", "Handicap", `${event.awayTeam.name} (${line > 0 ? "+" : ""}${line})`, sum(rows, (row) => adjusted(row) < 0), { line }));
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
    factors: { homePlayed: home.played, awayPlayed: away.played, homeVenuePlayed: homeVenue.played, awayVenuePlayed: awayVenue.played, homeHistoryPlayed: homeLong.played, awayHistoryPlayed: awayLong.played, headToHeadPlayed: homeH2h.played, minimumLongHistory, homePPG, awayPPG, homeGF, awayGF, homeGA, awayGA, homeCleanSheetRate: home.weight ? home.cleanSheets / home.weight : null, awayCleanSheetRate: away.weight ? away.cleanSheets / away.weight : null, homeBttsRate: home.weight ? home.btts / home.weight : null, awayBttsRate: away.weight ? away.btts / away.weight : null, homeElo: Math.round(homeRating), awayElo: Math.round(awayRating), eloHome, homeRestDays: Number(restDays(home).toFixed(1)), awayRestDays: Number(restDays(away).toFixed(1)), leagueHomeGoals: leagueHome, leagueAwayGoals: leagueAway },
  }));
}

function text(value) { return String(value ?? "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim(); }

function predictionFamily(key = "") {
  if (/^MATCH_/.test(key)) return "RESULT";
  if (/^(ONE|TWO)_UP_/.test(key)) return "EARLY_RESULT";
  if (/^DC_/.test(key)) return "DOUBLE_CHANCE";
  if (/^DNB_/.test(key)) return "DRAW_NO_BET";
  if (/^BTTS_/.test(key)) return "BTTS";
  if (/^HOME_(OVER|UNDER)_/.test(key)) return "HOME_TOTAL";
  if (/^AWAY_(OVER|UNDER)_/.test(key)) return "AWAY_TOTAL";
  if (/^HCP_3WAY_/.test(key)) return "HANDICAP_3WAY";
  if (/^(OVER|UNDER)_/.test(key)) return "TOTAL";
  return "OTHER";
}

function quoteFamily(value = "") {
  const name = text(value);
  if (/double chance/.test(name)) return "DOUBLE_CHANCE";
  if (/draw no bet|dnb/.test(name)) return "DRAW_NO_BET";
  if (/both teams.*score|btts|gg ng/.test(name)) return "BTTS";
  if (/1up|1 up|2up|2 up|early payout/.test(name)) return "EARLY_RESULT";
  if (/home (team )?(goals|total)|team 1 total/.test(name)) return "HOME_TOTAL";
  if (/away (team )?(goals|total)|team 2 total/.test(name)) return "AWAY_TOTAL";
  if (!/half|team/.test(name) && /total goals|match goals|over under|goals total|^total$/.test(name)) return "TOTAL";
  if (/european handicap|3 way handicap|three way handicap/.test(name)) return "HANDICAP_3WAY";
  if (/match result|match winner|moneyline|win draw win|1x2/.test(name)) return "RESULT";
  return "OTHER";
}

function quotedLine(odd) {
  if (odd.line != null && Number.isFinite(Number(odd.line))) return Number(odd.line);
  const match = text(odd.selection).match(/(?:over|under)\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function selectionMatches(prediction, odd) {
  const wanted = text(prediction.selection), actual = text(odd.selection), key = prediction.key;
  if (key === "MATCH_HOME") return actual === "1" || actual === "home" || actual === wanted;
  if (key === "MATCH_DRAW") return actual === "x" || actual === "draw";
  if (key === "MATCH_AWAY") return actual === "2" || actual === "away" || actual === wanted;
  if (key === "DC_1X") return actual === "1x" || /home.*draw|draw.*home/.test(actual);
  if (key === "DC_X2") return actual === "x2" || /away.*draw|draw.*away/.test(actual);
  if (key === "DC_12") return actual === "12" || /home.*away|away.*home|either team/.test(actual);
  if (/^(OVER|HOME_OVER|AWAY_OVER)_/.test(key)) return actual.startsWith("over");
  if (/^(UNDER|HOME_UNDER|AWAY_UNDER)_/.test(key)) return actual.startsWith("under");
  if (key === "BTTS_YES") return actual === "yes" || actual === "gg";
  if (key === "BTTS_NO") return actual === "no" || actual === "ng";
  if (key === "HCP_3WAY_HOME") return actual === "1" || actual === "home" || actual.startsWith(text(prediction.selection).split(" ")[0]);
  if (key === "HCP_3WAY_DRAW") return actual === "x" || actual.startsWith("draw");
  if (key === "HCP_3WAY_AWAY") return actual === "2" || actual === "away" || actual.startsWith(text(prediction.selection).split(" ")[0]);
  return actual === wanted;
}

export function attachOdds(predictions, odds) {
  return predictions.map((prediction) => {
    const quote = odds.find((odd) => {
      const line = quotedLine(odd);
      const lineMatches = prediction.line == null || line != null && Math.abs(line - Number(prediction.line)) < .001;
      return predictionFamily(prediction.key) === quoteFamily(odd.market) && lineMatches && selectionMatches(prediction, odd);
    });
    if (!quote) return prediction;
    const implied = 1 / quote.odds;
    const comparable = odds.filter((odd) => odd.marketId === quote.marketId && odd.odds > 1);
    const overround = comparable.reduce((sum, odd) => sum + 1 / odd.odds, 0);
    const consensus = comparable.length >= 2 && overround > 0 ? implied / overround : null;
    // The de-margined bookmaker market is the stronger baseline in our
    // historical tests. The team model is a cautious adjustment, not an
    // excuse to overrule the market or manufacture an edge.
    const modelWeight = 0.2 + clamp(Number(prediction.dataQuality ?? 0), 0, 1) * 0.1;
    const blendedProbability = consensus == null ? prediction.probability : clamp(prediction.probability * modelWeight + consensus * (1 - modelWeight), 0.001, 0.999);
    return {
      ...prediction,
      modelProbability: prediction.probability,
      probability: blendedProbability,
      confidence: clamp(blendedProbability * (0.85 + prediction.dataQuality * 0.15), 0, 0.99),
      fairOdds: Number((1 / blendedProbability).toFixed(2)),
      quotedOdds: quote.odds,
      oddsSource: quote.source,
      oddsProvider: quote.provider ?? null,
      providerDeepLink: quote.deepLink ?? null,
      edge: consensus == null ? null : blendedProbability - consensus,
      expectedValue: blendedProbability * quote.odds - 1,
      impliedProbability: implied,
      marketProbability: consensus,
      modelMarketGap: consensus == null ? null : Math.abs(prediction.probability - consensus),
      providerMarketId: quote.marketId,
      providerSelectionId: quote.selectionId,
    };
  });
}
