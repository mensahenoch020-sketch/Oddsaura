import { configuredLeagues, config } from "../../config.js";
import { prisma } from "../../lib/prisma.js";
import { fetchFixtureOdds, fetchFixtures, normalizeOdds, type ProviderFixture } from "./api-football.js";
import { scoreFixture, type FormLine } from "../prediction/engine.js";

const toDate = (date: Date) => date.toISOString().slice(0, 10);

type FixtureStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
type MarketType = "HOME_WIN" | "DRAW" | "AWAY_WIN" | "HOME_OR_DRAW" | "AWAY_OR_DRAW" | "OVER_1_5" | "OVER_2_5" | "UNDER_2_5" | "BTTS_YES" | "BTTS_NO";
type SelectionResult = "PENDING" | "WON" | "LOST" | "VOID";

function mapStatus(short: string): FixtureStatus {
  if (["FT", "AET", "PEN"].includes(short)) return "FINISHED";
  if (["1H", "HT", "2H", "ET", "BT", "P"].includes(short)) return "LIVE";
  if (["PST", "SUSP", "INT"].includes(short)) return "POSTPONED";
  if (["CANC", "ABD", "AWD", "WO"].includes(short)) return "CANCELLED";
  return "SCHEDULED";
}

async function upsertFixture(item: ProviderFixture) {
  const league = await prisma.league.upsert({
    where: { providerId_season: { providerId: item.league.id, season: item.league.season } },
    update: { name: item.league.name, country: item.league.country, logoUrl: item.league.logo },
    create: { providerId: item.league.id, season: item.league.season, name: item.league.name, country: item.league.country, logoUrl: item.league.logo },
  });
  const [homeTeam, awayTeam] = await Promise.all([
    prisma.team.upsert({ where: { providerId: item.teams.home.id }, update: { name: item.teams.home.name, logoUrl: item.teams.home.logo }, create: { providerId: item.teams.home.id, name: item.teams.home.name, logoUrl: item.teams.home.logo } }),
    prisma.team.upsert({ where: { providerId: item.teams.away.id }, update: { name: item.teams.away.name, logoUrl: item.teams.away.logo }, create: { providerId: item.teams.away.id, name: item.teams.away.name, logoUrl: item.teams.away.logo } }),
  ]);
  const status = mapStatus(item.fixture.status.short);
  const fixture = await prisma.fixture.upsert({
    where: { providerId: item.fixture.id },
    update: { kickoff: new Date(item.fixture.date), status, round: item.league.round, venue: item.fixture.venue?.name, homeScore: item.goals.home, awayScore: item.goals.away },
    create: { providerId: item.fixture.id, leagueId: league.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff: new Date(item.fixture.date), status, round: item.league.round, venue: item.fixture.venue?.name, homeScore: item.goals.home, awayScore: item.goals.away },
  });
  if (status === "FINISHED" && item.goals.home !== null && item.goals.away !== null) {
    await prisma.fixtureResult.upsert({ where: { fixtureId: fixture.id }, update: { homeScore: item.goals.home, awayScore: item.goals.away, source: "api-football", settledAt: new Date() }, create: { fixtureId: fixture.id, homeScore: item.goals.home, awayScore: item.goals.away, source: "api-football" } });
  }
  return fixture;
}

export async function syncFootballData() {
  if (!config.FOOTBALL_API_KEY) return { skipped: true, reason: "FOOTBALL_API_KEY is not configured", fixtures: 0, odds: 0 };
  const from = toDate(new Date(Date.now() - 70 * 86_400_000));
  const to = toDate(new Date(Date.now() + 8 * 86_400_000));
  let fixtureCount = 0;
  let oddsCount = 0;
  for (const source of configuredLeagues) {
    const fixtures = await fetchFixtures(source.league, source.season, from, to);
    for (const item of fixtures) {
      const fixture = await upsertFixture(item);
      fixtureCount += 1;
      if (fixture.status !== "SCHEDULED" || fixture.kickoff.getTime() > Date.now() + 7 * 86_400_000) continue;
      const existing = await prisma.marketOdd.count({ where: { fixtureId: fixture.id, collectedAt: { gt: new Date(Date.now() - 3 * 3_600_000) } } });
      if (existing) continue;
      const odds = normalizeOdds(await fetchFixtureOdds(fixture.providerId));
      if (odds.length) {
        await prisma.marketOdd.createMany({ data: odds.map((odd) => ({ fixtureId: fixture.id, ...odd, impliedProbability: 1 / odd.decimal })) });
        oddsCount += odds.length;
      }
    }
  }
  await expireOldContent();
  await settleSelections();
  return { skipped: false, fixtures: fixtureCount, odds: oddsCount };
}

function formFromFixtures(teamId: string, fixtures: Array<{ homeTeamId: string; awayTeamId: string; homeScore: number | null; awayScore: number | null }>): FormLine {
  const form: FormLine = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
  for (const fixture of fixtures) {
    if (fixture.homeScore === null || fixture.awayScore === null) continue;
    const isHome = fixture.homeTeamId === teamId;
    const gf = isHome ? fixture.homeScore : fixture.awayScore;
    const ga = isHome ? fixture.awayScore : fixture.homeScore;
    form.played += 1; form.goalsFor += gf; form.goalsAgainst += ga;
    if (gf > ga) form.wins += 1; else if (gf === ga) form.draws += 1; else form.losses += 1;
  }
  return form;
}

