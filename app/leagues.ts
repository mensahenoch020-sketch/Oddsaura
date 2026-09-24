import type { League } from "./data";

export const LEAGUE_FILTERS = [
  { id: "ALL", label: "All leagues" },
  { id: "PREMIER_LEAGUE", label: "Premier League" },
  { id: "LA_LIGA", label: "La Liga" },
  { id: "SERIE_A", label: "Serie A" },
  { id: "BUNDESLIGA", label: "Bundesliga" },
  { id: "LIGUE_1", label: "Ligue 1" },
  { id: "EREDIVISIE", label: "Eredivisie" },
  { id: "SAUDI_PRO", label: "Saudi Pro League" },
  { id: "PORTUGAL", label: "Portugal League" },
  { id: "TURKIYE", label: "Türkiye League" },
  { id: "CHAMPIONS_LEAGUE", label: "Champions League" },
  { id: "EUROPA_LEAGUE", label: "Europa League" },
  { id: "CONFERENCE_LEAGUE", label: "Conference League" },
  { id: "MLS", label: "MLS" },
  { id: "INTERNATIONAL_FRIENDLY", label: "International Friendlies" },
  { id: "CLUB_FRIENDLY", label: "Club Friendlies" },
  { id: "WORLD_CUP", label: "World Cup" },
  { id: "NATIONS_LEAGUE", label: "Nations League" },
  { id: "AFCON", label: "Africa Cup of Nations" },
  { id: "OTHER", label: "Other leagues" },
] as const;

export type LeagueFilter = typeof LEAGUE_FILTERS[number]["id"];
export type PriorityLeague = Exclude<LeagueFilter, "ALL" | "OTHER">;

const priorityMatchers: Array<[PriorityLeague, RegExp]> = [
  ["PREMIER_LEAGUE", /\b(eng\.1|english premier|premier league)\b/i],
  ["LA_LIGA", /\b(esp\.1|la ?liga|spanish primera)\b/i],
  ["SERIE_A", /\b(ita\.1|italian serie a|serie a)\b/i],
  ["BUNDESLIGA", /\b(ger\.1|german bundesliga|bundesliga)\b/i],
  ["LIGUE_1", /\b(fra\.1|french ligue 1|ligue 1)\b/i],
  ["EREDIVISIE", /\b(ned\.1|eredivisie|dutch eredivisie)\b/i],
  ["SAUDI_PRO", /\b(ksa\.1|saudi pro|saudi professional|roshan saudi)\b/i],
  ["PORTUGAL", /\b(por\.1|primeira liga|liga portugal|portuguese primeira)\b/i],
  ["TURKIYE", /\b(tur\.1|super lig|süper lig|turkiye super|turkish super)\b/i],
  ["CHAMPIONS_LEAGUE", /\b(uefa champions|champions league|uefa\.champions)\b/i],
  ["EUROPA_LEAGUE", /\b(uefa europa|europa league|uefa\.europa)\b/i],
  ["CONFERENCE_LEAGUE", /\b(uefa conference|conference league)\b/i],
  ["MLS", /\b(usa\.1|major league soccer|mls)\b/i],
  ["INTERNATIONAL_FRIENDLY", /\b(international friendl(?:y|ies)|friendly internationals?|fifa friendl(?:y|ies))\b/i],
  ["CLUB_FRIENDLY", /\b(club friendl(?:y|ies)|friendly clubs?)\b/i],
  ["WORLD_CUP", /\b(fifa world cup|world cup qualif|world cup)\b/i],
  ["NATIONS_LEAGUE", /\b(uefa(?:\.w)?\.nations|concacaf\.nations|nations league)\b/i],
  ["AFCON", /\b(caf\.(?:nations|nations_qual|championship|w\.nations)|africa(?:n)? (?:cup of )?nations|afcon|african nations(?: cup| championship)?(?: qualif(?:ying|iers?))?)\b/i],
];

export function leagueFilterFor(league: League): LeagueFilter {
  const value = `${league.id ?? ""} ${league.name} ${league.country ?? ""}`;
  return priorityMatchers.find(([, matcher]) => matcher.test(value))?.[0] ?? "OTHER";
}

export function leagueMatches(league: League, filter: LeagueFilter) {
  return filter === "ALL" || leagueFilterFor(league) === filter;
}

export function leagueFilterLabel(filter: LeagueFilter) {
  return LEAGUE_FILTERS.find((item) => item.id === filter)?.label ?? filter;
}

export function leaguePriority(league: League) {
  const bucket = leagueFilterFor(league);
  const index = LEAGUE_FILTERS.findIndex((item) => item.id === bucket);
  return index < 1 ? 99 : index;
}
