const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/oe/g, "o").replace(/ae/g, "a").replace(/ue/g, "u")
  .replace(/\butd\b/g, "united")
  .replace(/\b(fc|cf|sc|afc|club|football|calcio|de|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

const groups = [
  ["wolverhampton wanderers", "wolverhampton", "wolves"], ["manchester united", "man united", "man utd"], ["manchester city", "man city"],
  ["tottenham hotspur", "tottenham", "spurs"], ["newcastle united", "newcastle utd", "newcastle"], ["west ham united", "west ham utd", "west ham"],
  ["brighton and hove albion", "brighton hove albion", "brighton"], ["nottingham forest", "nottm forest", "nottingham"],
  ["sheffield wednesday", "sheff wednesday", "sheffield wed"], ["sheffield united", "sheff united", "sheffield utd"], ["queens park rangers", "qpr"],
  ["paris saint germain", "paris sg", "psg"], ["internazionale", "inter milan", "inter"], ["ac milan", "milan"],
  ["juventus turin", "juventus", "juve"], ["napoli", "ssc napoli"], ["as roma", "roma"], ["lazio", "ss lazio"],
  ["bayern munich", "bayern munchen", "bayern"], ["borussia monchengladbach", "borussia m gladbach", "gladbach"],
  ["rb leipzig", "rasenballsport leipzig", "leipzig"], ["bayer leverkusen", "bayer 04 leverkusen", "leverkusen"],
  ["atletico madrid", "atletico de madrid", "atl madrid"], ["athletic club", "athletic bilbao", "bilbao"],
  ["real betis", "real betis balompie", "betis"], ["real sociedad", "real sociedad san sebastian", "sociedad"],
  ["sporting clube de portugal", "sporting cp", "sporting lisbon"], ["vitoria guimaraes", "vitoria sc", "guimaraes"],
  ["psv eindhoven", "psv"], ["ajax amsterdam", "ajax"], ["feyenoord rotterdam", "feyenoord"], ["az alkmaar", "az"],
  ["fenerbahce istanbul", "fenerbahce"], ["galatasaray istanbul", "galatasaray"], ["besiktas istanbul", "besiktas"],
  ["istanbul basaksehir", "basaksehir"], ["al hilal riyadh", "al hilal"], ["al nassr riyadh", "al nassr"],
  ["al ittihad jeddah", "al ittihad"], ["al ahli jeddah", "al ahli"],
] as const;

const canonical = new Map<string, string>();
const searches = new Map<string, string[]>();
for (const group of groups) {
  const root = normalize(group[0]); const values = group.map(normalize);
  for (const alias of values) { canonical.set(alias, root); searches.set(alias, [...group]); }
}

export function normalizedTeam(value: string) { const result = normalize(value); return canonical.get(result) ?? result; }

export function teamSimilarity(left: string, right: string) {
  const x = normalizedTeam(left), y = normalizedTeam(right);
  if (x && x === y) return 1;
  const a = new Set(x.split(" ").filter(Boolean)), b = new Set(y.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((word) => b.has(word)).length / new Set([...a, ...b]).size;
  return Math.max(overlap, x.includes(y) || y.includes(x) ? .92 : 0);
}

export function teamSearchTerms(...teams: string[]) {
  const terms = teams.flatMap((team) => [team, ...(searches.get(normalize(team)) ?? []), ...normalizedTeam(team).split(" ").filter((part) => part.length > 3)]);
  return [...new Map(terms.filter(Boolean).map((term) => [normalize(term), term])).values()];
}