export async function runPredictionEngine() {
  const fixtures = await prisma.fixture.findMany({
    where: { status: "SCHEDULED", kickoff: { gt: new Date(), lt: new Date(Date.now() + 7 * 86_400_000) } },
    include: { odds: { orderBy: { collectedAt: "desc" } } },
    orderBy: { kickoff: "asc" },
  });
  let stored = 0;
  for (const fixture of fixtures) {
    const [homeMatches, awayMatches, h2hMatches] = await Promise.all([
      prisma.fixture.findMany({ where: { status: "FINISHED", kickoff: { lt: fixture.kickoff }, OR: [{ homeTeamId: fixture.homeTeamId }, { awayTeamId: fixture.homeTeamId }] }, orderBy: { kickoff: "desc" }, take: 10 }),
      prisma.fixture.findMany({ where: { status: "FINISHED", kickoff: { lt: fixture.kickoff }, OR: [{ homeTeamId: fixture.awayTeamId }, { awayTeamId: fixture.awayTeamId }] }, orderBy: { kickoff: "desc" }, take: 10 }),
      prisma.fixture.findMany({ where: { status: "FINISHED", kickoff: { lt: fixture.kickoff }, OR: [{ homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId }, { homeTeamId: fixture.awayTeamId, awayTeamId: fixture.homeTeamId }] }, orderBy: { kickoff: "desc" }, take: 6 }),
    ]);
    const latestByMarket = new Map<MarketType, { market: string; selection: string; decimal: number }>();
    for (const odd of fixture.odds) if (!latestByMarket.has(odd.market)) latestByMarket.set(odd.market, { market: odd.market, selection: odd.selection, decimal: odd.decimal });
    const h2h = { played: 0, homeGoals: 0, awayGoals: 0, homeWins: 0, draws: 0, awayWins: 0 };
    for (const match of h2hMatches) {
      if (match.homeScore === null || match.awayScore === null) continue;
      const currentHomeWasHome = match.homeTeamId === fixture.homeTeamId;
      const hg = currentHomeWasHome ? match.homeScore : match.awayScore;
      const ag = currentHomeWasHome ? match.awayScore : match.homeScore;
      h2h.played += 1; h2h.homeGoals += hg; h2h.awayGoals += ag;
      if (hg > ag) h2h.homeWins += 1; else if (hg === ag) h2h.draws += 1; else h2h.awayWins += 1;
    }
    const scores = scoreFixture({ home: formFromFixtures(fixture.homeTeamId, homeMatches), away: formFromFixtures(fixture.awayTeamId, awayMatches), headToHead: h2h, prices: [...latestByMarket.values()] });
    for (const score of scores) {
      const passes = score.confidence >= config.PREDICTION_CONFIDENCE_MIN && (score.edge === null || score.edge >= config.PREDICTION_EDGE_MIN);
      await prisma.prediction.upsert({
        where: { fixtureId_market_selection: { fixtureId: fixture.id, market: score.market, selection: score.selection } },
        update: { modelProbability: score.probability, impliedProbability: score.impliedProbability, edge: score.edge, confidenceScore: score.confidence, expectedHomeGoals: score.expectedHomeGoals, expectedAwayGoals: score.expectedAwayGoals, recommendedOdds: score.decimal, factors: score.factors, status: passes ? "CANDIDATE" : "REJECTED" },
        create: { fixtureId: fixture.id, market: score.market, selection: score.selection, modelProbability: score.probability, impliedProbability: score.impliedProbability, edge: score.edge, confidenceScore: score.confidence, expectedHomeGoals: score.expectedHomeGoals, expectedAwayGoals: score.expectedAwayGoals, recommendedOdds: score.decimal, factors: score.factors, status: passes ? "CANDIDATE" : "REJECTED" },
      });
      if (passes) stored += 1;
    }
  }
  return { fixtures: fixtures.length, candidates: stored };
}

export async function expireOldContent() {
  const now = new Date();
  const [tickets] = await Promise.all([
    prisma.ticket.updateMany({ where: { expiresAt: { lte: now }, status: { in: ["DRAFT", "PUBLISHED"] } }, data: { status: "EXPIRED" } }),
    prisma.fixture.updateMany({ where: { kickoff: { lt: new Date(Date.now() - 6 * 3_600_000) }, status: "SCHEDULED" }, data: { status: "POSTPONED" } }),
  ]);
  return { expiredTickets: tickets.count };
}

function selectionResult(market: MarketType, home: number, away: number): SelectionResult {
  const total = home + away;
  const won = market === "HOME_WIN" ? home > away : market === "DRAW" ? home === away : market === "AWAY_WIN" ? away > home : market === "HOME_OR_DRAW" ? home >= away : market === "AWAY_OR_DRAW" ? away >= home : market === "OVER_1_5" ? total >= 2 : market === "OVER_2_5" ? total >= 3 : market === "UNDER_2_5" ? total <= 2 : market === "BTTS_YES" ? home > 0 && away > 0 : !(home > 0 && away > 0);
  return won ? "WON" : "LOST";
}

export async function settleSelections() {
  const pending = await prisma.ticketSelection.findMany({ where: { result: "PENDING", prediction: { fixture: { status: "FINISHED" } } }, include: { prediction: { include: { fixture: true } } } });
  for (const item of pending) {
    const fixture = item.prediction.fixture;
    if (fixture.homeScore === null || fixture.awayScore === null) continue;
    await prisma.ticketSelection.update({ where: { id: item.id }, data: { result: selectionResult(item.prediction.market, fixture.homeScore, fixture.awayScore) } });
  }
  return { settled: pending.length };
}
