const aliases = new Map(Object.entries({
  "wolves": "wolverhampton-wanderers",
  "wolverhampton": "wolverhampton-wanderers",
  "wolverhampton-wanderers": "wolverhampton-wanderers",
  "man-utd": "manchester-united",
  "man-united": "manchester-united",
  "manchester-utd": "manchester-united",
  "man-city": "manchester-city",
  "spurs": "tottenham-hotspur",
  "tottenham": "tottenham-hotspur",
  "newcastle": "newcastle-united",
  "west-ham": "west-ham-united",
  "brighton": "brighton-and-hove-albion",
  "paris-saint-germain": "psg",
  "paris-sg": "psg",
  "internazionale": "inter-milan",
  "inter": "inter-milan",
  "ac-milan": "milan",
  "athletico-madrid": "atletico-madrid",
  "atletico-de-madrid": "atletico-madrid",
  "bayern-munich": "bayern-munchen",
  "bayern-munchen": "bayern-munchen",
  "borussia-monchengladbach": "borussia-monchengladbach",
  "monchengladbach": "borussia-monchengladbach",
}));
const competitionAliases = new Map(Object.entries({
  "colombia-football": { id: "col.1", name: "Colombian Fútbol Profesional", country: "Colombia" },
}));

export function normalizedName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/\b(fc|afc|cf|sc|calcio|club de futbol|football club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function canonicalTeamId(name) {
  const normalized = normalizedName(name);
  return aliases.get(normalized) ?? normalized;
}

export function canonicalLeagueId(value) {
  const normalized = normalizedName(value);
  if (/eng-1|english-premier|premier-league/.test(normalized)) return "eng.1";
  if (/esp-1|la-liga|spanish-primera/.test(normalized)) return "esp.1";
  if (/ita-1|serie-a|italian-serie/.test(normalized)) return "ita.1";
  if (/ger-1|bundesliga|german-bundesliga/.test(normalized)) return "ger.1";
  if (/fra-1|ligue-1|french-ligue/.test(normalized)) return "fra.1";
  if (/ned-1|eredivisie|dutch-eredivisie/.test(normalized)) return "ned.1";
  if (/por-1|primeira-liga|liga-portugal|portuguese-primeira/.test(normalized)) return "por.1";
  if (/tur-1|super-lig|turkiye-super|turkish-super/.test(normalized)) return "tur.1";
  if (/ksa-1|saudi-pro|roshan-saudi|saudi-professional/.test(normalized)) return "ksa.1";
  return normalized;
}

export function sameTeam(left, right) {
  return Boolean(left && right && canonicalTeamId(left) === canonicalTeamId(right));
}

// Provider event ids are useful for loading a bookmaker page, but they cannot
// deduplicate the same match across schedule and history sources. This key is
// deliberately source-neutral so one result is never counted twice by the
// model merely because two feeds reported it.
export function canonicalEventIdentity(event) {
  const normalized = normalizeEventIdentity(event);
  const kickoff = String(normalized.kickoff ?? "");
  const day = Number.isFinite(Date.parse(kickoff)) ? new Date(kickoff).toISOString().slice(0, 10) : kickoff.slice(0, 10);
  return `${day}|${normalized.homeTeam?.id ?? "home"}|${normalized.awayTeam?.id ?? "away"}`;
}

// A club's senior men's, women's and age-group squads must not share form.
export function normalizeEventIdentity(event) {
  const originalLeague = event.league ?? {};
  const league = { ...originalLeague, ...(competitionAliases.get(normalizedName(originalLeague.name)) ?? {}) };
  const leagueText = `${league.name ?? ''} ${league.id ?? ''}`;
  const scopedTeam = (team = {}) => {
    const text = `${leagueText} ${team.name ?? ''} ${team.id ?? ''}`;
    const women = /women|female|ladies|femenin|feminin|frauen/i.test(text);
    const youth = text.match(/\b(?:u[ -]?|under[ -]?)(\d{2})\b/i);
    const reserve = /\breserves?\b/i.test(text);
    const scope = [women ? 'women' : '', youth ? `u${youth[1]}` : '', reserve ? 'reserves' : ''].filter(Boolean).join('-');
    const id = canonicalTeamId(team.name ?? team.id);
    return { ...team, id: scope ? `${id}::${scope}` : id };
  };
  const specialCompetition = /women|female|ladies|femenin|feminin|frauen|\bu[ -]?\d{2}\b|under[ -]?\d{2}|youth|reserve/i.test(leagueText);
  const leagueId = String(league.id ?? '').startsWith('scoped-') ? league.id : /^\d+$/.test(String(league.id ?? '')) && !specialCompetition
    ? canonicalLeagueId(league.name ?? league.id)
    : specialCompetition ? `scoped-${normalizedName(leagueText)}` : canonicalLeagueId(league.id ?? league.name);
  return { ...event, league: { ...league, id: leagueId }, homeTeam: scopedTeam(event.homeTeam), awayTeam: scopedTeam(event.awayTeam) };
}
