import { canonicalEventIdentity, canonicalLeagueId } from "./identity.mjs";

export const HISTORY_REQUIREMENTS = Object.freeze({ long: 20, recent: 8, venue: 4 });

export const PRIORITY_HISTORY_FAMILIES = Object.freeze([
  { id: "NATIONS_LEAGUE", label: "Nations League", matcher: /(?:uefa|concacaf|women.?s)?\s*nations league|uefa\.nations|concacaf\.nations|uefa\.w\.nations/i },
  { id: "AFCON", label: "Africa Cup of Nations", matcher: /africa(?:n)? cup of nations|afcon|african nations championship|caf\.nations|caf\.championship|caf\.w\.nations/i },
  { id: "INTERNATIONAL_FRIENDLY", label: "International friendlies", matcher: /international friendly|women.?s international friendly|men.?s u21 friendly|fifa\.friendly|non-fifa/i },
  { id: "CLUB_FRIENDLY", label: "Club friendlies", matcher: /club friendly|club\.friendly/i },
]);

export function historyFamily(event = {}) {
  const value = `${event.league?.id ?? ""} ${event.league?.slug ?? ""} ${event.league?.name ?? ""}`;
  return PRIORITY_HISTORY_FAMILIES.find(family => family.matcher.test(value))?.id ?? null;
}

export function historyEvidence(pick = {}) {
  const homeRecent = Number(pick.factors?.homePlayed ?? 0);
  const awayRecent = Number(pick.factors?.awayPlayed ?? 0);
  const homeVenue = Number(pick.factors?.homeVenuePlayed ?? 0);
  const awayVenue = Number(pick.factors?.awayVenuePlayed ?? 0);
  const homeLong = Number(pick.factors?.homeHistoryPlayed ?? homeRecent);
  const awayLong = Number(pick.factors?.awayHistoryPlayed ?? awayRecent);
  return {
    homeRecent, awayRecent, homeVenue, awayVenue, homeLong, awayLong,
    total: homeLong + awayLong,
    minimum: Math.min(homeLong, awayLong),
    ready: Math.min(homeLong, awayLong) >= HISTORY_REQUIREMENTS.long
      && Math.min(homeRecent, awayRecent) >= HISTORY_REQUIREMENTS.recent
      && Math.min(homeVenue, awayVenue) >= HISTORY_REQUIREMENTS.venue,
  };
}

export function summarizeHistory(events = [], generatedAt = new Date().toISOString()) {
  const unique = [...new Map(events.filter(event => event?.status === "FINISHED")
    .map(event => [canonicalEventIdentity(event), event])).values()];
  const competitions = new Map();
  const teams = new Map();
  const priorityFamilies = new Map(PRIORITY_HISTORY_FAMILIES.map(family => [family.id, {
    id: family.id,
    label: family.label,
    matches: 0,
    teams: new Set(),
    competitions: new Set(),
    firstKickoff: null,
    lastKickoff: null,
  }]));
  for (const event of unique) {
    const leagueId = canonicalLeagueId(event.league?.id ?? event.league?.name ?? "unknown");
    const row = competitions.get(leagueId) ?? {
      id: leagueId,
      name: event.league?.name ?? "Unknown competition",
      country: event.league?.country ?? "",
      matches: 0,
      teams: new Set(),
      sources: new Set(),
      firstKickoff: event.kickoff,
      lastKickoff: event.kickoff,
    };
    row.matches += 1;
    row.teams.add(event.homeTeam?.id);
    row.teams.add(event.awayTeam?.id);
    row.sources.add(event.source ?? "unknown");
    if (event.kickoff < row.firstKickoff) row.firstKickoff = event.kickoff;
    if (event.kickoff > row.lastKickoff) row.lastKickoff = event.kickoff;
    competitions.set(leagueId, row);
    const familyId = historyFamily(event);
    if (familyId) {
      const family = priorityFamilies.get(familyId);
      family.matches += 1;
      family.competitions.add(leagueId);
      family.teams.add(event.homeTeam?.id);
      family.teams.add(event.awayTeam?.id);
      if (!family.firstKickoff || event.kickoff < family.firstKickoff) family.firstKickoff = event.kickoff;
      if (!family.lastKickoff || event.kickoff > family.lastKickoff) family.lastKickoff = event.kickoff;
    }
    for (const team of [event.homeTeam, event.awayTeam]) {
      if (!team?.id) continue;
      teams.set(team.id, (teams.get(team.id) ?? 0) + 1);
    }
  }
  return {
    version: 2,
    generatedAt,
    requirements: HISTORY_REQUIREMENTS,
    matches: unique.length,
    competitionCount: competitions.size,
    teamCount: teams.size,
    teamsMeetingLongRequirement: [...teams.values()].filter(count => count >= HISTORY_REQUIREMENTS.long).length,
    priorityFamilies: [...priorityFamilies.values()].map(row => ({
      ...row,
      teams: [...row.teams].filter(Boolean).length,
      competitions: [...row.competitions].length,
    })),
    competitions: [...competitions.values()].map(row => ({ ...row, teams: [...row.teams].filter(Boolean).length, sources: [...row.sources].sort() }))
      .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name)),
  };
}
