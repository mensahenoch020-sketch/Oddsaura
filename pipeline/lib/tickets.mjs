const bands = {
  SAFE_2: { title: "Daily 2 Odds", min: 1.9, max: 3.2, confidence: 0.66, minOdds: 1.12, maxOdds: 2.2, selections: 5, minHistory: 5 },
  VALUE_5: { title: "Daily 5 Odds", min: 4.5, max: 6.8, confidence: 0.64, minOdds: 1.18, maxOdds: 2.05, selections: 8, minHistory: 6 },
  BALANCED_10: { title: "Balanced 10 Odds", min: 8, max: 13, confidence: 0.6, minOdds: 1.22, maxOdds: 2.45, selections: 10, minHistory: 5 },
  HIGH_RISK: { title: "High Risk 15–35 Odds", min: 15, max: 35, confidence: 0.55, minOdds: 1.3, maxOdds: 3.5, selections: 12, minHistory: 4 },
  LONGSHOT_21: { title: "Daily 21-Leg Longshot", min: 20, max: Number.POSITIVE_INFINITY, confidence: 0.53, minOdds: 1.12, maxOdds: 2.1, selections: 21, minHistory: 4, exactSelections: 21 },
};

const supportedKeys = /^(MATCH_(HOME|DRAW|AWAY)|DC_(1X|X2|12)|OVER_|UNDER_|BTTS_(YES|NO)|HOME_(OVER|UNDER)_|AWAY_(OVER|UNDER)_|DNB_(HOME|AWAY))/;

function priorityLeague(league) {
  const value = `${league?.id ?? ""} ${league?.name ?? ""} ${league?.country ?? ""}`;
  const matchers = [
    /eng\.1|english premier|premier league/i,
    /esp\.1|la ?liga|spanish primera/i,
    /ita\.1|italian serie a|\bserie a\b/i,
    /ger\.1|german bundesliga|\bbundesliga\b/i,
    /fra\.1|french ligue 1|\bligue 1\b/i,
    /ned\.1|eredivisie/i,
    /ksa\.1|saudi pro|saudi professional|roshan saudi/i,
    /por\.1|primeira liga|liga portugal/i,
    /tur\.1|super lig|süper lig|turkiye super|turkish super/i,
  ];
  const index = matchers.findIndex((matcher) => matcher.test(value));
  return index < 0 ? 20 : index;
}

function estimatedOdds(item) {
  const value = item.quotedOdds;
  return Number.isFinite(value) ? Number(value) : null;
}

function marketFamily(key = "") {
  if (/^UNDER_|_(UNDER)_/.test(key)) return "UNDER";
  if (/^OVER_|_(OVER)_/.test(key)) return "OVER";
  if (/^MATCH_/.test(key)) return "RESULT";
  if (/^DC_/.test(key)) return "DOUBLE_CHANCE";
  if (/^BTTS_/.test(key)) return "BTTS";
  if (/^DNB_/.test(key)) return "DNB";
  return "OTHER";
}

export function buildTicket(candidates, category, fixtures) {
  const band = bands[category];
  if (!band) return null;
  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const eligible = candidates
    .filter((item) => {
      const odds = estimatedOdds(item);
      const history = (item.factors?.homePlayed ?? 0) + (item.factors?.awayPlayed ?? 0);
      return supportedKeys.test(item.key) && odds && history >= band.minHistory && item.confidence >= band.confidence && odds >= band.minOdds && odds <= band.maxOdds && (item.edge == null || item.edge >= -0.035);
    })
    .sort((a, b) => {
      const leagueDelta = priorityLeague(fixtureMap.get(a.fixtureId)?.league) - priorityLeague(fixtureMap.get(b.fixtureId)?.league);
      const diversityA = marketFamily(a.key) === "UNDER" ? -.06 : 0;
      const diversityB = marketFamily(b.key) === "UNDER" ? -.06 : 0;
      const qualityDelta = (b.confidence + Math.max(0, b.edge ?? 0) + diversityB) - (a.confidence + Math.max(0, a.edge ?? 0) + diversityA);
      return Math.abs(qualityDelta) > .055 ? qualityDelta : leagueDelta || qualityDelta;
    });
  const selected = [];
  const used = new Set();
  const familyCounts = new Map();
  let totalOdds = 1;
  for (const item of eligible) {
    if (used.has(item.fixtureId) || selected.length >= band.selections) continue;
    if (!band.exactSelections && totalOdds >= band.min) break;
    const fixture = fixtureMap.get(item.fixtureId);
    if (!fixture || fixture.status !== "SCHEDULED" || new Date(fixture.kickoff).getTime() <= Date.now() + 20 * 60 * 1000) continue;
    const odds = estimatedOdds(item);
    if (!band.exactSelections && selected.length && totalOdds * odds > band.max) continue;
    const family = marketFamily(item.key);
    const familyLimit = family === "UNDER" ? Math.max(1, Math.ceil(band.selections * .25)) : Math.max(2, Math.ceil(band.selections * .55));
    if ((familyCounts.get(family) ?? 0) >= familyLimit) continue;
    selected.push({
      id: `${item.fixtureId}-${item.key}`,
      fixtureId: item.fixtureId,
      league: fixture.league,
      kickoff: fixture.kickoff,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      market: { key: item.key, name: item.name, category: item.category, line: item.line ?? null },
      selection: item.selection,
      odds,
      priceStatus: "QUOTED",
      probability: item.probability,
      confidence: item.confidence,
      edge: item.edge,
      oddsSource: item.oddsSource,
    });
    used.add(item.fixtureId);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    totalOdds *= odds;
  }
  if (band.exactSelections && selected.length !== band.exactSelections) return null;
  if (!band.exactSelections && (selected.length < 2 || totalOdds < band.min || totalOdds > band.max)) return null;
  const confidence = selected.reduce((sum, item) => sum + item.confidence, 0) / selected.length;
  return {
    id: `${category.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`,
    title: band.title,
    category,
    status: "PUBLISHED",
    totalOdds: Number(totalOdds.toFixed(2)),
    priceStatus: "QUOTED",
    confidence,
    publishedAt: new Date().toISOString(),
    bookingCodes: [],
    selections: selected,
  };
}
