const bands = {
  SAFE: { min: 2, max: 3, confidence: 0.72, minOdds: 1.12, maxOdds: 1.75, selections: 4 },
  BALANCED: { min: 5, max: 10, confidence: 0.64, minOdds: 1.2, maxOdds: 2.5, selections: 7 },
  HIGH_RISK: { min: 10, max: 35, confidence: 0.54, minOdds: 1.45, maxOdds: 5, selections: 8 },
};

export function buildTicket(candidates, category, fixtures) {
  const band = bands[category];
  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const eligible = candidates
    .filter((item) => item.quotedOdds && item.confidence >= band.confidence && item.quotedOdds >= band.minOdds && item.quotedOdds <= band.maxOdds && (item.edge == null || item.edge >= -0.015))
    .sort((a, b) => (b.confidence + Math.max(0, b.edge ?? 0)) - (a.confidence + Math.max(0, a.edge ?? 0)));
  const selected = [];
  const used = new Set();
  let totalOdds = 1;
  for (const item of eligible) {
    if (used.has(item.fixtureId) || selected.length >= band.selections || totalOdds >= band.min) continue;
    const fixture = fixtureMap.get(item.fixtureId);
    if (!fixture || fixture.status !== "SCHEDULED" || new Date(fixture.kickoff).getTime() <= Date.now() + 20 * 60 * 1000) continue;
    selected.push({
      id: `${item.fixtureId}-${item.key}`,
      fixtureId: item.fixtureId,
      league: fixture.league,
      kickoff: fixture.kickoff,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      market: { key: item.key, name: item.name, category: item.category, line: item.line ?? null },
      selection: item.selection,
      odds: item.quotedOdds,
      probability: item.probability,
      confidence: item.confidence,
      edge: item.edge,
      oddsSource: item.oddsSource,
    });
    used.add(item.fixtureId);
    totalOdds *= item.quotedOdds;
  }
  if (selected.length < 2 || totalOdds < band.min || totalOdds > band.max) return null;
  const confidence = selected.reduce((sum, item) => sum + item.confidence, 0) / selected.length;
  return {
    id: `${category.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`,
    title: category === "SAFE" ? "Safe 2–3 Odds" : category === "BALANCED" ? "Balanced 5–10 Odds" : "High Risk",
    category,
    status: "PUBLISHED",
    totalOdds: Number(totalOdds.toFixed(2)),
    confidence,
    publishedAt: new Date().toISOString(),
    bookingCodes: [],
    selections: selected,
  };
}
